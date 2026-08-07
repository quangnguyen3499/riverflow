// app/api/stocks/[ticker]/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockBar } from '@/lib/types';

vi.mock('@/lib/massive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/massive')>('@/lib/massive');
  return { ...actual, fetchStockBars: vi.fn(), fetchTickerName: vi.fn() };
});

import {
  fetchStockBars,
  fetchTickerName,
  MissingApiKeyError,
  minusDays,
  RateLimitError,
} from '@/lib/massive';
import { FIXTURE_SESSION, stockDetailFixture } from '@/lib/stocks-fixture';
import { GET, revalidate } from './route';

const DAY = 86_400;
const thursdayStart = Math.floor(Date.UTC(2026, 6, 30, 4, 0, 0) / 1000);

// THREE bars on purpose, with three distinguishable closes (210 / 228 / 234.9). With only
// two, `bars[0]` and `bars[bars.length - 2]` are the same element, so the route could read
// prevClose off the OLDEST bar — a year-old close in production, where fetchStockBars
// returns ~250 bars — and this suite would stay green.
const bars: StockBar[] = [
  {
    time: thursdayStart - DAY,
    open: 208,
    high: 212,
    low: 207,
    close: 210,
    volume: 39_000_000,
    vwap: 209.5,
  },
  {
    time: thursdayStart,
    open: 225,
    high: 229,
    low: 224,
    close: 228,
    volume: 44_000_000,
    vwap: 226.5,
  },
  {
    time: thursdayStart + DAY,
    open: 228.1,
    high: 235.5,
    low: 227.6,
    close: 234.9,
    volume: 52_000_000,
    vwap: 231.4,
  },
];

function call(ticker: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/stocks/${ticker}`), {
    params: Promise.resolve({ ticker }),
  });
}

beforeEach(() => {
  vi.mocked(fetchStockBars).mockReset();
  vi.mocked(fetchTickerName).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// The licence gate, on the route that also renders a CHART — §5(c) names charts explicitly as
// Derived Works, so the default here matters as much as it does on the movers route.
describe('GET /api/stocks/[ticker] — STOCKS_DATA_MODE gate', () => {
  const fixtureTicker = FIXTURE_SESSION[0].ticker;

  it('serves the synthetic detail, with ZERO upstream calls, when the var is UNSET', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);

    const res = await call(fixtureTicker);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe('fixture');
    expect(body.ticker).toBe(fixtureTicker);
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchTickerName)).not.toHaveBeenCalled();
    expect(body).toEqual(JSON.parse(JSON.stringify(stockDetailFixture(fixtureTicker))));
  });

  it('serves the fixture when the var is "fixture"', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'fixture');

    const body = await (await call(fixtureTicker.toLowerCase())).json();

    expect(body.mode).toBe('fixture');
    expect(body.ticker).toBe(fixtureTicker);
    expect(body.bars.length).toBeGreaterThanOrEqual(200);
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
  });

  it('serves the fixture even when MASSIVE_API_KEY is set', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);
    vi.stubEnv('MASSIVE_API_KEY', 'not-a-real-key');

    const body = await (await call(fixtureTicker)).json();

    expect(body.mode).toBe('fixture');
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
  });

  it.each(['LIVE', 'Live', ' live', 'live ', 'real', 'true', '1', ''])(
    'serves the fixture for %j — only the exact token opts in',
    async (value) => {
      vi.stubEnv('STOCKS_DATA_MODE', value);

      const body = await (await call(fixtureTicker)).json();

      expect(body.mode).toBe('fixture');
      expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
    },
  );

  it('404s in fixture mode for a well-formed ticker outside the synthetic universe', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'fixture');

    const res = await call('NOSUCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
  });

  it('calls upstream only when the var is exactly "live"', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
    vi.mocked(fetchStockBars).mockResolvedValue(bars);
    vi.mocked(fetchTickerName).mockResolvedValue(null);

    const body = await (await call('AAPL')).json();

    expect(body.mode).toBe('live');
    expect(vi.mocked(fetchStockBars)).toHaveBeenCalledTimes(1);
  });
});

// Everything below exercises the LIVE path, so each test opts in explicitly — the route's
// default is the fixture and would never touch these mocks.
describe('GET /api/stocks/[ticker]', () => {
  beforeEach(() => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
  });

  it('revalidates every 24 hours', () => {
    expect(revalidate).toBe(86_400);
  });

  it('returns a StockDetail built from the last two daily bars', async () => {
    vi.mocked(fetchStockBars).mockResolvedValue(bars);
    vi.mocked(fetchTickerName).mockResolvedValue('Apple Inc.');

    const res = await call('AAPL');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe('live');
    expect(body.ticker).toBe('AAPL');
    expect(body.name).toBe('Apple Inc.');
    expect(body.sessionDate).toBe('2026-07-31'); // derived from the last bar's start-of-window
    // Every header stat comes from the NEWEST bar…
    expect(body.open).toBe(228.1);
    expect(body.high).toBe(235.5);
    expect(body.low).toBe(227.6);
    expect(body.close).toBe(234.9);
    expect(body.volume).toBe(52_000_000);
    expect(body.vwap).toBe(231.4);
    // …and prevClose from the SECOND-NEWEST (228), not the oldest (210).
    expect(body.prevClose).toBe(228);
    expect(body.changePct).toBeCloseTo(((234.9 - 228) / 228) * 100, 10);
    // The whole series is passed through untouched, still ascending by time.
    expect(body.bars).toHaveLength(3);
    expect(body.bars.map((b: { close: number }) => b.close)).toEqual([210, 228, 234.9]);
    expect(body.bars.map((b: { time: number }) => b.time)).toEqual([
      thursdayStart - DAY,
      thursdayStart,
      thursdayStart + DAY,
    ]);

    const [ticker, from, to] = vi.mocked(fetchStockBars).mock.calls[0];
    expect(ticker).toBe('AAPL');
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from < to).toBe(true);
    // Pin the lookback window itself: the candlestick chart needs ~a year of daily
    // bars, so shrinking LOOKBACK_DAYS must fail here rather than silently emptying
    // the chart. `minusDays` here is the real implementation (kept by importActual).
    expect(from).toBe(minusDays(to, 365));
    expect(Date.parse(to) - Date.parse(from)).toBeGreaterThan(300 * 86_400_000);
  });

  it('normalises a lowercase ticker to uppercase', async () => {
    vi.mocked(fetchStockBars).mockResolvedValue(bars);
    vi.mocked(fetchTickerName).mockResolvedValue(null);

    const res = await call('aapl');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ticker).toBe('AAPL');
    expect(body.name).toBeNull();
    expect(vi.mocked(fetchStockBars).mock.calls[0][0]).toBe('AAPL');
  });

  it('returns 404 with zero upstream calls for a ticker containing digits', async () => {
    const res = await call('aapl123');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchTickerName)).not.toHaveBeenCalled();
  });

  it('returns 404 with zero upstream calls for an over-long ticker', async () => {
    const res = await call('ZZZZZZZ');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(vi.mocked(fetchStockBars)).not.toHaveBeenCalled();
  });

  it('returns 404 when the ticker has no bars (delisted)', async () => {
    vi.mocked(fetchStockBars).mockResolvedValue([]);

    const res = await call('DEAD');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(vi.mocked(fetchTickerName)).not.toHaveBeenCalled();
  });

  it('still returns 200 with name null when the name lookup rejects', async () => {
    vi.mocked(fetchStockBars).mockResolvedValue(bars);
    vi.mocked(fetchTickerName).mockRejectedValue(new RateLimitError(60));

    const res = await call('AAPL');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBeNull();
    expect(body.bars).toHaveLength(3);
  });

  it('returns null prevClose and changePct when only one bar exists', async () => {
    vi.mocked(fetchStockBars).mockResolvedValue([bars[bars.length - 1]]);
    vi.mocked(fetchTickerName).mockResolvedValue(null);

    const body = await (await call('NEW')).json();

    expect(body.prevClose).toBeNull();
    expect(body.changePct).toBeNull();
  });

  it('returns 503 {error:"no-key"} when the build has no API key', async () => {
    vi.mocked(fetchStockBars).mockRejectedValue(new MissingApiKeyError());

    const res = await call('AAPL');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no-key' });
  });

  it('returns 503 {error:"rate-limited"} when upstream rate-limits', async () => {
    vi.mocked(fetchStockBars).mockRejectedValue(new RateLimitError(60));

    const res = await call('AAPL');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'rate-limited' });
  });

  it('returns 502 {error:"upstream"} for any other failure', async () => {
    vi.mocked(fetchStockBars).mockRejectedValue(new Error('socket hang up'));

    const res = await call('AAPL');

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream' });
  });
});
