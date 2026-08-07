// lib/stocks-fixture.ts
//
// SYNTHETIC US-equities dataset — the DEFAULT source for /stocks and both stock API routes.
//
// Why it exists: Massive's Market Data ToS grants personal, non-business use only (§1, which
// also bars using the data "to build an application intended for use by end users other than
// you") and §5(c) puts *display* in the same prohibition as redistribution, extending it to
// derived works "including charts". A public deployment of this demo is exactly an application
// for other end users, so it must not show their numbers. Freezing a real session into a file
// would not help: a captured session is still their Market Data, and a movers table or a
// candlestick chart computed from it is a Derived Work.
//
// So every ticker, company name, price, volume and candle below is INVENTED. Nothing in this
// file was ever fetched from an upstream, which is why it is safe to publish. The route
// handlers serve it unless STOCKS_DATA_MODE is exactly "live", and the UI labels it
// SAMPLE DATA so no viewer can mistake it for a real quote.
//
// Everything is deterministic: the same ticker yields the same series in every process, on
// every machine, in every build. That also makes the stocks pages testable end to end.
import { nyDate, type GroupedBar } from '@/lib/massive';
import { rankMovers } from '@/lib/stocks-movers';
import type { StockBar, StockDetail, StocksDataMode, StocksPayload } from '@/lib/types';

/**
 * Which source answers a /stocks request. FIXTURE IS THE DEFAULT AND THE FAIL-SAFE:
 * only the exact string "live" opts in, so an unset, misspelled or differently-cased value
 * serves synthetic data. Having MASSIVE_API_KEY set is deliberately NOT enough — a deployment
 * that merely carries the key must not start publishing licensed data.
 *
 * Read from process.env on every call so a test (or a running server) can flip it.
 */
export function stocksDataMode(): StocksDataMode {
  return process.env.STOCKS_DATA_MODE === 'live' ? 'live' : 'fixture';
}

/**
 * The session the fixture describes: a fixed recent weekday, never `new Date()`. A moving
 * date would make the payload non-deterministic and could land on a weekend, where the page
 * would truthfully report a session that our own synthetic calendar says did not happen.
 */
export const STOCKS_FIXTURE_SESSION_DATE = '2026-07-31'; // Friday

/** Daily bars per detail series: 251 history bars + the session bar ≈ one trading year. */
const HISTORY_BARS = 251;

// ---------------------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------------------

/** FNV-1a. A ticker must seed the same series everywhere, so no Math.random(), ever. */
function seedFor(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, and stable across engines. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

// ---------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------

/**
 * "YYYY-MM-DD" → UNIX seconds at midnight America/New_York.
 *
 * Massive's daily bars are stamped with the START of the window, i.e. midnight ET, and the
 * detail route derives its sessionDate with `nyDate(bar.time * 1000)`. Midnight ET is 04:00
 * UTC on EDT dates and 05:00 UTC on EST dates, so try both and keep whichever instant really
 * is the first millisecond of that New York day. Hard-coding one offset would shift the
 * reported session date by a day for half the year.
 */
function nyMidnightSeconds(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  for (const utcHour of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, utcHour);
    if (nyDate(ms) === date && nyDate(ms - 1) !== date) return ms / 1000;
  }
  // Unreachable for any real date; throwing beats silently shipping a wrong timestamp.
  throw new Error(`stocks-fixture: could not resolve New York midnight for ${date}`);
}

/**
 * The `count` weekday calendar dates ending at `endDate`, oldest first.
 *
 * Market holidays are not modelled: nothing derives a trading calendar from the fixture, and
 * a synthetic year of weekdays reads correctly on a chart. Weekends ARE skipped, because a
 * Saturday candle is the kind of detail a reviewer notices at a glance.
 */
function weekdaysEndingAt(endDate: string, count: number): string[] {
  const [y, m, d] = endDate.split('-').map(Number);
  const out: string[] = [];
  let cursor = Date.UTC(y, m - 1, d);
  while (out.length < count) {
    const dow = new Date(cursor).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor -= 86_400_000;
  }
  return out.reverse();
}

/** Ascending midnight-ET timestamps, one per bar; the last one is the session itself. */
const BAR_TIMES: number[] = weekdaysEndingAt(
  STOCKS_FIXTURE_SESSION_DATE,
  HISTORY_BARS + 1,
).map(nyMidnightSeconds);

// ---------------------------------------------------------------------------------------
// The invented universe
// ---------------------------------------------------------------------------------------

interface FixtureSeed {
  ticker: string;
  name: string;
  open: number;
  close: number;
  volume: number;
  trades: number;
}

/**
 * 44 invented companies — 22 that closed up and 22 that closed down, so the Top Gainers and
 * Top Losers tabs each fill 20 rows with the correct sign and never share a ticker.
 *
 * Every ticker is six characters. Real US common stock symbols are one to five, so these
 * cannot collide with a listed symbol, and the names are plainly fictional. High, low and
 * VWAP are DERIVED below rather than typed out, which makes the OHLC relationships true by
 * construction instead of true by proofreading. Each row clears the same liquidity filter
 * (`MOVER_FILTERS`) the live path applies, so no tab ever silently ships fewer than 20 rows.
 */
const SEEDS: FixtureSeed[] = [
  // ---- closed up -------------------------------------------------------------------
  { ticker: 'ZENITH', name: 'Zenith Robotics', open: 142.1, close: 168.44, volume: 18_400_000, trades: 142_000 },
  { ticker: 'HELIOS', name: 'Helios Grid Energy', open: 61.25, close: 70.8, volume: 24_900_000, trades: 188_000 },
  { ticker: 'NOVARA', name: 'Novara Biosciences', open: 88.4, close: 100.35, volume: 9_800_000, trades: 96_000 },
  { ticker: 'ORBTEK', name: 'Orbitek Aerospace', open: 233.7, close: 261.15, volume: 6_200_000, trades: 74_000 },
  { ticker: 'LUMENA', name: 'Lumena Photonics', open: 47.6, close: 52.88, volume: 31_500_000, trades: 210_000 },
  { ticker: 'KESTRL', name: 'Kestrel Logistics', open: 19.84, close: 21.9, volume: 12_700_000, trades: 88_000 },
  { ticker: 'VANTIQ', name: 'Vantiq Analytics', open: 305.2, close: 335.6, volume: 3_400_000, trades: 61_000 },
  { ticker: 'AZURIS', name: 'Azuris Cloud Systems', open: 128.55, close: 140.1, volume: 15_100_000, trades: 132_000 },
  { ticker: 'FERROX', name: 'Ferrox Steelworks', open: 33.15, close: 35.92, volume: 8_900_000, trades: 52_000 },
  { ticker: 'QUILLA', name: 'Quilla Interactive', open: 12.44, close: 13.44, volume: 26_300_000, trades: 118_000 },
  { ticker: 'STRATA', name: 'Strata Materials', open: 74.9, close: 80.55, volume: 5_600_000, trades: 47_000 },
  { ticker: 'MERIDN', name: 'Meridian Freight', open: 56.3, close: 60.12, volume: 4_800_000, trades: 39_000 },
  { ticker: 'CALDRA', name: 'Caldera Semiconductor', open: 412, close: 438.75, volume: 7_300_000, trades: 155_000 },
  { ticker: 'ORYXIA', name: 'Oryxia Therapeutics', open: 27.05, close: 28.7, volume: 10_400_000, trades: 66_000 },
  { ticker: 'HARBOR', name: 'Harbor Point Shipping', open: 18.62, close: 19.66, volume: 6_900_000, trades: 34_000 },
  { ticker: 'PIVOTL', name: 'Pivotal Health Group', open: 91.2, close: 96.11, volume: 3_900_000, trades: 41_000 },
  { ticker: 'GRANIT', name: 'Granitor Mining', open: 44.75, close: 47.02, volume: 5_100_000, trades: 36_000 },
  { ticker: 'SOLARA', name: 'Solara Homebuilders', open: 66.4, close: 69.28, volume: 2_800_000, trades: 27_000 },
  { ticker: 'VELOCE', name: 'Veloce Motorworks', open: 158.3, close: 164.55, volume: 4_100_000, trades: 58_000 },
  { ticker: 'ATLASX', name: 'Atlas Exchange Group', open: 219.05, close: 226.4, volume: 2_600_000, trades: 44_000 },
  { ticker: 'BOREAL', name: 'Boreal Timber', open: 29.88, close: 30.71, volume: 1_900_000, trades: 15_000 },
  { ticker: 'CYGNET', name: 'Cygnet Payments', open: 84.15, close: 85.94, volume: 3_300_000, trades: 31_000 },
  // ---- closed down -----------------------------------------------------------------
  { ticker: 'DRAKON', name: 'Drakon Defense Systems', open: 96.4, close: 79.05, volume: 14_600_000, trades: 121_000 },
  { ticker: 'PYRRHA', name: 'Pyrrha Cosmetics', open: 41.3, close: 34.68, volume: 8_100_000, trades: 63_000 },
  { ticker: 'OMNICO', name: 'Omnico Retail Group', open: 23.55, close: 20.16, volume: 19_800_000, trades: 104_000 },
  { ticker: 'VIRIDA', name: 'Virida Agriculture', open: 57.9, close: 50.31, volume: 5_400_000, trades: 45_000 },
  { ticker: 'HALCYN', name: 'Halcyon Airways', open: 15.22, close: 13.45, volume: 22_400_000, trades: 96_000 },
  { ticker: 'TESSRA', name: 'Tessera Software', open: 187.6, close: 166.9, volume: 9_200_000, trades: 138_000 },
  { ticker: 'MONLTH', name: 'Monolith Foundry', open: 72.45, close: 65.12, volume: 4_700_000, trades: 38_000 },
  { ticker: 'GLACIR', name: 'Glacier Bottling', open: 38.1, close: 34.55, volume: 6_600_000, trades: 42_000 },
  { ticker: 'RIVETT', name: 'Rivett Fasteners', open: 26.9, close: 24.62, volume: 3_500_000, trades: 22_000 },
  { ticker: 'PALADN', name: 'Paladin Insurance', open: 145.75, close: 134.2, volume: 2_900_000, trades: 33_000 },
  { ticker: 'ECHELN', name: 'Echelon Realty Trust', open: 31.44, close: 29.1, volume: 7_800_000, trades: 49_000 },
  { ticker: 'NIMBUS', name: 'Nimbus Data Centers', open: 268.3, close: 249.55, volume: 11_500_000, trades: 176_000 },
  { ticker: 'SABLEX', name: 'Sable Exploration', open: 9.86, close: 9.2, volume: 28_700_000, trades: 92_000 },
  { ticker: 'TERRAV', name: 'Terravault Storage', open: 53.2, close: 49.86, volume: 3_100_000, trades: 26_000 },
  { ticker: 'WYVERN', name: 'Wyvern Aviation', open: 112.6, close: 105.94, volume: 4_400_000, trades: 51_000 },
  { ticker: 'COBALT', name: 'Cobalt Springs Beverage', open: 78.9, close: 74.55, volume: 5_900_000, trades: 47_000 },
  { ticker: 'LANTRN', name: 'Lantern Media', open: 17.35, close: 16.48, volume: 13_200_000, trades: 71_000 },
  { ticker: 'QUARTZ', name: 'Quartz Optical', open: 204.1, close: 195.2, volume: 3_700_000, trades: 62_000 },
  { ticker: 'MAGNOL', name: 'Magnolia Grocers', open: 62.8, close: 60.44, volume: 2_400_000, trades: 21_000 },
  { ticker: 'VESPER', name: 'Vesper Hotels', open: 35.66, close: 34.52, volume: 4_900_000, trades: 29_000 },
  { ticker: 'ONDULA', name: 'Ondula Telecom', open: 48.25, close: 47.08, volume: 6_100_000, trades: 40_000 },
  { ticker: 'KRYPTN', name: 'Krypton Chemicals', open: 121.4, close: 119.35, volume: 2_200_000, trades: 24_000 },
];

/**
 * Derive the session bar. `Math.max`/`Math.min` against the open/close are not belt-and-braces:
 * rounding a small percentage of a low-priced stock can land back on the open, and `high` must
 * never end up below it.
 */
function sessionBar(seed: FixtureSeed): GroupedBar {
  const rand = rng(seedFor(`${seed.ticker}|session`));
  const top = Math.max(seed.open, seed.close);
  const bottom = Math.min(seed.open, seed.close);
  const high = Math.max(round2(top * (1 + 0.002 + rand() * 0.012)), top);
  const low = Math.min(round2(bottom * (1 - 0.002 - rand() * 0.012)), bottom);
  const vwap = clamp(round2(low + (high - low) * (0.3 + rand() * 0.4)), low, high);
  return {
    ticker: seed.ticker,
    open: seed.open,
    high,
    low,
    close: seed.close,
    volume: seed.volume,
    vwap,
    trades: seed.trades,
  };
}

/** The whole invented session, in the same shape a real grouped-daily response arrives in. */
export const FIXTURE_SESSION: GroupedBar[] = SEEDS.map(sessionBar);

const SEED_BY_TICKER = new Map(SEEDS.map((s) => [s.ticker, s]));
const SESSION_BY_TICKER = new Map(FIXTURE_SESSION.map((b) => [b.ticker, b]));

// ---------------------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------------------

/**
 * The movers payload, ranked by the SAME `rankMovers` the live path uses — so the fixture
 * exercises the real ranking and filter code instead of a parallel implementation that could
 * drift away from it.
 */
export function stocksFixture(): StocksPayload {
  const { gainers, losers, actives, filtered } = rankMovers(FIXTURE_SESSION);
  return {
    mode: 'fixture',
    sessionDate: STOCKS_FIXTURE_SESSION_DATE,
    asOf: Date.now(),
    gainers,
    losers,
    actives,
    filtered,
  };
}

/**
 * A year of invented daily bars ending on the session bar.
 *
 * Shape first, level second: walk a seeded random series on an arbitrary base, then scale the
 * whole walk so its newest close sits a fraction off the session's open. Scaling is uniform,
 * so it cannot break any OHLC relationship, and it means the session bar opens on a plausible
 * overnight gap rather than jumping to an unrelated price.
 */
function seriesFor(session: GroupedBar): StockBar[] {
  const rand = rng(seedFor(`${session.ticker}|bars`));

  const walk: number[] = [];
  let level = 100;
  for (let i = 0; i < HISTORY_BARS; i += 1) {
    // ~1.4% daily vol with a slight upward drift, floored at a quarter of the base so a long
    // losing run cannot walk the series into pennies (or through the movers' $5 floor).
    level = Math.max(level * (1 + (rand() - 0.47) * 0.028), 25);
    walk.push(level);
  }

  const scale = (session.open * (1 + (rand() - 0.5) * 0.012)) / walk[HISTORY_BARS - 1];

  const bars: StockBar[] = [];
  for (let i = 0; i < HISTORY_BARS; i += 1) {
    const close = Math.max(round2(walk[i] * scale), 1);
    const prevClose = i === 0 ? close : bars[i - 1].close;
    const open = Math.max(round2(prevClose * (1 + (rand() - 0.5) * 0.01)), 1);
    const top = Math.max(open, close);
    const bottom = Math.min(open, close);
    const high = Math.max(round2(top * (1 + 0.001 + rand() * 0.011)), top);
    const low = Math.min(round2(bottom * (1 - 0.001 - rand() * 0.011)), bottom);
    bars.push({
      time: BAR_TIMES[i],
      open,
      high,
      low,
      close,
      volume: Math.round(session.volume * (0.45 + rand() * 0.9)),
      vwap: clamp(round2(low + (high - low) * (0.25 + rand() * 0.5)), low, high),
    });
  }

  // The newest bar IS the session bar, so the chart's last candle and the header stats agree.
  bars.push({
    time: BAR_TIMES[HISTORY_BARS],
    open: session.open,
    high: session.high,
    low: session.low,
    close: session.close,
    volume: session.volume,
    vwap: session.vwap,
  });
  return bars;
}

/**
 * Detail payload for one invented ticker, or null when the ticker is not in the fixture
 * universe — which the route turns into the same 404 a delisted symbol gets on the live path.
 */
export function stockDetailFixture(rawTicker: string): StockDetail | null {
  const ticker = (rawTicker ?? '').toUpperCase();
  const session = SESSION_BY_TICKER.get(ticker);
  const seed = SEED_BY_TICKER.get(ticker);
  if (session === undefined || seed === undefined) return null;

  const bars = seriesFor(session);
  const last = bars[bars.length - 1];
  const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;

  return {
    mode: 'fixture',
    ticker,
    name: seed.name,
    sessionDate: STOCKS_FIXTURE_SESSION_DATE,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    prevClose,
    changePct:
      prevClose !== null && prevClose > 0
        ? ((last.close - prevClose) / prevClose) * 100
        : null,
    volume: last.volume,
    vwap: last.vwap,
    bars,
  };
}
