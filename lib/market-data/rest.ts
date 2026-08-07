import type { Candle } from '@/lib/types';

export const REST_HOSTS = [
  'https://data-api.market-data-source-source.vision',
  'https://api.market-data-source.com',
] as const;

export class GeoBlockedError extends Error {}      // thrown on HTTP 451 from all hosts

/** Raw kline row: [openTime(ms), open, high, low, close, volume, closeTime, ...] */
type RawKline = [number, string, string, string, string, ...unknown[]];

interface ExchangeInfoSymbol {
  symbol: string;
  status: string;
  quoteAsset: string;
}

/** Raw `/api/v3/ticker/24hr` row. Every numeric arrives as a string. */
export interface RawTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  count: number;
}

/**
 * Per-host wall clock. This is load-bearing, not a nicety: browser `fetch` never times out on
 * its own, and the dominant real-world block is NOT a clean HTTP 451 — it is an ISP or corporate
 * middlebox silently dropping packets. Without this, both hosts hang forever, the snapshot never
 * settles, `marketsError` is never set, and the user stares at a loading skeleton indefinitely.
 * With CoinGecko gone there is no other path that would eventually populate the page. 8 s per host
 * bounds the whole chain at ~16 s and guarantees the error state is reachable.
 */
const REST_TIMEOUT_MS = 8_000;

/**
 * GET <host><path> trying each REST host in order. Returns parsed JSON from
 * the first host that answers 2xx. If every host returns HTTP 451 the caller
 * is geo-blocked → GeoBlockedError; any other total failure rethrows the
 * last error seen so callers can distinguish outage from geo-block.
 */
async function fetchJsonFromHosts(path: string): Promise<unknown> {
  let lastError: unknown = new Error(`All market REST hosts failed for ${path}`);
  let count451 = 0;
  for (const host of REST_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(REST_TIMEOUT_MS) });
      if (res.status === 451) {
        count451 += 1;
        lastError = new Error(`HTTP 451 from ${host}${path}`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${host}${path}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  if (count451 === REST_HOSTS.length) {
    throw new GeoBlockedError('Market data source geo-blocked: HTTP 451 from all hosts');
  }
  throw lastError;
}

/**
 * Kline history for a spot pair, mapped to lightweight-charts Candles.
 * Source open times are in milliseconds; Candle.time is UNIX seconds.
 */
export async function fetchKlines(
  pair: string,
  interval: string,
  limit = 500,
): Promise<Candle[]> {
  const path = `/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const rows = (await fetchJsonFromHosts(path)) as RawKline[];
  return rows.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));
}

/**
 * All currently tradable USDT pairs from exchangeInfo,
 * e.g. Set {"BTCUSDT", "ETHUSDT", ...}.
 *
 * The query string is load-bearing, not cosmetic. A bare `/api/v3/exchangeInfo` is
 * **17.4 MB raw / 316 KB gzipped**; `?showPermissionSets=false&symbolStatus=TRADING` is
 * **2.49 MB raw / 51.6 KB gzipped** and yields a *provably identical* TRADING+USDT set
 * (479 symbols, verified by set equality against the unfiltered payload). The permission-set
 * matrix is the bulk of those bytes and nothing in this app reads it.
 *
 * This call must NOT be replaced by suffix-matching `*USDT` over `ticker/24hr`: 22 USDT-suffixed
 * tickers with >= $1M of 24h quote volume are not status TRADING (UTKUSDT, MATICUSDT, BUSDUSDT,
 * FTMUSDT, LRCUSDT, DENTUSDT, ...), so a suffix filter alone would present halted markets as live.
 */
export async function fetchTradablePairs(): Promise<Set<string>> {
  const info = (await fetchJsonFromHosts(
    '/api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING',
  )) as {
    symbols?: ExchangeInfoSymbol[];
  };
  const pairs = new Set<string>();
  for (const s of info.symbols ?? []) {
    // `symbolStatus=TRADING` already filters server-side; re-checking costs nothing and keeps this
    // correct if a host ever ignores the parameter.
    if (s.status === 'TRADING' && s.quoteAsset === 'USDT') {
      pairs.add(s.symbol);
    }
  }
  return pairs;
}

/**
 * Every symbol's 24h statistics in one call (no `symbol` param): price, %, high, low, quote
 * volume and trade count. Weight 80, **1.88 MB raw / 278 KB gzipped** (measured). Returned raw —
 * filtering, ranking and naming live in `lib/market-data/markets.ts`, so this stays a thin transport
 * function.
 */
export async function fetch24hrTickers(): Promise<RawTicker24h[]> {
  return (await fetchJsonFromHosts('/api/v3/ticker/24hr')) as RawTicker24h[];
}
