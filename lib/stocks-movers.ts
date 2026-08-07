// lib/stocks-movers.ts
//
// Pure ranking over one grouped-daily session summary. No network, no React — every
// decision that makes the movers tables look credible is unit-testable here.
import type { GroupedBar } from '@/lib/massive';
import type { StockRow } from '@/lib/types';

/**
 * The $5 floor is deliberately stricter than Massive's own paid movers endpoint.
 * At $1 the gainers tab fills with sub-dollar shells posting +300% on 600k shares;
 * at $5 with 500k shares and 1,000 trades the list is recognisable mid- and large-caps.
 */
export const MOVER_FILTERS = {
  minClose: 5,
  minVolume: 500_000,
  minTrades: 1_000,
  topN: 20,
} as const;

export interface RankedMovers {
  gainers: StockRow[];
  losers: StockRow[];
  actives: StockRow[];
  /** Tickers that survived the liquidity filter (before the top-20 slice). */
  filtered: number;
}

export function rankMovers(bars: GroupedBar[]): RankedMovers {
  const rows: StockRow[] = [];

  for (const b of bars) {
    // open <= 0 would produce Infinity/NaN; the rest is the liquidity filter.
    if (b.open <= 0) continue;
    if (b.close < MOVER_FILTERS.minClose) continue;
    if (b.volume < MOVER_FILTERS.minVolume) continue;
    if (b.trades < MOVER_FILTERS.minTrades) continue;

    rows.push({
      ticker: b.ticker,
      open: b.open,
      close: b.close,
      changePct: ((b.close - b.open) / b.open) * 100,
      volume: b.volume,
      dollarVolume: b.volume * (b.vwap ?? b.close),
    });
  }

  return {
    gainers: [...rows]
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, MOVER_FILTERS.topN),
    losers: [...rows]
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, MOVER_FILTERS.topN),
    // Dollar volume, not share volume — see the test for why.
    actives: [...rows]
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .slice(0, MOVER_FILTERS.topN),
    filtered: rows.length,
  };
}
