'use client';

import { DataUnavailable } from '@/components/DataUnavailable';
import { MarketsTable } from '@/components/MarketsTable';
import { TrendingStrip } from '@/components/TrendingStrip';
import { useMarket } from '@/stores/market';

function TrendingSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-20 w-40 shrink-0 animate-pulse rounded-lg bg-panel"
        />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse border-b border-border bg-panel last:border-0"
        />
      ))}
    </div>
  );
}

export default function MarketsPage() {
  const coins = useMarket((s) => s.coins);
  const marketsError = useMarket((s) => s.marketsError);
  // The socket needs no REST call, so tickers can be full while the snapshot has failed. That case
  // is a NAMES-and-RANK failure, not a data failure, and MarketsTable renders it as a real table.
  const hasTickers = useMarket((s) => Object.keys(s.tickers).length > 0);

  // Only when BOTH upstreams are gone is there genuinely nothing to render. One honest panel
  // replaces the whole content area — never a skeleton that pulses forever, and never this panel
  // while ticking prices are available, which would make the "Live" badge beside it a lie.
  if (coins.length === 0 && marketsError && !hasTickers) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <DataUnavailable />
      </div>
    );
  }

  // Skeletons only while we are still legitimately waiting and have nothing from either source.
  const loading = coins.length === 0 && !hasTickers;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {loading ? (
        <>
          <TrendingSkeleton />
          <TableSkeleton />
        </>
      ) : (
        <>
          {/* The gainers strip needs `trending`, which only a snapshot produces — it renders its own
              honest empty line when there is none, so it stays mounted rather than being hidden. */}
          <TrendingStrip />
          <MarketsTable />
        </>
      )}
    </div>
  );
}
