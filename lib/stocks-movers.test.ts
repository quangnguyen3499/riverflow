// lib/stocks-movers.test.ts
import { describe, expect, it } from 'vitest';
import type { GroupedBar } from '@/lib/massive';
import { MOVER_FILTERS, rankMovers } from '@/lib/stocks-movers';

/** A bar that comfortably passes every liquidity filter unless a field is overridden. */
function bar(over: Partial<GroupedBar> & { ticker: string }): GroupedBar {
  return {
    open: 100,
    high: 105,
    low: 99,
    close: 102,
    volume: 5_000_000,
    vwap: null,
    trades: 50_000,
    ...over,
  };
}

describe('rankMovers', () => {
  it('computes changePct as the session open-to-close move', () => {
    const { gainers } = rankMovers([bar({ ticker: 'AAA', open: 200, close: 220 })]);

    expect(gainers).toHaveLength(1);
    expect(gainers[0].changePct).toBeCloseTo(10, 10);
    expect(gainers[0].ticker).toBe('AAA');
  });

  it('excludes closes below the $5 floor', () => {
    // At $1 the gainers tab fills with sub-dollar shells posting +300%, and the page
    // reads as broken. $5 keeps the list to recognisable mid- and large-caps.
    const { gainers } = rankMovers([
      bar({ ticker: 'PENNY', open: 0.5, close: 0.8 }),
      bar({ ticker: 'REAL', open: 100, close: 101 }),
    ]);

    expect(gainers.map((r) => r.ticker)).toEqual(['REAL']);
  });

  it('excludes share volume below 500,000', () => {
    const { gainers } = rankMovers([
      bar({ ticker: 'THIN', volume: 400_000 }),
      bar({ ticker: 'REAL' }),
    ]);

    expect(gainers.map((r) => r.ticker)).toEqual(['REAL']);
  });

  it('excludes fewer than 1,000 trades', () => {
    const { gainers } = rankMovers([
      bar({ ticker: 'QUIET', trades: 200 }),
      bar({ ticker: 'REAL' }),
    ]);

    expect(gainers.map((r) => r.ticker)).toEqual(['REAL']);
  });

  it('excludes a zero or negative open instead of emitting Infinity or NaN', () => {
    const { gainers, losers, actives } = rankMovers([
      bar({ ticker: 'ZERO', open: 0, close: 42 }),
      bar({ ticker: 'REAL' }),
    ]);

    for (const row of [...gainers, ...losers, ...actives]) {
      expect(Number.isFinite(row.changePct)).toBe(true);
    }
    expect(gainers.map((r) => r.ticker)).toEqual(['REAL']);
  });

  it('sorts gainers descending, losers ascending, and caps both at 20', () => {
    // 25 candidates spanning -12% .. +12%
    const bars = Array.from({ length: 25 }, (_, i) =>
      bar({ ticker: `T${i}`, open: 100, close: 100 + (i - 12) }),
    );

    const { gainers, losers, filtered } = rankMovers(bars);

    expect(gainers).toHaveLength(MOVER_FILTERS.topN);
    expect(losers).toHaveLength(MOVER_FILTERS.topN);
    // `filtered` counts survivors BEFORE the top-20 slice — it drives the user-facing
    // "only n met the filter" note, so it must exceed topN here (25 > 20).
    expect(filtered).toBe(25);
    expect(filtered).toBeGreaterThan(MOVER_FILTERS.topN);
    expect(gainers[0].ticker).toBe('T24');
    expect(losers[0].ticker).toBe('T0');
    for (let i = 1; i < gainers.length; i += 1) {
      expect(gainers[i].changePct).toBeLessThanOrEqual(gainers[i - 1].changePct);
    }
    for (let i = 1; i < losers.length; i += 1) {
      expect(losers[i].changePct).toBeGreaterThanOrEqual(losers[i - 1].changePct);
    }
  });

  it('ranks Most Active by dollar volume, not share volume', () => {
    // Share volume would rank the cheapest surviving ticker first; under the "Most
    // Active" label a viewer expects NVDA/TSLA/AAPL, i.e. dollar volume.
    // BIG's vwap deliberately differs from its close so the assertion pins
    // `volume * vwap` and fails for `volume * close` ($800M).
    const { actives } = rankMovers([
      bar({ ticker: 'CHEAP', open: 6, close: 6, vwap: 5.5, volume: 20_000_000 }), // $110M
      bar({ ticker: 'BIG', open: 400, close: 400, vwap: 300, volume: 2_000_000 }), // $600M
    ]);

    expect(actives.map((r) => r.ticker)).toEqual(['BIG', 'CHEAP']);
    expect(actives[0].dollarVolume).toBe(600_000_000);
    expect(actives[1].dollarVolume).toBe(110_000_000);
  });

  it('falls back to close when vwap is null', () => {
    const { actives } = rankMovers([
      bar({ ticker: 'NOVW', close: 50, vwap: null, volume: 1_000_000 }),
    ]);

    expect(actives[0].dollarVolume).toBe(50_000_000);
  });

  it('reports how many tickers survived the filter', () => {
    const { filtered } = rankMovers([
      bar({ ticker: 'A' }),
      bar({ ticker: 'B' }),
      bar({ ticker: 'PENNY', close: 1 }),
    ]);

    expect(filtered).toBe(2);
  });
});
