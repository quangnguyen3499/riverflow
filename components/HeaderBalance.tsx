'use client';

import { useEffect, useState } from 'react';
import { formatUsd } from '@/lib/format';
import { usePortfolio } from '@/stores/portfolio';

export function HeaderBalance() {
  const cash = usePortfolio((s) => s.cash);
  // Hydration guard: `usePortfolio` rehydrates cash from localStorage on the client only, so markup
  // that printed a real balance during SSR would mismatch. The one-shot mount flag is the intended
  // pattern and the cascading render is the point — the second pass may disagree with the server.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount flag, see above
  useEffect(() => setMounted(true), []);

  return (
    <span
      title="Demo cash balance"
      className="rounded-full border border-border bg-panel px-3 py-1 font-mono text-xs text-accent"
    >
      {mounted ? formatUsd(cash) : '—'}
    </span>
  );
}
