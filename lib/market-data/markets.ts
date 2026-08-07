import { fetch24hrTickers, fetchTradablePairs, type RawTicker24h } from '@/lib/market-data/rest';
import { coinName } from '@/lib/coin-names';
import type { CoinMarket, LiveTicker } from '@/lib/types';

export type { RawTicker24h };

/**
 * Below this 24h quote volume a pair is not a real market — excluded from the universe entirely.
 *
 * Measured (and these figures DRIFT DAILY — they are ranges, and no test asserts them): ~479
 * TRADING USDT pairs exist, ~120-135 clear this floor, and ~100-115 survive `isCryptoBase` below.
 * That is the shipped universe. $1M rather than something stricter because a $10M floor leaves only
 * ~30 coins — fewer than the 50 rows the Markets table wants, so the table could not fill. The
 * gainers strip applies its own, differently-shaped filter (Task 12).
 *
 * Consequence to know: some assets in COIN_NAMES trade below this and are therefore absent from the
 * app entirely — SEI and TIA are both examples, so /coin/sei and /coin/tia land on Task 19's
 * unknown-coin state. That is intended behaviour, not a gap.
 */
export const MIN_UNIVERSE_QUOTE_VOLUME = 1_000_000;

/**
 * Volume floor for the gainers strip. $2M, and the number is measured rather than reasoned — twice,
 * because the first measurement produced $3M and the second showed $3M has no headroom at all.
 *
 * Counting live candidates that are up at least MIN_GAINER_CHANGE_PCT, by floor:
 *   all USDT markets:  $1M → 18 · $2M → 10 · $3M → 7 · $5M → 3 · $10M → 3
 *   crypto-only:        $1M → 17 · $2M →  9 · $3M → 7 · $5M → 3 · $10M → 3
 * The second row is the one that matters — the strip draws from the crypto-only universe. Measured on
 * one day; expect them to move, and nothing asserts them.
 * Note the filter costs a candidate at $1M and $2M but nothing at $3M, where there was nothing to
 * spare in the first place.
 *
 * $10M leaves THREE candidates for a seven-chip strip. The strip cannot fill, so it either shows
 * three chips or — with a bare `change24h > 0` gate — pads itself out with +1.0% chips, which is not
 * a rally and looks like it is scraping the barrel. Worse, $10M excluded a genuine move (BICO +51%
 * on ~$6M) for being INSUFFICIENTLY liquid, which is exactly backwards: surfacing that is the
 * strip's entire job.
 *
 * $3M is subtler and just as wrong: exactly 7 candidates for exactly 7 slots. A floor that yields as
 * many candidates as there are slots rejects nothing — the strip rendered chips at +2.00%, +2.02%
 * and +2.05%, i.e. precisely the barrel-scraping look the +2% gate exists to prevent, and
 * membership churned inside a 3-MINUTE window during measurement.
 *
 * $2M yields ~10 candidates for 7 slots. That headroom is the point: the three weakest movers of the
 * day get dropped rather than promoted by arithmetic, while the tail where a few hundred thousand
 * dollars prints +80% is still excluded.
 */
export const MIN_GAINER_VOLUME = 2_000_000;

/**
 * A "gainer" has to have actually moved. This gate, not the volume floor, is what does the
 * credibility work: it guarantees every chip represents a move worth looking at.
 */
export const MIN_GAINER_CHANGE_PCT = 2;

/**
 * Below this many qualifying movers the strip renders NOTHING (heading plus one muted line).
 * On a flat or red day there is no such thing as a credible gainers strip, and three chips is the
 * minimum that reads as a list rather than as a lonely leftover. Silence is information; padding
 * is not.
 */
export const MIN_GAINER_CHIPS = 3;

/**
 * Dollar, fiat and tokenized-metal proxies.
 *
 * These are EXCLUDED FROM THE UNIVERSE, not merely from the gainers strip, and the reason is
 * measured: on a pure 24h-volume ranking, USD Coin is #1 ($908M) above Bitcoin ($518M), the Euro
 * is #7, and 7 of the visible 50 rows are dollar/fiat/metal proxies carrying 43.6% of the visible
 * volume. The first three rows read "USD Coin, Bitcoin, Caldera", which a client reads as broken
 * data — and no caption recovers that first impression. The table's caption says "crypto" precisely
 * because of this filter (Task 15).
 *
 * The trade-off is real and deliberate: USDCUSDT IS the largest USDT market and we are
 * hiding it. The caption is the disclosure.
 */
export const STABLE_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'EURI', 'AEUR',
  'USD1', 'USDE', 'USDS', 'PYUSD', 'RLUSD', 'EUR', 'XAUT', 'PAXG',
]);

/** Belt and braces: any base with USD in the name is a dollar proxy, listed above or not. */
export function isStableBase(base: string): boolean {
  const key = base.toUpperCase();
  return STABLE_BASES.has(key) || /USD/.test(key);
}

/**
 * The only real crypto bases that end in "B". Measured against the live TRADING USDT set, the rule
 * below has exactly these 3 false positives against 15 true positives. Deleting this allowlist
 * deletes BNB from a demo.
 */
export const TICKER_B_ALLOWLIST = new Set(['BNB', 'SHIB', 'ARB']);

/** Escape hatch for a tokenized equity that does NOT end in "B". None exists today — empty on purpose. */
export const NON_B_EQUITY_BASES = new Set<string>();

/**
 * Tokenized equities and ETFs (NVDAB, INTCB, CRCLB, QQQB, SPYB, TSLAB, ...): real, liquid market-data-source
 * USDT markets that are not crypto markets.
 *
 * A RULE, not an enumeration, because an enumeration cannot be maintained. The 8-name list this
 * replaces (QQQB, MUB, EWYB, SOXLB, SKHYB, SNDKB, KORUB, SPCXB) was already stale when written:
 * 7 equity tokens above the $1M floor were missing from it — SNXXB, CRCLB, NBISB, NVDAB, MUUB,
 * DRAMB, INTCB (Nvidia, Intel, Circle) — with TSLAB, AMDB, GOOGLB, AAPLB, MSTRB, METAB, AMZNB,
 * MSFTB, PLTRB, SPYB, TQQQB, HOODB and ~25 more queued just below it.
 *
 * And nothing can be inferred from the API instead: `exchangeInfo` carries NO machine-readable
 * marker for these. NVDABUSDT and BTCUSDT have BYTE-IDENTICAL `permissions` and `permissionSets`.
 * A naming rule is the only mechanism available.
 */
export function isTokenizedEquityBase(base: string): boolean {
  const key = base.toUpperCase();
  if (NON_B_EQUITY_BASES.has(key)) return true;
  return key.endsWith('B') && !TICKER_B_ALLOWLIST.has(key);
}

/**
 * THE universe predicate: is this base asset a crypto market we are willing to rank?
 *
 * Used by `buildCoinMarkets` AND by the tickers-only fallback in Task 15, so the ranked table and
 * the degraded table cannot disagree about what belongs on a page captioned "crypto".
 */
export function isCryptoBase(base: string): boolean {
  const key = base.toUpperCase();
  // Plain A-Z0-9 only. The live universe contains 币安人生USDT ("Market Life", ~$3.5M/24h, ~rank 54):
  // a CJK base renders as a glyph at 11px inside CoinIcon's 24px circle, turns the route into
  // /coin/%E5%B8%81%E5%AE%89%E4%BA%BA%E7%94%9F with no encoding specified anywhere, and slips past
  // isStableBase. Do not delete this check as paranoia — it has a live counterexample.
  if (!/^[A-Z0-9]+$/.test(key)) return false;
  return !isStableBase(key) && !isTokenizedEquityBase(key);
}

/**
 * Would the tickers-only fallback table render a row for this stream pair?
 *
 * The SAME predicate is used in two places that must never disagree: the fallback row builder in
 * `MarketsTable` and `displayStatus`, which decides whether an open socket with a failed snapshot is
 * still honestly "Live". If the badge asked a different question from the table, the page could once
 * again say "Offline" above 50 ticking rows — the exact contradiction Task 15 exists to remove.
 *
 * Keyed on the pair, not the base, because the ticker map is keyed by pair. `'USDT'.slice(0, -4)` is
 * `''`, which `isCryptoBase` rejects, so a bare quote symbol cannot slip through.
 */
export function isFallbackPair(pair: string): boolean {
  return pair.endsWith('USDT') && isCryptoBase(pair.slice(0, -4));
}

// NOTE: there is deliberately NO leveraged-token regex. market-data-source has retired every BLVT UP/DOWN
// token, so the current TRADING USDT set contains ZERO leveraged tokens — a /(UP|DOWN|BULL|BEAR)$/
// filter has no true positives left to catch and produces only false ones, deleting JUP (Jupiter)
// and SYRUP. Listing hygiene comes from exchangeInfo's TRADING status (which excludes ~20 halted
// USDT-suffixed tickers that still print volume), the volume floor, and isCryptoBase.

/**
 * The coin universe, from a raw ticker/24hr payload plus the tradable USDT set.
 * Pure and synchronous: every network concern lives in `fetchMarketSnapshot` below.
 */
export function buildCoinMarkets(raw: RawTicker24h[], tradable: Set<string>): CoinMarket[] {
  const out: CoinMarket[] = [];

  for (const r of raw) {
    // `fetchTradablePairs` already guarantees status === 'TRADING' && quoteAsset === 'USDT',
    // so this single membership check does all of the listing hygiene...
    if (!tradable.has(r.symbol)) continue;
    // ...which is precisely what makes the 4-character slice safe.
    const base = r.symbol.slice(0, -4);
    // The crypto-only filter: non-alphanumeric bases, dollar/fiat/metal proxies and tokenized
    // equities all leave here. One predicate, so Task 15's degraded table applies the same rule.
    if (!isCryptoBase(base)) continue;

    const price = Number(r.lastPrice);
    const change24h = Number(r.priceChangePercent);
    const high24h = Number(r.highPrice);
    const low24h = Number(r.lowPrice);
    const volume24h = Number(r.quoteVolume);
    const trades24h = Number(r.count);

    // Same discipline as mapMiniTickers: a malformed row is dropped, never rendered as 0.
    // Careful: Number('') === 0, which IS finite. Only `price` has a range check strict enough to
    // reject a blank, which is why the tests assert that explicitly rather than assuming.
    if (![price, change24h, high24h, low24h, volume24h, trades24h].every(Number.isFinite)) continue;
    if (price <= 0) continue;
    if (volume24h < MIN_UNIVERSE_QUOTE_VOLUME) continue;

    const id = base.toLowerCase();
    out.push({
      id,
      symbol: id,
      name: coinName(base),
      pair: r.symbol,
      rank: 0, // assigned below, after sorting
      price,
      change24h,
      high24h,
      low24h,
      volume24h,
      trades24h,
    });
  }

  // Ties broken by pair so the order is deterministic — the tests and the frozen row order
  // in the Markets table both depend on this being stable across snapshots.
  out.sort((a, b) => b.volume24h - a.volume24h || a.pair.localeCompare(b.pair));
  out.forEach((c, i) => {
    c.rank = i + 1;
  });

  return out;
}

let pairsPromise: Promise<Set<string>> | null = null;

/**
 * The tradable USDT set, fetched **once per page session**. Even filtered, `exchangeInfo` is
 * 2.49 MB raw / 51.6 KB gzipped, and the set changes maybe weekly — re-fetching it on a timer would
 * be the single largest waste in the app. A FAILURE is deliberately not memoised: a retry has to be
 * able to succeed.
 */
export function tradablePairs(): Promise<Set<string>> {
  if (!pairsPromise) {
    pairsPromise = fetchTradablePairs().catch((e: unknown) => {
      pairsPromise = null;
      throw e;
    });
  }
  return pairsPromise;
}

/** Drops the memoised `exchangeInfo` promise. For tests, and for a forced hard refresh. */
export function clearPairsCache(): void {
  pairsPromise = null;
}

/**
 * The whole market snapshot: every liquid USDT spot market, ranked by 24h quote volume.
 * The two calls are issued in parallel, so `exchangeInfo` costs latency only on the very first
 * load of a session.
 *
 * Returns the crypto universe — **~100-115 coins** on a recent measurement, from ~479 TRADING USDT
 * pairs. Treat that as a range, not a constant: it moves with every listing and every quiet
 * weekend, and nothing asserts it. The store keeps all of them even though the table renders the
 * top 50 — the extra rows cost nothing and give us working deep links (`/coin/inj`) and watchlist
 * entries beyond the top 50. Errors (including `GeoBlockedError`) propagate to the caller unchanged.
 */
export async function fetchMarketSnapshot(): Promise<CoinMarket[]> {
  const [raw, pairs] = await Promise.all([fetch24hrTickers(), tradablePairs()]);
  return buildCoinMarkets(raw, pairs);
}

// NOTE: `STABLE_BASES` and `isStableBase` are NOT added here — Task 11 already defines them,
// because the crypto-only decision made them UNIVERSE filters (inside `isCryptoBase`) rather than
// gainers-strip filters. Do not redeclare them; just use `isStableBase` below.

/**
 * The top-gainers strip, derived from the already-filtered, already-ranked universe.
 *
 * Cannot be a selector over `coins.slice(0, 50)`: a genuine top gainer is frequently ranked well
 * below #50 by volume, so the strip needs the whole ~100-115-coin universe.
 */
export function pickGainers(coins: CoinMarket[], limit = 7): CoinMarket[] {
  const qualifying = coins
    .filter(
      (c) =>
        c.volume24h >= MIN_GAINER_VOLUME &&
        // Redundant since the universe is crypto-only, and kept: this function is pure and takes
        // whatever list a caller hands it, and a depeg labelled "top gainer" is the single most
        // embarrassing thing this strip could print.
        !isStableBase(c.symbol) &&
        c.change24h >= MIN_GAINER_CHANGE_PCT,
    )
    .sort((a, b) => b.change24h - a.change24h);

  // All or nothing. A two-chip "Top gainers" strip is worse than an honest empty state.
  if (qualifying.length < MIN_GAINER_CHIPS) return [];
  return qualifying.slice(0, limit);
}

/**
 * Re-rank the universe already in the store from the LIVE ticker map. Issues zero requests.
 *
 * `tickers[pair].volume24h` is the same `quoteVolume` figure the ranking sorts by, pushed for every
 * pair about once a second — so re-downloading 1.88 MB of ticker/24hr every 5 minutes to recompute
 * an order we can compute locally was pure waste (~3.3 MB of redundant JSON per hour on the page).
 * ticker/24hr is now re-fetched only when it can tell us something new: cold mount, tab focus after
 * >15 min hidden (membership may have changed), and after an error.
 */
export function rerank(coins: CoinMarket[], tickers: Record<string, LiveTicker>): CoinMarket[] {
  return coins
    .map((c) => ({ ...c, volume24h: tickers[c.pair]?.volume24h ?? c.volume24h }))
    .sort((a, b) => b.volume24h - a.volume24h || a.pair.localeCompare(b.pair))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
