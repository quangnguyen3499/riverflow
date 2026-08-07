'use client';

import { useEffect, useState } from 'react';
import { fetchKlines } from '@/lib/market-data/rest';
import { useMarket } from '@/stores/market';

/** 42 × 4h = exactly 7 days. Deliberately '4h' and not '1h': 168 hourly points into a ~120px
 *  sparkline is 4× the payload for sub-pixel detail nobody can see. Weight 2 per call, so even
 *  a 10-coin watchlist costs 20 weight in total. */
const INTERVAL = '4h';
const LIMIT = 42;
/**
 * Tab switches and re-renders must not refetch. SIXTY minutes, not fifteen: the series is built from
 * 4-HOUR candles, so nothing in it can change for up to four hours. A 15-minute TTL re-downloaded 42
 * identical closes three times an hour to redraw an identical line. Match the TTL to the data's
 * granularity; one hour is a comfortable quarter of it.
 */
const TTL_MS = 60 * 60_000;

/** Module-level, so it survives unmounts and route changes within the session. */
const cache = new Map<string, { at: number; points: number[] }>();

/**
 * Close prices for each pair, keyed by pair. A pair that is still loading or that failed is simply
 * ABSENT from the record — `<Sparkline points={[]} />` then draws its muted flat line, so callers
 * need no loading or error branch of their own.
 */
export function useSparklines(pairs: string[]): Record<string, number[]> {
  const marketsError = useMarket((s) => s.marketsError);
  const [points, setPoints] = useState<Record<string, number[]>>({});
  // Depend on a stable string, not the array identity, or this refires on every render.
  const key = pairs.join(',');

  useEffect(() => {
    // The data source is unreachable — do not hammer it with 10 more requests.
    if (marketsError) return;

    let cancelled = false;
    const wanted = key ? key.split(',') : [];
    const now = Date.now();

    const cached: Record<string, number[]> = {};
    const missing: string[] = [];
    for (const pair of wanted) {
      const hit = cache.get(pair);
      if (hit && now - hit.at < TTL_MS) cached[pair] = hit.points;
      else missing.push(pair);
    }
    // This set is load-bearing, not a cascading-render slip: it publishes state FROM an external
    // system (the module-level cache, which outlives unmounts) into React, which is the rule's own
    // sanctioned case. A remount after a route change starts with `points` empty while every pair
    // is still cached, so `missing` is empty and no fetch runs — drop this line and those rows draw
    // flat muted lines until the TTL expires.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishes the module cache, see above
    if (Object.keys(cached).length > 0) setPoints((prev) => ({ ...prev, ...cached }));
    if (missing.length === 0) return;

    void Promise.all(
      // Each request carries its own catch: one failing pair must not reject the others.
      missing.map((pair) =>
        fetchKlines(pair, INTERVAL, LIMIT)
          .then((candles) => [pair, candles.map((c) => c.close)] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, number[]> = {};
      for (const r of results) {
        if (!r) continue;
        cache.set(r[0], { at: Date.now(), points: r[1] });
        next[r[0]] = r[1];
      }
      if (Object.keys(next).length > 0) setPoints((prev) => ({ ...prev, ...next }));
    });

    return () => {
      cancelled = true;
    };
  }, [key, marketsError]);

  return points;
}
