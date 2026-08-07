'use client';

import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { formatCompact, formatPercent, formatUsd } from '@/lib/format';
import type { StockRow } from '@/lib/types';

export function StocksTable({
  rows,
  mode,
}: {
  rows: StockRow[];
  // The column tag must follow the data's provenance. Labelling synthetic rows "DELAYED"
  // asserts they are genuine end-of-day quotes, which contradicts the sample-data banner.
  mode?: 'live' | 'fixture';
}) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No movers for this session"
        body="No tickers met the close ≥ $5 / volume ≥ 500k filter."
        href="/"
        linkText="Back to Markets"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-panel">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
            <th className="w-10 px-2 py-2">#</th>
            <th className="px-2 py-2">Symbol</th>
            <th className="px-2 py-2 text-right">
              Close
              <span
                title={
                  mode === 'fixture'
                    ? 'Synthetic sample prices — these are not real quotes.'
                    : 'End-of-day data — demo only. Not real-time.'
                }
                className="ml-1.5 rounded border border-border px-1 py-0.5 text-[10px] font-semibold tracking-wide text-muted"
              >
                {mode === 'fixture' ? 'SAMPLE' : 'DELAYED'}
              </span>
            </th>
            <th
              className="px-2 py-2 text-right"
              title="The session's open-to-close move"
            >
              Change %
            </th>
            <th className="px-2 py-2 text-right">Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.ticker}
              onClick={() => router.push(`/stocks/${row.ticker}`)}
              className="cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-panel2"
            >
              <td className="px-2 py-2 tabular-nums text-muted">{i + 1}</td>
              <td className="px-2 py-2 font-medium uppercase text-text">
                {row.ticker}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {formatUsd(row.close)}
              </td>
              <td
                className={`px-2 py-2 text-right tabular-nums ${
                  row.changePct >= 0 ? 'text-up' : 'text-down'
                }`}
              >
                {formatPercent(row.changePct)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-muted">
                {formatCompact(row.volume)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
