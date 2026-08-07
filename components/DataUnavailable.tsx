'use client';

import { useState } from 'react';
import { refreshSnapshot } from '@/hooks/use-market-feed';

// Kept as a JS string rather than JSX text so the apostrophes need no HTML entities.
const BODY =
  "Riverflow streams prices directly from the market data API, and your browser can't reach it " +
  'right now. The data source can be blocked by some regions, corporate networks, VPNs and ISP ' +
  'filters can block it too.';

const COMPACT_BODY = 'Live market data is unavailable — the data source is unreachable from your browser.';

function CloudOff({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M6.3 8.1A5 5 0 0 0 7 18h9" />
      <path d="M10.2 5.2A5 5 0 0 1 17 9a4 4 0 0 1 2.9 6.9" />
    </svg>
  );
}

export function DataUnavailable({
  compact = false,
  title,
  detail,
}: {
  compact?: boolean;
  title?: string;
  detail?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshSnapshot(true);
    } finally {
      setRetrying(false);
    }
  };

  if (compact) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-panel px-3 py-2 text-xs text-muted"
      >
        <CloudOff className="h-4 w-4 shrink-0" />
        <span>{detail ?? COMPACT_BODY}</span>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="cursor-pointer underline transition-colors hover:text-text disabled:cursor-default disabled:opacity-60"
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mx-auto flex max-w-[28rem] flex-col items-center gap-3 px-6 py-20 text-center"
    >
      <CloudOff className="h-10 w-10 text-muted" />
      <h2 className="text-base font-semibold text-text">
        {title ?? 'Live market data is unavailable'}
      </h2>
      <p className="text-sm leading-relaxed text-muted">{detail ?? BODY}</p>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
      >
        {retrying && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg/40 border-t-bg" />
        )}
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
      {/* Static text matching the hook's ERROR_RETRY_MS effect — no live countdown, so there is
          no clock that can desync from the actual retry. */}
      <p className="text-xs text-muted">Retrying automatically every 30 seconds.</p>
      <p className="font-mono text-[11px] text-muted opacity-70">
        Tried the configured market data hosts.
      </p>
    </div>
  );
}
