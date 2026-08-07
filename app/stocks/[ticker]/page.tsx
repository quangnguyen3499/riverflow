'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DelayedBadge } from '@/components/DelayedBadge';
import { StockCandleChart } from '@/components/StockCandleChart';
import { StocksErrorPanel } from '@/components/StocksErrorPanel';
import { formatCompact, formatPercent, formatUsd } from '@/lib/format';
import type { Candle, StockDetail, StocksErrorCode } from '@/lib/types';

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  title?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted" title={title}>
        {label}
      </p>
      <p
        className={`font-mono text-sm ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** "2026-07-31" → "Fri 31 Jul 2026". Parsed as UTC so the label never shifts a day. */
function formatSessionDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(',', '');
}

export default function StockDetailPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker ?? '').toUpperCase();
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [error, setError] = useState<StocksErrorCode | null>(null);

  const load = useCallback(async () => {
    if (!ticker) return;
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(ticker)}`);
      const body = (await res.json()) as Partial<StockDetail> & {
        error?: StocksErrorCode;
      };
      if (!res.ok) {
        setError(body.error ?? 'upstream');
        return;
      }
      setDetail(body as StockDetail);
    } catch {
      setError('upstream');
    }
  }, [ticker]);

  // The one fetch. It has to live in an effect: /api/stocks/[ticker] is read from the browser so
  // the Massive key stays server-side. The rule fires because `load` clears `error`/`detail`
  // before awaiting — on mount both are already null, so those two calls are no-ops and the reset
  // only does work on the Retry path, where re-showing the skeleton is the point.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only fetch, see above
    void load();
  }, [load]);

  // Stable identity so the canvas only re-seeds when the payload actually changes.
  const candles = useMemo<Candle[]>(
    () =>
      detail
        ? detail.bars.map((b) => ({
            time: b.time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }))
        : [],
    [detail],
  );

  if (error !== null) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16">
        <StocksErrorPanel
          code={error}
          onRetry={error === 'not-found' ? undefined : () => void load()}
        />
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="h-20 animate-pulse rounded-lg bg-panel" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
          <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
        </div>
      </div>
    );
  }

  const change = detail.changePct;
  // No previous bar → no direction to colour. Leave the price untinted rather than
  // guessing green.
  const tone: 'up' | 'down' | undefined =
    change === null ? undefined : change < 0 ? 'down' : 'up';
  const priceClass =
    tone === 'down' ? 'text-down' : tone === 'up' ? 'text-up' : 'text-text';

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel2 text-sm font-semibold text-muted">
            {detail.ticker.charAt(0)}
          </span>
          <div>
            <h1 className="font-semibold leading-tight">{detail.ticker}</h1>
            <p className="text-xs text-muted">{detail.name ?? 'US Equity'}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted">Close</p>
          <p className="flex items-center gap-2">
            <span className={`font-mono text-lg leading-tight ${priceClass}`}>
              {formatUsd(detail.close)}
            </span>
            <DelayedBadge mode={detail.mode} />
          </p>
          <p className="text-xs text-muted">
            Session close · {formatSessionDate(detail.sessionDate)}
          </p>
        </div>
        <Stat
          label="Change"
            title="Close vs. the previous session's close (the movers table ranks by the session's own open-to-close move)"
          value={change !== null ? formatPercent(change) : '—'}
          tone={tone}
        />
        <Stat label="Day High" value={formatUsd(detail.high)} />
        <Stat label="Day Low" value={formatUsd(detail.low)} />
        <Stat label="Volume" value={formatCompact(detail.volume)} />
      </header>

      {/* The chart is the part §5(c) names explicitly, so the disclosure has to sit with it:
          in fixture mode both the header stats and every candle below are invented. */}
      {detail.mode === 'fixture' && (
        <p className="rounded border border-border bg-panel px-3 py-2 text-xs text-muted">
          <strong className="font-semibold text-text">
            Sample data — synthetic prices for demonstration.
          </strong>{' '}
          {detail.ticker} is an invented company, and every price and candle on this page
          was generated for this demo — none of it is a real quote. Connect a market-data
          key and set{' '}
          <code className="font-mono text-text">STOCKS_DATA_MODE=live</code> to run the
          real end-of-day integration locally.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The route 404s on an empty series, so 'ready' is the normal path; the
            'error' branch is the defensive case that surfaces the canvas's Retry. */}
        <StockCandleChart
          candles={candles}
          status={candles.length > 0 ? 'ready' : 'error'}
          onRetry={() => void load()}
        />
        <aside className="h-fit space-y-3 rounded-lg border border-border bg-panel p-4">
          <p className="text-sm font-semibold text-text">
            Trading unavailable for stocks
          </p>
          <p className="text-xs leading-relaxed text-muted">
            This demo executes paper trades at live prices. Stock data on the free
            tier is end-of-day only, so there is no live price to fill against. Crypto
            paper trading is fully functional.
          </p>
          <Link
            href="/"
            className="inline-block rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Browse crypto markets
          </Link>
        </aside>
      </div>
    </div>
  );
}
