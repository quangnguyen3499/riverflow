// lib/massive.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGroupedDaily,
  fetchStockBars,
  fetchTickerName,
  MissingApiKeyError,
  NoSessionError,
  RateLimitError,
  resolveTradingDate,
  UpstreamError,
} from '@/lib/massive';

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Routes each mocked fetch by URL substring so multi-call flows (probe → walk-back)
 * stay readable. Every route is a factory: a Response body can only be read once, and
 * the walk-back test hits the same route five times. Typed as `unknown[]` so the
 * recorded calls can be read back as the `[url, init]` pair fetch was given.
 */
function routedFetch(routes: Array<[match: string, response: () => Response]>) {
  return vi.fn((...args: unknown[]): Promise<Response> => {
    const url = String(args[0]);
    const hit = routes.find(([match]) => url.includes(match));
    if (!hit) return Promise.reject(new Error(`unexpected fetch: ${url}`));
    return Promise.resolve(hit[1]());
  });
}

const GROUPED = '/v2/aggs/grouped/locale/us/market/stocks/';
const PREV = '/v2/aggs/ticker/SPY/prev';

const groupedRow = {
  T: 'AAPL',
  v: 52_000_000,
  vw: 231.4,
  o: 228.1,
  c: 234.9,
  h: 235.5,
  l: 227.6,
  t: Date.UTC(2026, 7, 1, 4, 0, 0), // END of the 2026-07-31 window (midnight ET, 1 Aug)
  n: 512_000,
};

beforeEach(() => {
  vi.stubEnv('MASSIVE_API_KEY', 'mk-test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('authentication', () => {
  it('throws MissingApiKeyError without calling fetch when MASSIVE_API_KEY is unset', async () => {
    vi.stubEnv('MASSIVE_API_KEY', '');
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toBeInstanceOf(
      MissingApiKeyError,
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends the key as an Authorization: Bearer header and never in the URL', async () => {
    const mock = routedFetch([
      [GROUPED, () => jsonResponse({ resultsCount: 0, results: [] })],
    ]);
    vi.stubGlobal('fetch', mock);

    await fetchGroupedDaily('2026-07-31');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer mk-test-key');
    expect(url).not.toContain('mk-test-key');
    expect(url).not.toContain('apiKey');
  });
});

describe('fetchGroupedDaily', () => {
  it('requests the whole-market session summary with the 12h revalidate window', async () => {
    const mock = routedFetch([
      [GROUPED, () => jsonResponse({ resultsCount: 0, results: [] })],
    ]);
    vi.stubGlobal('fetch', mock);

    await fetchGroupedDaily('2026-07-31');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/2026-07-31?adjusted=true&include_otc=false',
    );
    expect(init.next).toEqual({ revalidate: 43_200, tags: ['massive'] });
  });

  it('maps upstream T/o/h/l/c/v/vw/n rows onto GroupedBar', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [GROUPED, () => jsonResponse({ resultsCount: 1, results: [groupedRow] })],
      ]),
    );

    const bars = await fetchGroupedDaily('2026-07-31');

    expect(bars).toEqual([
      {
        ticker: 'AAPL',
        open: 228.1,
        high: 235.5,
        low: 227.6,
        close: 234.9,
        volume: 52_000_000,
        vwap: 231.4,
        trades: 512_000,
      },
    ]);
  });

  it('returns an empty array when the session has no results (weekend or holiday)', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [GROUPED, () => jsonResponse({ status: 'OK', resultsCount: 0, queryCount: 0 })],
      ]),
    );

    await expect(fetchGroupedDaily('2026-08-01')).resolves.toEqual([]);
  });

  it('skips rows missing a ticker or a finite price', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          GROUPED,
          () =>
            jsonResponse({
              resultsCount: 4,
              results: [
                { v: 1_000_000, o: 10, c: 11, h: 12, l: 9, n: 5_000 }, // no T
                { T: 'BAD', v: 1_000_000, o: 10, c: null, h: 12, l: 9, n: 5_000 },
                { T: 'NAN', v: 1_000_000, o: 'x', c: 11, h: 12, l: 9, n: 5_000 },
                groupedRow,
              ],
            }),
        ],
      ]),
    );

    const bars = await fetchGroupedDaily('2026-07-31');

    expect(bars.map((b) => b.ticker)).toEqual(['AAPL']);
  });

  it('defaults a missing vw to null and a missing n to 0', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          GROUPED,
          () =>
            jsonResponse({
              resultsCount: 1,
              results: [{ T: 'THIN', v: 900_000, o: 6, c: 6.5, h: 6.7, l: 5.9 }],
            }),
        ],
      ]),
    );

    const [bar] = await fetchGroupedDaily('2026-07-31');

    expect(bar.vwap).toBeNull();
    expect(bar.trades).toBe(0);
  });
});

describe('error mapping', () => {
  it('throws RateLimitError on 429 and honours Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [GROUPED, () => jsonResponse({}, 429, { 'retry-after': '30' })],
      ]),
    );

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfterSeconds: 30,
    });
  });

  it('falls back to a 60s backoff when 429 carries no Retry-After', async () => {
    vi.stubGlobal('fetch', routedFetch([[GROUPED, () => jsonResponse({}, 429)]]));

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toMatchObject({
      retryAfterSeconds: 60,
    });
  });

  it('treats 403 as a rate-limit signal', async () => {
    vi.stubGlobal('fetch', routedFetch([[GROUPED, () => jsonResponse({}, 403)]]));

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('throws UpstreamError on 401 without retrying', async () => {
    const mock = routedFetch([
      [
        GROUPED,
        () => jsonResponse({ status: 'ERROR', error: 'Unknown API Key' }, 401),
      ],
    ]);
    vi.stubGlobal('fetch', mock);

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 401,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('throws UpstreamError on 5xx', async () => {
    vi.stubGlobal('fetch', routedFetch([[GROUPED, () => jsonResponse({}, 503)]]));

    await expect(fetchGroupedDaily('2026-07-31')).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});

describe('resolveTradingDate', () => {
  it('converts the prev-close end-of-window timestamp to a New York calendar date', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          PREV,
          () =>
            jsonResponse({
              resultsCount: 1,
              results: [{ T: 'SPY', c: 612.4, t: Date.UTC(2026, 6, 31, 20, 0, 0) }],
            }),
        ],
      ]),
    );

    await expect(resolveTradingDate()).resolves.toBe('2026-07-31');
  });

  it('subtracts one millisecond so a midnight-ET window end reports the session that just closed', async () => {
    // 2026-08-01T04:00:00Z is exactly 00:00 ET on Saturday 1 Aug — the END of Friday's
    // window. Without the -1ms guard this resolves one day late and the whole page
    // asks for a session that never traded.
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          PREV,
          () =>
            jsonResponse({
              resultsCount: 1,
              results: [{ T: 'SPY', c: 612.4, t: Date.UTC(2026, 7, 1, 4, 0, 0) }],
            }),
        ],
      ]),
    );

    await expect(resolveTradingDate()).resolves.toBe('2026-07-31');
  });

  it('walks back day by day when the probe returns no bar, stopping at the first session with rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-02T15:00:00Z')); // Sunday, 11:00 ET

    const mock = routedFetch([
      [PREV, () => jsonResponse({ status: 'OK', resultsCount: 0, results: [] })],
      [`${GROUPED}2026-08-01`, () => jsonResponse({ resultsCount: 0, results: [] })],
      [
        `${GROUPED}2026-07-31`,
        () => jsonResponse({ resultsCount: 1, results: [groupedRow] }),
      ],
    ]);
    vi.stubGlobal('fetch', mock);

    await expect(resolveTradingDate()).resolves.toBe('2026-07-31');
    expect(mock).toHaveBeenCalledTimes(3); // probe + Sat (empty) + Fri (hit)
  });

  it('throws NoSessionError after five empty walk-back days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-02T15:00:00Z'));

    const mock = routedFetch([
      [PREV, () => jsonResponse({ resultsCount: 0, results: [] })],
      [GROUPED, () => jsonResponse({ resultsCount: 0, results: [] })],
    ]);
    vi.stubGlobal('fetch', mock);

    await expect(resolveTradingDate()).rejects.toBeInstanceOf(NoSessionError);
    expect(mock).toHaveBeenCalledTimes(6); // probe + 5 walk-back days, then give up
  });
});

describe('fetchStockBars', () => {
  it('requests ascending daily bars with the 24h revalidate window', async () => {
    const mock = routedFetch([
      ['/v2/aggs/ticker/AAPL/range/', () => jsonResponse({ resultsCount: 0 })],
    ]);
    vi.stubGlobal('fetch', mock);

    await fetchStockBars('AAPL', '2025-07-31', '2026-07-31');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.massive.com/v2/aggs/ticker/AAPL/range/1/day/2025-07-31/2026-07-31?adjusted=true&sort=asc&limit=5000',
    );
    expect(init.next).toEqual({ revalidate: 86_400, tags: ['massive'] });
  });

  it('treats the range-bar timestamp as the START of the window and converts ms to UNIX seconds', async () => {
    const start = Date.UTC(2026, 6, 31, 4, 0, 0); // 00:00 ET on the session date itself
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          '/v2/aggs/ticker/AAPL/range/',
          () =>
            jsonResponse({
              resultsCount: 1,
              results: [
                { t: start, o: 228.1, h: 235.5, l: 227.6, c: 234.9, v: 52_000_000, vw: 231.4 },
              ],
            }),
        ],
      ]),
    );

    const bars = await fetchStockBars('AAPL', '2025-07-31', '2026-07-31');

    expect(bars).toEqual([
      {
        time: Math.floor(start / 1000),
        open: 228.1,
        high: 235.5,
        low: 227.6,
        close: 234.9,
        volume: 52_000_000,
        vwap: 231.4,
      },
    ]);
  });

  it('returns an empty array when the ticker has no bars', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          '/v2/aggs/ticker/DELISTED/range/',
          () => jsonResponse({ status: 'OK', resultsCount: 0, queryCount: 0 }),
        ],
      ]),
    );

    await expect(
      fetchStockBars('DELISTED', '2025-07-31', '2026-07-31'),
    ).resolves.toEqual([]);
  });
});

describe('fetchTickerName', () => {
  it('returns the company name', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          '/v3/reference/tickers/AAPL',
          () => jsonResponse({ results: { ticker: 'AAPL', name: 'Apple Inc.' } }),
        ],
      ]),
    );

    await expect(fetchTickerName('AAPL')).resolves.toBe('Apple Inc.');
  });

  it('returns null when the payload carries no name', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        ['/v3/reference/tickers/AAPL', () => jsonResponse({ results: {} })],
      ]),
    );

    await expect(fetchTickerName('AAPL')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the lookup fails', async () => {
    // Best-effort only: a missing company name must never fail the detail route.
    vi.stubGlobal(
      'fetch',
      routedFetch([['/v3/reference/tickers/AAPL', () => jsonResponse({}, 429)]]),
    );

    await expect(fetchTickerName('AAPL')).resolves.toBeNull();
  });
});
