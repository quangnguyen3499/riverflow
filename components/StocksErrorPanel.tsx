'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StocksErrorCode } from '@/lib/types';

const COPY: Record<
  StocksErrorCode,
  { title: string; body: string; canRetry: boolean }
> = {
  'no-key': {
    title: 'Stock data not configured.',
    body: 'This build has no market-data key. The crypto pages are unaffected.',
    canRetry: false,
  },
  'rate-limited': {
    title: 'Rate limit reached.',
    body: 'The free data tier allows 5 requests per minute. Try again in a minute.',
    canRetry: true,
  },
  upstream: {
    title: 'Stock data temporarily unavailable.',
    body: 'The market-data provider did not respond. Nothing else on the site is affected.',
    canRetry: true,
  },
  'no-session': {
    title: 'Could not resolve the last trading session.',
    body: 'The provider reported no completed US session in the last five days.',
    canRetry: true,
  },
  'not-found': {
    title: 'Stock not found.',
    body: "That ticker is not in this demo's coverage.",
    canRetry: false,
  },
};

export function StocksErrorPanel({
  code,
  onRetry,
}: {
  code: StocksErrorCode;
  onRetry?: () => void;
}) {
  const copy = COPY[code];
  const [cooldown, setCooldown] = useState(code === 'rate-limited' ? 60 : 0);

  // A new error code restarts (or clears) the cooldown. `useState`'s initializer runs only on the
  // first mount, but this panel stays mounted across a code change (upstream → rate-limited renders
  // in the same slot), so without this resync a rate-limit error inherited a 0 cooldown and offered
  // an instant Retry against a 5-per-minute cap. One cascading render on a rare prop change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncs derived state to a prop, see above
    setCooldown(code === 'rate-limited' ? 60 : 0);
  }, [code]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const showRetry = copy.canRetry && onRetry !== undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-panel px-6 py-10 text-center">
      <p className="text-sm font-semibold text-text">{copy.title}</p>
      <p className="text-xs text-muted">{copy.body}</p>
      <div className="mt-1 flex items-center gap-4">
        <Link
          href="/"
          className="text-xs text-muted underline transition-colors hover:text-text"
        >
          Back to Markets
        </Link>
        {showRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={cooldown > 0}
            className="cursor-pointer rounded border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cooldown > 0 ? `Retry in ${cooldown}s` : 'Retry'}
          </button>
        )}
      </div>
    </div>
  );
}
