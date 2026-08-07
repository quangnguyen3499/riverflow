'use client';

import { useEffect, useState } from 'react';

/** Returns Date.now(), re-rendering the caller every `intervalMs` milliseconds. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
