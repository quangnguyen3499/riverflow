'use client';

import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/lib/types';

export interface CandleChartHandle {
  update(candle: Candle): void;
}

export interface CandleChartCanvasProps {
  /** UNIX seconds, ascending. Empty while loading. */
  candles: Candle[];
  status: 'loading' | 'ready' | 'error';
  /** Omitted → no Retry button in the error overlay. */
  onRetry?: () => void;
  /** Replaces the default error message. The crypto wrapper passes
   *  `<DataUnavailable compact detail="Chart data unavailable." />` (Task 19); the stock wrapper
   *  omits it, because that component's Retry re-fetches the market-data source snapshot. */
  errorNode?: ReactNode;
  height?: number;
  ref?: Ref<CandleChartHandle>;
}

function toSeriesPoint(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

export function CandleChartCanvas({
  candles,
  status,
  onRetry,
  errorNode,
  height = 420,
  ref,
}: CandleChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // 1) Create / destroy the chart. lightweight-charts is client-only and Strict Mode
  //    runs this twice in dev, so the cleanup must fully remove the chart.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { color: '#161a1e' },
        textColor: '#848e9c',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: '#1e2329' },
        horzLines: { color: '#1e2329' },
      },
      rightPriceScale: { borderColor: '#2b3139' },
      timeScale: {
        borderColor: '#2b3139',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderUpColor: '#0ecb81',
      borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    resize.observe(el);

    return () => {
      resize.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // 2) Re-seed the series whenever the candles array identity changes (new timeframe,
  //    new ticker, new client-side range slice).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles.map(toSeriesPoint));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useImperativeHandle(
    ref,
    () => ({
      update(candle: Candle) {
        seriesRef.current?.update(toSeriesPoint(candle));
      },
    }),
    [],
  );

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full" style={{ height }} />
      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/70">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel/95 px-4">
          {errorNode ?? <p className="text-sm text-muted">Failed to load chart data</p>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded bg-panel2 px-4 py-1.5 text-sm text-text transition-colors hover:bg-border"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
