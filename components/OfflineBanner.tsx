'use client';

import { displayStatus, useMarket } from '@/stores/market';

export function OfflineBanner() {
  const status = useMarket(displayStatus);
  const marketsError = useMarket((s) => s.marketsError);
  const snapshotAt = useMarket((s) => s.snapshotAt);

  if (status !== 'polling') return null;
  // No snapshot at all → <DataUnavailable /> is already saying more, and better.
  if (marketsError) return null;

  const at =
    snapshotAt > 0
      ? new Date(snapshotAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : null;

  return (
    <div
      role="status"
      className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"
    >
      {/* A TIMESTAMP, never a cadence. "Prices refresh every 30s" was false on every page: nothing
          refreshes every 30s any more, and the numbers on screen are simply frozen where they were. */}
      Live streaming unavailable — prices shown as of {at ?? 'the last snapshot'}. Paper trading still
      executes at the last known price.
    </div>
  );
}
