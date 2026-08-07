// lib/massive.ts
//
// Server-side client for Massive.com (ex-Polygon.io) US-equities market data.
// Imported ONLY by the route handlers under app/api/stocks/* — never by a component.
// MASSIVE_API_KEY is read from process.env at call time and sent as an
// Authorization: Bearer header, so it never appears in a URL, an upstream access log
// or a Referer header, and it is never bundled for the browser.
import type { StockBar } from '@/lib/types';

const BASE = 'https://api.massive.com';

/** ISR windows in seconds. A completed session is immutable, so these are long. */
export const REVALIDATE_SESSION = 43_200; // 12h — last-completed-session probe
export const REVALIDATE_GROUPED = 43_200; // 12h — whole-market session summary
export const REVALIDATE_BARS = 86_400; // 24h — completed daily bars never change
export const REVALIDATE_NAME = 2_592_000; // 30d — reference data is effectively static

/** Calendar days walked back before giving up on finding a completed session. */
const WALK_BACK_MAX_DAYS = 5;

export class MissingApiKeyError extends Error {
  constructor() {
    super('MASSIVE_API_KEY is not set');
    this.name = 'MissingApiKeyError';
  }
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Massive rate limit reached; retry after ${retryAfterSeconds}s`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Massive responded ${status}`);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export class NoSessionError extends Error {
  constructor() {
    super('Could not resolve the last completed US trading session');
    this.name = 'NoSessionError';
  }
}

/** One row of the whole-market session summary (grouped daily). */
export interface GroupedBar {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  trades: number;
}

const NY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ms epoch → "YYYY-MM-DD" on the America/New_York calendar. */
export function nyDate(ms: number): string {
  return NY_DATE.format(new Date(ms));
}

/** "YYYY-MM-DD" minus n calendar days, same format. Pure UTC arithmetic. */
export function minusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

function apiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new MissingApiKeyError();
  return key;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function massiveFetch(path: string, revalidate: number): Promise<unknown> {
  const key = apiKey(); // throws before any network call when the build has no key
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${key}` },
    next: { revalidate, tags: ['massive'] },
  });

  // Both 429 and 403 mean "you are over quota" on this tier. Never retried here:
  // the Data Cache, not a retry loop, is what keeps us under 5 requests/minute.
  if (res.status === 429 || res.status === 403) {
    const header = Number(res.headers.get('retry-after'));
    throw new RateLimitError(Number.isFinite(header) && header > 0 ? header : 60);
  }
  if (!res.ok) throw new UpstreamError(res.status);
  return res.json();
}

interface RawGroupedRow {
  T?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  vw?: unknown;
  n?: unknown;
}

/**
 * The entire US equities session in ONE upstream call (~10k rows, 2–3 MB of JSON).
 * Returns [] for a weekend, a market holiday, or any date the provider has no data
 * for — that is not an error, it is how the walk-back below finds the last session.
 * Never log the raw body.
 */
export async function fetchGroupedDaily(date: string): Promise<GroupedBar[]> {
  const body = (await massiveFetch(
    `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}?adjusted=true&include_otc=false`,
    REVALIDATE_GROUPED,
  )) as { results?: RawGroupedRow[] | null };

  const out: GroupedBar[] = [];
  for (const row of body.results ?? []) {
    const ticker = typeof row?.T === 'string' ? row.T : null;
    const open = num(row?.o);
    const high = num(row?.h);
    const low = num(row?.l);
    const close = num(row?.c);
    const volume = num(row?.v);
    if (
      ticker === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }
    out.push({
      ticker,
      open,
      high,
      low,
      close,
      volume,
      vwap: num(row?.vw),
      trades: num(row?.n) ?? 0,
    });
  }
  return out;
}

/**
 * The New York calendar date of the last completed US session — resolved from the
 * data, never from `Date.getDay()`, so weekends and market holidays are ordinary
 * cases rather than failure modes.
 */
export async function resolveTradingDate(): Promise<string> {
  const body = (await massiveFetch(
    '/v2/aggs/ticker/SPY/prev?adjusted=true',
    REVALIDATE_SESSION,
  )) as { results?: Array<{ t?: unknown }> | null };

  const t = num(body.results?.[0]?.t);
  // `t` is the END of the aggregate window. Subtracting 1 ms stops a window that ends
  // exactly at midnight ET from being reported as the following calendar day.
  if (t !== null) return nyDate(t - 1);

  // The probe returned nothing. Walk back one calendar day at a time from today's NY
  // date until a grouped-daily response actually contains rows.
  let cursor = nyDate(Date.now());
  for (let i = 0; i < WALK_BACK_MAX_DAYS; i += 1) {
    cursor = minusDays(cursor, 1);
    const bars = await fetchGroupedDaily(cursor);
    if (bars.length > 0) return cursor;
  }
  throw new NoSessionError();
}

interface RawRangeRow {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  vw?: unknown;
}

/** Daily bars for one ticker, ascending. `from`/`to` are "YYYY-MM-DD". */
export async function fetchStockBars(
  ticker: string,
  from: string,
  to: string,
): Promise<StockBar[]> {
  const body = (await massiveFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${encodeURIComponent(from)}/${encodeURIComponent(to)}?adjusted=true&sort=asc&limit=5000`,
    REVALIDATE_BARS,
  )) as { results?: RawRangeRow[] | null };

  const out: StockBar[] = [];
  for (const row of body.results ?? []) {
    const t = num(row?.t);
    const open = num(row?.o);
    const high = num(row?.h);
    const low = num(row?.l);
    const close = num(row?.c);
    if (t === null || open === null || high === null || low === null || close === null) {
      continue;
    }
    // Custom-bars `t` is the START of the window (grouped-daily's is the END).
    out.push({
      time: Math.floor(t / 1000),
      open,
      high,
      low,
      close,
      volume: num(row?.v) ?? 0,
      vwap: num(row?.vw),
    });
  }
  return out;
}

/**
 * Best-effort company name, cached for 30 days. Swallows every failure and returns
 * null: the name is decoration, and it must never block or fail the chart.
 */
export async function fetchTickerName(ticker: string): Promise<string | null> {
  try {
    const body = (await massiveFetch(
      `/v3/reference/tickers/${encodeURIComponent(ticker)}`,
      REVALIDATE_NAME,
    )) as { results?: { name?: unknown } | null };
    const name = body.results?.name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
