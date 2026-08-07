import { create } from 'zustand';
import { isFallbackPair, pickGainers } from '@/lib/market-data/markets';
import type { CoinMarket, ConnectionStatus, LiveTicker } from '@/lib/types';

interface MarketState {
  coins: CoinMarket[];
  byId: Record<string, CoinMarket>;
  trending: CoinMarket[];
  tickers: Record<string, LiveTicker>;
  pairs: Set<string>;
  status: ConnectionStatus;
  lastMessageAt: number;   // last WS frame
  // ms epoch of the last successful REST snapshot, i.e. the age of the prices on screen when the
  // stream is down. OfflineBanner renders "prices shown as of HH:MM" from it, so only a real
  // network read may stamp it: `setSnapshot` and `setCoins` do, and the purely local re-rank goes
  // through `rerankCoins`, which deliberately does not.
  snapshotAt: number;
  marketsError: boolean;
  setSnapshot(coins: CoinMarket[], pairs: Set<string>): void;
  setCoins(c: CoinMarket[]): void;
  rerankCoins(c: CoinMarket[]): void;
  setStatus(s: ConnectionStatus): void;
  setMarketsError(v: boolean): void;
  applyTickers(list: LiveTicker[]): void;
  pairForCoin(coinId: string): string | null;
  priceFor(coinId: string): number | undefined;
  changeFor(coinId: string): number | undefined;
}

/**
 * The status the UI must SHOW, as opposed to the raw socket status.
 *
 * `status` describes the WebSocket and `marketsError` describes the REST snapshot — two
 * independent writers, by design, so neither can clobber the other (see the feed hook). But an
 * OPEN socket that renders NOTHING is not honestly "Live": with no coins and no usable tickers
 * there is no second data source and nothing on screen the badge could be describing.
 *
 * The `coins.length === 0` test alone is NOT that condition, and this is a correction. Task 15 gave
 * the failed-snapshot case a tickers-only table: `!miniTicker@arr` needs no REST call, so a REST
 * outage leaves 50 rows of real, ticking prices on screen. Clamping to 'polling' there produced the
 * original bug's mirror image — the badge reading "Offline" ("prices are not updating") directly
 * above prices that were visibly updating. So the clamp now also requires that there be no ticker
 * the fallback table would render.
 *
 * This is deliberately DERIVED, never stored. Storing a clamped status would mean a later socket
 * event could resurrect a stale "Live", and recovery would need an explicit re-sync. Returning a
 * primitive also makes it safe to use straight inside a zustand selector — and the ticker scan is
 * ordered last, behind `marketsError`, so the healthy path never pays for it. It walks keys rather
 * than `Object.values` and exits on the first hit, so even the degraded path allocates nothing.
 */
export function displayStatus(s: {
  status: ConnectionStatus;
  marketsError: boolean;
  coins: CoinMarket[];
  tickers: Record<string, LiveTicker>;
}): ConnectionStatus {
  if (
    s.status === 'streaming' &&
    s.marketsError &&
    s.coins.length === 0 &&
    !hasRenderableTicker(s.tickers)
  ) {
    return 'polling';
  }
  return s.status;
}

/** Is there at least one ticker the tickers-only fallback table would put on screen? */
function hasRenderableTicker(tickers: Record<string, LiveTicker>): boolean {
  for (const pair in tickers) if (isFallbackPair(pair)) return true;
  return false;
}

export const useMarket = create<MarketState>()((set, get) => ({
  coins: [],
  byId: {},
  trending: [],
  tickers: {},
  pairs: new Set<string>(),
  status: 'connecting',
  lastMessageAt: 0,
  snapshotAt: 0,
  marketsError: false,

  // ONE set() per refresh. Deriving byId and trending here means no caller can publish an
  // inconsistent pair of them, and a refresh costs one render pass instead of four. The previous
  // setPairs → setCoins → setTrending → setMarketsError sequence re-rendered the whole page four
  // times and briefly showed new coins beside stale gainers.
  setSnapshot: (coins, pairs) =>
    set({
      coins,
      byId: Object.fromEntries(coins.map((c) => [c.id, c])),
      trending: pickGainers(coins),
      pairs,
      snapshotAt: Date.now(),
      marketsError: false,
    }),

  // A real snapshot that has no new pair set to publish (and tests). Stamps snapshotAt, because the
  // prices it writes are as fresh as the network read that produced them.
  setCoins: (coins) =>
    set({
      coins,
      byId: Object.fromEntries(coins.map((c) => [c.id, c])),
      trending: pickGainers(coins),
      snapshotAt: Date.now(),
    }),

  // setCoins minus the snapshotAt stamp, for the LOCAL re-rank (`rerankFromTickers`). That re-rank
  // issues no request and refreshes `volume24h`/`rank` only — never `price` — so stamping
  // snapshotAt there would advance the "prices shown as of HH:MM" disclosure every 5 minutes
  // through a network partition while every price on screen stayed frozen at its last real value.
  // Exactly the dishonest disclosure the degraded states exist to prevent.
  rerankCoins: (coins) =>
    set({
      coins,
      byId: Object.fromEntries(coins.map((c) => [c.id, c])),
      trending: pickGainers(coins),
    }),

  // Entering 'polling' drops the live tickers. The original reason (polled prices become the
  // source of truth) is dead — nothing polls any more — but the behaviour matters MORE now: with
  // the stream gone there are no polled prices, and a frozen tick must not masquerade as a live
  // one. Clearing the map makes every reader fall back to the timestamped snapshot value, which
  // the UI labels with its age. That is the honest outcome.
  setStatus: (status) =>
    set((state) => ({ status, tickers: status === 'polling' ? {} : state.tickers })),

  setMarketsError: (marketsError) => set({ marketsError }),

  applyTickers: (list) =>
    set((s) => {
      const tickers = { ...s.tickers };
      for (const t of list) tickers[t.pair] = t;
      return { tickers, lastMessageAt: Date.now() };
    }),

  // DEAD API, retained only so this rewrite does not have to touch files it otherwise leaves
  // alone. `pair` is a required field on every CoinMarket and all UI code reads `coin.pair`
  // directly, so nothing calls this. Do not build on it. The only case worth a test is the null
  // one: a delisted coin, one below the volume floor, or a stale pre-rewrite localStorage entry.
  pairForCoin: (coinId) => get().byId[coinId]?.pair ?? null,

  // priceFor / changeFor are get()-based: calling them in a render body creates NO subscription.
  // They exist for surfaces that hold only a coinId and cannot key the ticker map themselves — in
  // practice the Portfolio page, which also subscribes with a bare useMarket((s) => s.tickers).
  // A component holding a CoinMarket must instead do:
  //     const t = useMarket((s) => s.tickers[coin.pair]);
  // and derive price, %, high, low and volume from `t`. Using priceFor there ships a table whose
  // prices are correct on first paint and then frozen forever.
  priceFor: (coinId) => {
    const s = get();
    const coin = s.byId[coinId];
    if (!coin) return undefined;
    return s.tickers[coin.pair]?.price ?? coin.price;
  },

  changeFor: (coinId) => {
    const s = get();
    const coin = s.byId[coinId];
    if (!coin) return undefined;
    const t = s.tickers[coin.pair];
    // Guard open24h > 0: a freshly listed pair would otherwise yield Infinity or NaN.
    if (t && t.open24h > 0) return ((t.price - t.open24h) / t.open24h) * 100;
    return coin.change24h;
  },
}));
