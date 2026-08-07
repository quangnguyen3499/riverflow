'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';

export function PriceCell({
  value,
  prev,
  stale,
}: {
  value: number;
  prev?: number;
  stale?: boolean;
}) {
  const lastValue = useRef(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; key: number } | null>(null);

  useEffect(() => {
    const reference = prev !== undefined ? prev : lastValue.current;
    if (value > reference) {
      setFlash((f) => ({ dir: 'up', key: (f?.key ?? 0) + 1 }));
    } else if (value < reference) {
      setFlash((f) => ({ dir: 'down', key: (f?.key ?? 0) + 1 }));
    }
    lastValue.current = value;
  }, [value, prev]);

  return (
    <span
      key={flash?.key ?? 0}
      className={[
        'rounded-sm px-1 tabular-nums',
        flash?.dir === 'up' ? 'animate-flash-up' : '',
        flash?.dir === 'down' ? 'animate-flash-down' : '',
        stale ? 'opacity-50' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {formatPrice(value)}
    </span>
  );
}
