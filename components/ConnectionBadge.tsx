'use client';

import type { ConnectionStatus } from '@/lib/types';
import { displayStatus, useMarket } from '@/stores/market';

const CONFIG: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-muted animate-pulse', text: 'text-muted' },
  streaming: { label: '⚡ Live', dot: 'bg-up', text: 'text-up' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-accent animate-pulse', text: 'text-accent' },
  polling: { label: 'Offline', dot: 'bg-muted', text: 'text-muted' },
};

const TITLE: Record<ConnectionStatus, string> = {
  connecting: 'Connecting to the market stream',
  streaming: 'Streaming live',
  reconnecting: 'Reconnecting to the market stream',
  polling: 'No live stream — prices are not updating. There is no fallback data source.',
};

export function ConnectionBadge() {
  // displayStatus, never raw `status`: an open socket with no coin universe is not "Live".
  // It returns a plain string, so it is safe to pass straight to a zustand selector.
  const status = useMarket(displayStatus);
  const { label, dot, text } = CONFIG[status];

  return (
    <span
      title={TITLE[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-medium ${text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
