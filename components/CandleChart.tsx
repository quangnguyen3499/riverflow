'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CandleChartCanvas,
  type CandleChartHandle,
} from '@/components/CandleChartCanvas';
import { DataUnavailable } from '@/components/DataUnavailable';
import { fetchKlines } from '@/lib/market-data/rest';
import { wsManager } from '@/lib/market-data/ws-manager';
import type { Candle } from '@/lib/types';

const TIMEFRAMES = [
  { label: '1m', interval: '1m' },
  { label: '15m', interval: '15m' },
  { label: '1H', interval: '1h' },
  { label: '4H', interval: '4h' },
  { label: '1D', interval: '1d' },
] as const;

type Interval = (typeof TIMEFRAMES)[number]['interval'];

interface KlinePayload {
  k: { t: number; o: string; h: string; l: string; c: string };
}

export function CandleChart({ pair }: { pair: string }) {
  const canvasRef = useRef<CandleChartHandle>(null);
  const [tf, setTf] = useState<Interval>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    // Reset for the new pair/timeframe so a stale `candles` identity can never be handed
    // back to the canvas. Note the drawn series is NOT cleared here: the canvas only calls
    // setData on a non-empty array, so the previous candles stay painted under the loading
    // overlay until the new seed lands. That is intentional — it avoids a flash of empty
    // chart on every timeframe click. This is a reset-on-dependency-change, the same
    // sanctioned exception app/stocks/page.tsx takes.
    /* eslint-disable react-hooks/set-state-in-effect -- reset on pair/timeframe change, see above */
    setStatus('loading');
    setCandles([]);
    /* eslint-enable react-hooks/set-state-in-effect */
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    fetchKlines(pair, tf, 500)
      .then((loaded) => {
        if (disposed) return;
        setCandles(loaded);
        unsubscribe = wsManager.subscribe(
          `${pair.toLowerCase()}@kline_${tf}`,
          (data) => {
            const k = (data as KlinePayload).k;
            if (!k) return;
            // Live ticks go straight to the series — no React re-render per tick.
            canvasRef.current?.update({
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
            });
          },
        );
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [pair, tf, retryKey]);

  // No `pair === null` branch: every coin in the universe has a real spot pair by
  // construction, and a failed kline fetch is handled by CandleChartCanvas's error state.

  return (
    // min-w-0 is load-bearing: below `lg` the grid collapses to one auto-sized track, and the
    // canvas carries explicit pixel widths. Without this the ResizeObserver measures the width the
    // chart itself just set, latches, and can only ever grow — which scrolls the page sideways on a
    // phone. Do not remove.
    <div className="min-w-0 rounded-lg border border-border bg-panel p-3">
      <div className="mb-3 flex items-center gap-1">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.interval}
            onClick={() => setTf(t.interval)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tf === t.interval
                ? 'bg-panel2 text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <CandleChartCanvas
        ref={canvasRef}
        candles={candles}
        status={status}
        onRetry={() => setRetryKey((k) => k + 1)}
        errorNode={<DataUnavailable compact detail="Chart data unavailable." />}
      />
    </div>
  );
}
