// app/api/stocks/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupedBar } from '@/lib/massive';

vi.mock('@/lib/massive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/massive')>('@/lib/massive');
  return { ...actual, resolveTradingDate: vi.fn(), fetchGroupedDaily: vi.fn() };
});

import {
  fetchGroupedDaily,
  MissingApiKeyError,
  NoSessionError,
  RateLimitError,
  resolveTradingDate,
} from '@/lib/massive';
import { stocksFixture } from '@/lib/stocks-fixture';
import { GET, revalidate } from './route';

const session: GroupedBar[] = [
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
  {
    // Heaviest dollar volume (400M × $37.50 = $15.0B) as well as the biggest faller,
    // so the actives ordering cannot accidentally agree with the gainers ordering.
    ticker: 'INTC',
    open: 40,
    high: 40.2,
    low: 35.8,
    close: 36,
    volume: 400_000_000,
    vwap: 37.5,
    trades: 610_000,
  },
  {
    ticker: 'PENNY',
    open: 0.4,
    high: 0.9,
    low: 0.4,
    close: 0.8,
    volume: 40_000_000,
    vwap: 0.6,
    trades: 300_000,
  },
];

beforeEach(() => {
  vi.mocked(resolveTradingDate).mockReset();
  vi.mocked(fetchGroupedDaily).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// The licence gate. Massive's free tier forbids public display of its data, so the fixture is
// the DEFAULT and only the exact token "live" reaches upstream. These tests are the mechanism —
// before them the "STOCKS_DATA_MODE=fixture" safeguard existed only in the docs.
describe('GET /api/stocks — STOCKS_DATA_MODE gate', () => {
  const expected = stocksFixture();

  it('serves the synthetic fixture, with ZERO upstream calls, when the var is UNSET', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe('fixture');
    expect(vi.mocked(resolveTradingDate)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchGroupedDaily)).not.toHaveBeenCalled();
    expect(body.sessionDate).toBe(expected.sessionDate);
    expect(body.gainers).toEqual(expected.gainers);
    expect(body.losers).toEqual(expected.losers);
    expect(body.actives).toEqual(expected.actives);
    expect(body.filtered).toBe(expected.filtered);
  });

  it('serves the fixture when the var is "fixture"', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'fixture');

    const body = await (await GET()).json();

    expect(body.mode).toBe('fixture');
    expect(body.gainers).toEqual(expected.gainers);
    expect(vi.mocked(fetchGroupedDaily)).not.toHaveBeenCalled();
  });

  it('serves the fixture even when MASSIVE_API_KEY is set — a key must not opt a deployment in', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);
    vi.stubEnv('MASSIVE_API_KEY', 'not-a-real-key');

    const body = await (await GET()).json();

    expect(body.mode).toBe('fixture');
    expect(vi.mocked(resolveTradingDate)).not.toHaveBeenCalled();
  });

  it.each(['LIVE', 'Live', ' live', 'live ', 'real', 'true', '1', ''])(
    'serves the fixture for %j — only the exact token opts in',
    async (value) => {
      vi.stubEnv('STOCKS_DATA_MODE', value);

      const body = await (await GET()).json();

      expect(body.mode).toBe('fixture');
      expect(vi.mocked(resolveTradingDate)).not.toHaveBeenCalled();
      expect(vi.mocked(fetchGroupedDaily)).not.toHaveBeenCalled();
    },
  );

  it('calls upstream only when the var is exactly "live"', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
    vi.mocked(resolveTradingDate).mockResolvedValue('2026-07-31');
    vi.mocked(fetchGroupedDaily).mockResolvedValue(session);

    const body = await (await GET()).json();

    expect(body.mode).toBe('live');
    expect(vi.mocked(resolveTradingDate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchGroupedDaily)).toHaveBeenCalledTimes(1);
  });

  it('never leaks a fixture ticker into the live payload', async () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
    vi.mocked(resolveTradingDate).mockResolvedValue('2026-07-31');
    vi.mocked(fetchGroupedDaily).mockResolvedValue(session);

    const body = await (await GET()).json();
    const fixtureTickers = new Set(expected.gainers.map((r) => r.ticker));

    for (const row of body.gainers as Array<{ ticker: string }>) {
      expect(fixtureTickers.has(row.ticker)).toBe(false);
    }
  });
});

// Everything below exercises the LIVE path, so each test has to opt in explicitly — the
// route's default is the fixture and would never touch these mocks.
describe('GET /api/stocks', () => {
  beforeEach(() => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
  });

  it('revalidates every 12 hours', () => {
    expect(revalidate).toBe(43_200);
  });

  it('returns gainers, losers and actives from a single grouped-daily call', async () => {
    vi.mocked(resolveTradingDate).mockResolvedValue('2026-07-31');
    vi.mocked(fetchGroupedDaily).mockResolvedValue(session);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(vi.mocked(fetchGroupedDaily)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchGroupedDaily)).toHaveBeenCalledWith('2026-07-31');
    expect(body.mode).toBe('live');
    expect(body.sessionDate).toBe('2026-07-31');
    expect(typeof body.asOf).toBe('number');
    expect(body.filtered).toBe(2); // PENNY is filtered out below $5
    expect(body.gainers.map((r: { ticker: string }) => r.ticker)).toEqual(['AAPL', 'INTC']);
    expect(body.losers.map((r: { ticker: string }) => r.ticker)).toEqual(['INTC', 'AAPL']);
    expect(body.actives.map((r: { ticker: string }) => r.ticker)).toEqual(['INTC', 'AAPL']);
  });

  it('returns 502 {error:"no-session"} when the session summary is empty', async () => {
    vi.mocked(resolveTradingDate).mockResolvedValue('2026-08-01');
    vi.mocked(fetchGroupedDaily).mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'no-session' });
  });

  it('returns 503 {error:"no-key"} when the build has no API key', async () => {
    vi.mocked(resolveTradingDate).mockRejectedValue(new MissingApiKeyError());

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no-key' });
  });

  it('returns 503 {error:"rate-limited"} when upstream rate-limits', async () => {
    vi.mocked(resolveTradingDate).mockRejectedValue(new RateLimitError(60));

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'rate-limited' });
  });

  it('returns 502 {error:"no-session"} when the session cannot be resolved', async () => {
    vi.mocked(resolveTradingDate).mockRejectedValue(new NoSessionError());

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'no-session' });
  });

  it('returns 502 {error:"upstream"} for any other failure', async () => {
    vi.mocked(resolveTradingDate).mockRejectedValue(new Error('socket hang up'));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream' });
  });
});
