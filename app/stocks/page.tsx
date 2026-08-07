'use client';

import { useCallback, useEffect, useState } from 'react';
import { DelayedBadge } from '@/components/DelayedBadge';
import { StocksErrorPanel } from '@/components/StocksErrorPanel';
import { StocksTable } from '@/components/StocksTable';
import type { StocksErrorCode, StocksPayload } from '@/lib/types';

const TABS = [
  { id: 'gainers', label: 'Top Gainers' },
  { id: 'losers', label: 'Top Losers' },
  { id: 'actives', label: 'Most Active' },
] as const;

type TabId = (typeof TABS)[number]['id'];

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

/** Today on the New York calendar, "YYYY-MM-DD". */
function nyToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function StocksPage() {
  const [data, setData] = useState<StocksPayload | null>(null);
  const [error, setError] = useState<StocksErrorCode | null>(null);
  const [tab, setTab] = useState<TabId>('gainers');

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const res = await fetch('/api/stocks');
      const body = (await res.json()) as Partial<StocksPayload> & {
        error?: StocksErrorCode;
      };
      if (!res.ok) {
        setError(body.error ?? 'upstream');
        return;
      }
      setData(body as StocksPayload);
    } catch {
      setError('upstream');
    }
  }, []);

  // The one fetch. It has to live in an effect: /api/stocks is read from the browser so the key
  // stays server-side, and switching tabs must not refetch. The rule fires because `load` clears
  // `error`/`data` before awaiting — on mount both are already null, so those two calls are no-ops
  // and the reset only does work on the Retry path, where re-showing the skeleton is the point.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only fetch, see above
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-sm font-bold tracking-widest">STOCKS</h1>
        {/* `undefined` until the payload lands — the badge then says which source answered
            rather than assuming the flattering one. */}
        <DelayedBadge mode={data?.mode} />
        <span className="ml-auto text-xs text-muted">US Equities</span>
      </div>

      {error !== null && (
        <StocksErrorPanel code={error} onRetry={() => void load()} />
      )}

      {error === null && data === null && (
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded bg-panel" />
          <div className="h-8 w-64 animate-pulse rounded bg-panel" />
          <div className="space-y-1 rounded-lg border border-border bg-panel p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-panel2" />
            ))}
          </div>
        </div>
      )}

      {data !== null && (
        <>
          {/* Which source answered is never left implicit. The fixture is the default
              (Massive's licence forbids publishing their data), so this branch is what a
              visitor to the deployed demo reads. */}
          {data.mode === 'fixture' ? (
            <p className="rounded border border-border bg-panel px-3 py-2 text-xs text-muted">
              <strong className="font-semibold text-text">
                Sample data — synthetic prices for demonstration.
              </strong>{' '}
              Every ticker, price and volume below is invented: these companies do not
              exist and none of these are real quotes. The ranking, filters and layout
              are the live ones, dated{' '}
              {formatSessionDate(data.sessionDate)} so the demo stays consistent.
              Connect a market-data key and set{' '}
              <code className="font-mono text-text">STOCKS_DATA_MODE=live</code> to run
              the real end-of-day integration locally.
            </p>
          ) : (
            <p className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              <strong className="font-semibold">End-of-day data.</strong> Showing the
              last completed US session —{' '}
              <strong className="font-semibold">
                close of {formatSessionDate(data.sessionDate)}
              </strong>
              {data.sessionDate !== nyToday() ? ' · US market closed' : ''}. Unlike the
              crypto pages, these prices do not tick live.
            </p>
          )}

          <div
            role="tablist"
            aria-label="Stock movers"
            className="flex items-center gap-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-panel2 text-text'
                    : 'text-muted hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <StocksTable rows={data[tab]} mode={data.mode} />

          <p className="text-xs text-muted">
            {data.mode === 'fixture'
              ? 'Ranked from a synthetic session summary by the same code path the live feed uses. '
              : 'Ranked from the full US equities session summary. '}
            Filtered to close ≥
            $5.00 and volume ≥ 500,000 to exclude illiquid microcaps. Change % is the
            session&rsquo;s open-to-close move.
            {data.filtered < 20
              ? ` Only ${data.filtered} tickers met the liquidity filter for this session.`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}
