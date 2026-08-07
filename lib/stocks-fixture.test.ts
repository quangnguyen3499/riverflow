// lib/stocks-fixture.test.ts
//
// The fixture is the DEFAULT source for the stocks page, so it is load-bearing: if it is
// internally inconsistent the public demo shows an impossible market. These tests pin the
// invariants a real session summary would satisfy — plus the one that matters legally:
// the data must be synthetic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nyDate } from '@/lib/massive';
import {
  FIXTURE_SESSION,
  STOCKS_FIXTURE_SESSION_DATE,
  stockDetailFixture,
  stocksDataMode,
  stocksFixture,
} from '@/lib/stocks-fixture';
import { MOVER_FILTERS } from '@/lib/stocks-movers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('stocksDataMode', () => {
  it('defaults to fixture when STOCKS_DATA_MODE is unset', () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);
    expect(stocksDataMode()).toBe('fixture');
  });

  it('is fixture when set to fixture', () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'fixture');
    expect(stocksDataMode()).toBe('fixture');
  });

  it('is live only for exactly "live"', () => {
    vi.stubEnv('STOCKS_DATA_MODE', 'live');
    expect(stocksDataMode()).toBe('live');
  });

  it.each(['LIVE', 'Live', ' live', 'live ', 'real', '1', 'true', ''])(
    'falls back to fixture for %j (fail-safe: only the exact token opts in)',
    (value) => {
      vi.stubEnv('STOCKS_DATA_MODE', value);
      expect(stocksDataMode()).toBe('fixture');
    },
  );

  it('ignores MASSIVE_API_KEY — having a key must not opt a deployment in', () => {
    vi.stubEnv('STOCKS_DATA_MODE', undefined);
    vi.stubEnv('MASSIVE_API_KEY', 'not-a-real-key');
    expect(stocksDataMode()).toBe('fixture');
  });
});

describe('stocksFixture', () => {
  const payload = stocksFixture();

  it('declares itself as fixture data', () => {
    expect(payload.mode).toBe('fixture');
  });

  it('reports a fixed weekday session date', () => {
    expect(payload.sessionDate).toBe(STOCKS_FIXTURE_SESSION_DATE);
    const [y, m, d] = STOCKS_FIXTURE_SESSION_DATE.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    expect(dow).toBeGreaterThanOrEqual(1); // never a Sunday…
    expect(dow).toBeLessThanOrEqual(5); // …nor a Saturday
  });

  it('stamps asOf with the moment it was built', () => {
    const before = Date.now();
    const asOf = stocksFixture().asOf;
    expect(asOf).toBeGreaterThanOrEqual(before);
    expect(asOf).toBeLessThanOrEqual(Date.now());
  });

  it('fills all three tabs with 20 rows', () => {
    expect(payload.gainers).toHaveLength(20);
    expect(payload.losers).toHaveLength(20);
    expect(payload.actives).toHaveLength(20);
    expect(payload.filtered).toBe(FIXTURE_SESSION.length);
  });

  it('is SYNTHETIC — no real listed ticker appears (a real snapshot would be a licensed derived work)', () => {
    const real = new Set([
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'BRK.B',
      'JPM', 'V', 'INTC', 'AMD', 'NFLX', 'SPY', 'QQQ', 'F', 'T', 'KO', 'DIS',
    ]);
    for (const bar of FIXTURE_SESSION) {
      expect(real.has(bar.ticker)).toBe(false);
    }
  });

  it('uses tickers the detail route accepts (1–6 chars, A–Z) and never repeats one', () => {
    const seen = new Set<string>();
    for (const bar of FIXTURE_SESSION) {
      expect(bar.ticker).toMatch(/^[A-Z][A-Z.]{0,5}$/);
      expect(seen.has(bar.ticker)).toBe(false);
      seen.add(bar.ticker);
    }
    expect(seen.size).toBe(FIXTURE_SESSION.length);
  });

  it('has internally consistent OHLCV on every session bar', () => {
    for (const bar of FIXTURE_SESSION) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.low).toBeGreaterThan(0);
      expect(bar.vwap).not.toBeNull();
      expect(bar.vwap as number).toBeGreaterThanOrEqual(bar.low);
      expect(bar.vwap as number).toBeLessThanOrEqual(bar.high);
      // Every row must clear the same liquidity filter the live path applies, or the
      // fixture would silently ship fewer than 20 rows per tab.
      expect(bar.close).toBeGreaterThanOrEqual(MOVER_FILTERS.minClose);
      expect(bar.volume).toBeGreaterThanOrEqual(MOVER_FILTERS.minVolume);
      expect(bar.trades).toBeGreaterThanOrEqual(MOVER_FILTERS.minTrades);
    }
  });

  it('ranks gainers strictly down, losers strictly up, actives by dollar volume', () => {
    const changes = payload.gainers.map((r) => r.changePct);
    expect([...changes].sort((a, b) => b - a)).toEqual(changes);
    expect(changes.every((c) => c > 0)).toBe(true);

    const losses = payload.losers.map((r) => r.changePct);
    expect([...losses].sort((a, b) => a - b)).toEqual(losses);
    expect(losses.every((c) => c < 0)).toBe(true);

    const dollars = payload.actives.map((r) => r.dollarVolume);
    expect([...dollars].sort((a, b) => b - a)).toEqual(dollars);
  });

  it('never shows the same ticker as both a top gainer and a top loser', () => {
    const gainers = new Set(payload.gainers.map((r) => r.ticker));
    for (const row of payload.losers) {
      expect(gainers.has(row.ticker)).toBe(false);
    }
  });

  it('orders actives differently from gainers, so the tabs are visibly distinct', () => {
    expect(payload.actives.map((r) => r.ticker)).not.toEqual(
      payload.gainers.map((r) => r.ticker),
    );
  });

  it('is deterministic — two calls return identical rows', () => {
    expect(stocksFixture().gainers).toEqual(payload.gainers);
    expect(stocksFixture().actives).toEqual(payload.actives);
  });
});

describe('stockDetailFixture', () => {
  const ticker = FIXTURE_SESSION[0].ticker;

  it('returns null for a ticker that is not in the fixture universe', () => {
    expect(stockDetailFixture('NOSUCH')).toBeNull();
  });

  it('accepts a lowercase ticker and answers in uppercase', () => {
    const detail = stockDetailFixture(ticker.toLowerCase());
    expect(detail?.ticker).toBe(ticker);
  });

  it('declares itself as fixture data and carries an invented company name', () => {
    const detail = stockDetailFixture(ticker)!;
    expect(detail.mode).toBe('fixture');
    expect(typeof detail.name).toBe('string');
    expect((detail.name as string).length).toBeGreaterThan(0);
  });

  it('agrees with the movers row for the same session', () => {
    const row = FIXTURE_SESSION[0];
    const detail = stockDetailFixture(ticker)!;
    expect(detail.sessionDate).toBe(STOCKS_FIXTURE_SESSION_DATE);
    expect(detail.open).toBe(row.open);
    expect(detail.high).toBe(row.high);
    expect(detail.low).toBe(row.low);
    expect(detail.close).toBe(row.close);
    expect(detail.volume).toBe(row.volume);
    expect(detail.vwap).toBe(row.vwap);
  });

  it('returns a long ascending daily series whose last bar is that session', () => {
    const detail = stockDetailFixture(ticker)!;
    expect(detail.bars.length).toBeGreaterThanOrEqual(200);

    for (let i = 1; i < detail.bars.length; i++) {
      expect(detail.bars[i].time).toBeGreaterThan(detail.bars[i - 1].time);
    }

    const last = detail.bars[detail.bars.length - 1];
    expect(last.close).toBe(detail.close);
    expect(last.open).toBe(detail.open);
    // The detail route derives sessionDate from the newest bar's start-of-window, so the
    // fixture's timestamps have to land on midnight New York of the session date.
    expect(nyDate(last.time * 1000)).toBe(STOCKS_FIXTURE_SESSION_DATE);
  });

  it('has only weekday bars with consistent, positive OHLC', () => {
    const detail = stockDetailFixture(ticker)!;
    for (const bar of detail.bars) {
      expect(bar.low).toBeGreaterThan(0);
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.volume).toBeGreaterThan(0);
      const dow = new Date(bar.time * 1000).getUTCDay();
      expect(dow === 0 || dow === 6).toBe(false);
    }
  });

  it('derives prevClose and changePct from the second-newest bar', () => {
    const detail = stockDetailFixture(ticker)!;
    const prev = detail.bars[detail.bars.length - 2];
    expect(detail.prevClose).toBe(prev.close);
    expect(detail.changePct).toBeCloseTo(
      ((detail.close - prev.close) / prev.close) * 100,
      10,
    );
  });

  it('is deterministic — the same ticker yields the same series every call', () => {
    expect(stockDetailFixture(ticker)).toEqual(stockDetailFixture(ticker));
  });

  it('gives different tickers different series', () => {
    const a = stockDetailFixture(FIXTURE_SESSION[0].ticker)!;
    const b = stockDetailFixture(FIXTURE_SESSION[1].ticker)!;
    expect(a.bars.map((x) => x.close)).not.toEqual(b.bars.map((x) => x.close));
  });

  it('covers every ticker the movers tables can link to', () => {
    for (const bar of FIXTURE_SESSION) {
      expect(stockDetailFixture(bar.ticker)).not.toBeNull();
    }
  });
});
