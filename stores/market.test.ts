import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_GAINER_CHANGE_PCT, MIN_GAINER_VOLUME } from '@/lib/market-data/markets';
import type { CoinMarket, LiveTicker } from '@/lib/types';
import { displayStatus, useMarket } from '@/stores/market';

function makeCoin(
  over: Pick<CoinMarket, 'id' | 'symbol' | 'price'> & Partial<CoinMarket>,
): CoinMarket {
  return {
    name: over.symbol.toUpperCase(),
    // DERIVED, never a constant: the ticker map is keyed by pair, so a hard-coded 'BTCUSDT' would
    // make every non-BTC fixture unresolvable and the resulting failures would look like store bugs.
    pair: `${over.symbol.toUpperCase()}USDT`,
    rank: 1,
    change24h: 0,
    high24h: over.price * 1.05,
    low24h: over.price * 0.95,
    volume24h: 0,
    trades24h: 0,
    ...over,
  };
}

function makeTicker(pair: string, price: number, open24h = price * 0.98): LiveTicker {
  return {
    pair,
    price,
    open24h,
    high24h: price * 1.02,
    low24h: price * 0.95,
    volume24h: 1_000_000,
    updatedAt: 1_722_600_000_000,
  };
}

const BTC = makeCoin({ id: 'btc', symbol: 'btc', price: 50_000, change24h: 1.5 });
const ETH = makeCoin({ id: 'eth', symbol: 'eth', price: 3_000, change24h: -2 });

/**
 * Fifty liquid-but-FLAT rows. Volume is comfortably over the floor, so the only reason none of them
 * reaches the strip is the change gate — which makes any assertion built on them a statement about
 * WHERE the derivation looked, not about the thresholds (those are pinned in markets.test.ts).
 */
const GAINER_FILLER = Array.from({ length: 50 }, (_, i) =>
  makeCoin({ id: `f${i}`, symbol: `f${i}`, price: 1, change24h: 0, volume24h: MIN_GAINER_VOLUME * 2 }),
);

/**
 * Three genuine movers, deliberately placed AFTER the filler in every universe below and given
 * distinct changes so the descending sort is observable. Exactly MIN_GAINER_CHIPS of them, so the
 * expected strip is all three or — the moment the derivation stops seeing them — nothing at all.
 */
const GAINER_MOVERS = [
  makeCoin({
    id: 'aaa', symbol: 'aaa', price: 1,
    change24h: MIN_GAINER_CHANGE_PCT + 7, volume24h: MIN_GAINER_VOLUME * 2,
  }),
  makeCoin({
    id: 'bbb', symbol: 'bbb', price: 1,
    change24h: MIN_GAINER_CHANGE_PCT + 6, volume24h: MIN_GAINER_VOLUME * 2,
  }),
  makeCoin({
    id: 'ccc', symbol: 'ccc', price: 1,
    change24h: MIN_GAINER_CHANGE_PCT + 5, volume24h: MIN_GAINER_VOLUME * 2,
  }),
];

describe('useMarket', () => {
  beforeEach(() => {
    useMarket.setState({
      coins: [],
      byId: {},
      trending: [],
      tickers: {},
      pairs: new Set<string>(),
      status: 'connecting',
      lastMessageAt: 0,
      snapshotAt: 0,
      marketsError: false,
    });
  });

  it('applyTickers merges tickers by pair and overwrites existing entries', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000), makeTicker('ETHUSDT', 3_000)]);
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 51_000)]);
    const { tickers } = useMarket.getState();
    expect(Object.keys(tickers).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(tickers.BTCUSDT.price).toBe(51_000);
    expect(tickers.ETHUSDT.price).toBe(3_000);
  });

  it('applyTickers publishes a NEW tickers object instead of mutating the existing map', () => {
    // The copy-on-write in applyTickers is the only thing that makes the demo's centrepiece tick.
    // A bare `useMarket((s) => s.tickers)` subscriber — the pattern the store's own comment
    // prescribes for the Portfolio page — compares the selected value by reference, so mutating the
    // existing map in place would publish a store update that every such subscriber ignores: prices
    // correct on first paint, then frozen forever. Every other applyTickers assertion reads through
    // useMarket.getState(), which cannot see a lost object identity, so this is the only guard.
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000)]);
    const before = useMarket.getState().tickers;

    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 51_000), makeTicker('ETHUSDT', 3_000)]);
    const after = useMarket.getState().tickers;

    expect(after).not.toBe(before);
    expect(after.BTCUSDT.price).toBe(51_000);
    // The previous map must be left exactly as it was — proof the update was a copy, not a mutation.
    expect(before.BTCUSDT.price).toBe(50_000);
    expect(before.ETHUSDT).toBeUndefined();
  });

  it('applyTickers stamps lastMessageAt with the current time', () => {
    expect(useMarket.getState().lastMessageAt).toBe(0);
    const before = Date.now();
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000)]);
    expect(useMarket.getState().lastMessageAt).toBeGreaterThanOrEqual(before);
  });

  it('setCoins derives the byId index and stamps snapshotAt', () => {
    const before = Date.now();
    useMarket.getState().setCoins([BTC, ETH]);
    const s = useMarket.getState();
    expect(Object.keys(s.byId).sort()).toEqual(['btc', 'eth']);
    expect(s.byId.btc).toBe(BTC);
    expect(s.snapshotAt).toBeGreaterThanOrEqual(before);
  });

  it('setCoins derives trending over the WHOLE universe, not the first 50 rows', () => {
    // setCoins is the OTHER assembly point for the gainers strip: `rerankFromTickers` writes through
    // it every 5 minutes for the lifetime of the tab, so a derivation that only ran inside
    // setSnapshot would blank the landing page's headline strip on the first local re-rank.
    useMarket.getState().setCoins([...GAINER_FILLER, ...GAINER_MOVERS]);
    expect(useMarket.getState().trending.map((c) => c.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('rerankCoins re-derives coins, byId and trending but LEAVES snapshotAt untouched', () => {
    // snapshotAt is consumed as a PRICE AGE: OfflineBanner renders "prices shown as of HH:MM" from
    // it. A local re-rank issues zero requests and refreshes `volume24h`/`rank` only — never
    // `price` — so restamping it here would let the disclosure keep advancing through a network
    // partition while every price on screen stayed frozen at its last real value. That is why
    // `rerankFromTickers` writes through this action and not through `setCoins`.
    const realSnapshot = 1_700_000_000_000;
    useMarket.setState({ snapshotAt: realSnapshot });

    useMarket.getState().rerankCoins([...GAINER_FILLER, ...GAINER_MOVERS]);

    const s = useMarket.getState();
    expect(s.snapshotAt).toBe(realSnapshot);
    // Still a full re-derivation: coins, byId and the gainers strip all move.
    expect(s.coins).toEqual([...GAINER_FILLER, ...GAINER_MOVERS]);
    expect(s.byId.aaa).toBe(GAINER_MOVERS[0]);
    expect(s.trending.map((c) => c.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('setSnapshot writes coins, byId, pairs, trending and clears the error in ONE transaction', () => {
    useMarket.getState().setMarketsError(true);
    let renders = 0;
    const unsubscribe = useMarket.subscribe(() => {
      renders += 1;
    });

    // The movers are in the universe so `trending` comes out NON-empty. Asserting an empty strip
    // here would be vacuous — it passes just as happily with the derivation deleted — and the strip
    // being written by this very set() is half of what the test is claiming.
    useMarket.getState().setSnapshot([...GAINER_MOVERS, BTC, ETH], new Set(['BTCUSDT', 'ETHUSDT']));
    unsubscribe();

    const s = useMarket.getState();
    expect(s.coins).toEqual([...GAINER_MOVERS, BTC, ETH]);
    expect(Object.keys(s.byId).sort()).toEqual(['aaa', 'bbb', 'btc', 'ccc', 'eth']);
    expect(s.pairs.has('ETHUSDT')).toBe(true);
    expect(s.trending.map((c) => c.id)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(s.marketsError).toBe(false);
    expect(s.snapshotAt).toBeGreaterThan(0);
    // The whole point: four separate setters meant four render passes per refresh, and briefly
    // published an inconsistent store (new coins beside stale trending).
    expect(renders).toBe(1);
  });

  it('setSnapshot derives trending from the WHOLE universe, not the first 50 rows', () => {
    // market-only-design.md §6: the strip "cannot be a selector over `coins.slice(0, 50)` because a
    // top gainer is frequently ranked well below #50 by volume". The 50 filler rows are flat, so both
    // a deleted derivation and a `pickGainers(coins.slice(0, 50))` one return [] and fail here.
    useMarket.getState().setSnapshot([...GAINER_FILLER, ...GAINER_MOVERS], new Set());
    expect(useMarket.getState().trending.map((c) => c.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('setStatus updates status', () => {
    useMarket.getState().setStatus('streaming');
    expect(useMarket.getState().status).toBe('streaming');
    useMarket.getState().setStatus('polling');
    expect(useMarket.getState().status).toBe('polling');
  });

  it('setStatus("polling") clears the tickers map so a frozen tick cannot masquerade as live', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000), makeTicker('ETHUSDT', 3_000)]);
    expect(Object.keys(useMarket.getState().tickers)).toHaveLength(2);
    useMarket.getState().setStatus('polling');
    expect(useMarket.getState().status).toBe('polling');
    expect(useMarket.getState().tickers).toEqual({});
  });

  it('setStatus("streaming") preserves already-applied tickers', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000)]);
    useMarket.getState().setStatus('reconnecting');
    useMarket.getState().setStatus('streaming');
    expect(useMarket.getState().tickers.BTCUSDT.price).toBe(50_000);
  });

  it('setStatus never clears marketsError, whatever the socket reports', () => {
    useMarket.getState().setMarketsError(true);
    useMarket.getState().setStatus('streaming');
    expect(useMarket.getState().marketsError).toBe(true);
  });

  it('marketsError defaults to false and setMarketsError toggles it', () => {
    expect(useMarket.getState().marketsError).toBe(false);
    useMarket.getState().setMarketsError(true);
    expect(useMarket.getState().marketsError).toBe(true);
    useMarket.getState().setMarketsError(false);
    expect(useMarket.getState().marketsError).toBe(false);
  });

  it('pairForCoin returns null for an id that is not in the current snapshot', () => {
    useMarket.getState().setCoins([BTC]);
    // The ONLY case this dead API earns a test for. Delisted coin, below the volume floor, or a
    // stale pre-rewrite CoinGecko slug in localStorage — Task 21 relies on the null.
    expect(useMarket.getState().pairForCoin('bitcoin')).toBeNull();
    expect(useMarket.getState().pairForCoin('nope')).toBeNull();
  });

  it('priceFor prefers the live ticker', () => {
    useMarket.getState().setCoins([BTC]);
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 51_234)]);
    expect(useMarket.getState().priceFor('btc')).toBe(51_234);
  });

  it('priceFor falls back to the snapshot price when no tick has arrived', () => {
    useMarket.getState().setCoins([BTC, ETH]);
    expect(useMarket.getState().priceFor('btc')).toBe(50_000);
    expect(useMarket.getState().priceFor('eth')).toBe(3_000);
  });

  it('priceFor returns undefined for an unknown coin', () => {
    expect(useMarket.getState().priceFor('nope')).toBeUndefined();
  });

  it('changeFor computes the percentage from the live ticker', () => {
    useMarket.getState().setCoins([BTC]);
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 110, 100)]);
    expect(useMarket.getState().changeFor('btc')).toBeCloseTo(10, 10);
  });

  it('changeFor falls back to the snapshot change when there is no ticker', () => {
    useMarket.getState().setCoins([BTC, ETH]);
    expect(useMarket.getState().changeFor('btc')).toBe(1.5);
    expect(useMarket.getState().changeFor('eth')).toBe(-2);
    expect(useMarket.getState().changeFor('nope')).toBeUndefined();
  });

  it('changeFor guards against open24h === 0 on a freshly listed pair', () => {
    useMarket.getState().setCoins([BTC]);
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 110, 0)]);
    // Without the guard this is Infinity, which formats as "∞%" on screen.
    expect(useMarket.getState().changeFor('btc')).toBe(1.5);
  });
});

describe('displayStatus', () => {
  const NO_TICKERS: Record<string, LiveTicker> = {};
  const LIVE_TICKERS: Record<string, LiveTicker> = { BTCUSDT: makeTicker('BTCUSDT', 50_000) };

  it('clamps a "streaming" socket to Offline when there is nothing at all to show', () => {
    // No coins AND no tickers: the socket is open but the page renders <DataUnavailable />, so
    // "Live" would describe an empty screen. This is the ?nodata=1 state.
    expect(
      displayStatus({ status: 'streaming', marketsError: true, coins: [], tickers: NO_TICKERS }),
    ).toBe('polling');
  });

  it('stays "streaming" with a failed snapshot when tickers can still fill the fallback table', () => {
    // THE regression this guards: REST blocked, socket untouched. MarketsTable renders 50 ticking
    // rows from `tickers` alone, so clamping to 'polling' put the badge's "prices are not updating"
    // directly above prices that were updating — the mirror image of the bug the clamp was for.
    expect(
      displayStatus({ status: 'streaming', marketsError: true, coins: [], tickers: LIVE_TICKERS }),
    ).toBe('streaming');
  });

  it('still clamps when the only tickers are ones the fallback table would not render', () => {
    // Same predicate as the fallback rows (isFallbackPair): a stablecoin pair and a non-USDT pair
    // produce zero rows, so the screen is empty and "Live" would again be false.
    expect(
      displayStatus({
        status: 'streaming',
        marketsError: true,
        coins: [],
        tickers: {
          USDCUSDT: makeTicker('USDCUSDT', 1),
          ETHBTC: makeTicker('ETHBTC', 0.05),
        },
      }),
    ).toBe('polling');
  });

  it('reports the real socket status again once a snapshot lands', () => {
    expect(
      displayStatus({ status: 'streaming', marketsError: true, coins: [BTC], tickers: NO_TICKERS }),
    ).toBe('streaming');
    expect(
      displayStatus({ status: 'streaming', marketsError: false, coins: [], tickers: NO_TICKERS }),
    ).toBe('streaming');
    expect(
      displayStatus({ status: 'streaming', marketsError: false, coins: [BTC], tickers: NO_TICKERS }),
    ).toBe('streaming');
  });

  it('passes connecting, reconnecting and polling through unchanged', () => {
    for (const status of ['connecting', 'reconnecting', 'polling'] as const) {
      expect(displayStatus({ status, marketsError: true, coins: [], tickers: NO_TICKERS })).toBe(
        status,
      );
      expect(displayStatus({ status, marketsError: true, coins: [], tickers: LIVE_TICKERS })).toBe(
        status,
      );
      expect(displayStatus({ status, marketsError: false, coins: [BTC], tickers: NO_TICKERS })).toBe(
        status,
      );
    }
  });
});
