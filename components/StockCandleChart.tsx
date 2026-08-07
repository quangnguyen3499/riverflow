'use client';

import { useMemo, useState } from 'react';
import { CandleChartCanvas } from '@/components/CandleChartCanvas';
import type { Candle } from '@/lib/types';

/** Approximate trading days per window; 0 means "everything that was loaded". */
const RANGES = [
  { label: '1M', bars: 22 },
  { label: '3M', bars: 66 },
  { label: '6M', bars: 132 },
  { label: '1Y', bars: 0 },
] as const;

type RangeLabel = (typeof RANGES)[number]['label'];

export function StockCandleChart({
  candles,
  status,
  onRetry,
}: {
  candles: Candle[];
  status: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
}) {
  const [range, setRange] = useState<RangeLabel>('1Y');

  const visible = useMemo(() => {
    const found = RANGES.find((r) => r.label === range);
    if (!found || found.bars === 0) return candles;
    return candles.slice(-found.bars);
  }, [candles, range]);

  return (
    // min-w-0: see the same note in CandleChart.tsx — without it the chart latches at its widest
    // measured size and the page scrolls sideways below the `lg` breakpoint.
    <div className="min-w-0 rounded-lg border border-border bg-panel p-3">
      <div className="mb-3 flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => setRange(r.label)}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              range === r.label
                ? 'bg-panel2 text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <CandleChartCanvas candles={visible} status={status} onRetry={onRetry} />
    </div>
  );
}
