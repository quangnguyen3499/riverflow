'use client';

import { useEffect } from 'react';
import { fetchMarketSnapshot, rerank, tradablePairs } from '@/lib/market-data/markets';
import { GeoBlockedError } from '@/lib/market-data/rest';
import { wsManager } from '@/lib/market-data/ws-manager';
import type { LiveTicker } from '@/lib/types';
import { useMarket } from '@/stores/market';

/** Re-rank cadence. LOCAL — re-sorts the coins already in the store from the live ticker map and
 *  issues no request at all. Membership and rank are the only things REST adds, and rank is free. */
const RERANK_MS = 300_000;
/** Only a tab hidden longer than this can have missed a MEMBERSHIP change worth 278 KB to learn. */
const REFETCH_IDLE_MS = 900_000;
/** Retry cadence while marketsError is true. Fixed, not exponential — a weight-80 call every 30s
 *  is free, and a visitor staring at the error panel should see it heal quickly. */
const ERROR_RETRY_MS = 30_000;
/** A 'streaming' socket silent for this long after a tab wake is treated as dead. */
const ZOMBIE_SOCKET_MS = 60_000;
/** Floor between snapshot fetches, so tab-switching cannot spam a 278 KB download. */
const MIN_SNAPSHOT_GAP_MS = 30_000;

/** Pure mapper: raw `!miniTicker@arr` payload → LiveTicker[]. Malformed entries are skipped. */
export function mapMiniTickers(raw: unknown[]): LiveTicker[] {
  const out: LiveTicker[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.s !== 'string') continue;
    const price = Number(t.c);
    const open24h = Number(t.o);
    const high24h = Number(t.h);
    const low24h = Number(t.l);
    const volume24h = Number(t.q);
    const updatedAt = Number(t.E);
    if (![price, open24h, high24h, low24h, volume24h, updatedAt].every(Number.isFinite)) continue;
    out.push({ pair: t.s, price, open24h, high24h, low24h, volume24h, updatedAt });
  }
  return out;
}

/** Dev/demo switches, read from the URL. `?offline=1` demos the Offline badge with real prices
 *  frozen on screen (snapshot only, no socket); `?nodata=1` demos the unreachable state on
 *  all four pages, and must suppress BOTH upstreams — REST and the WebSocket — because either one
 *  alone is enough to paint a table. */
function readFlag(name: 'offline' | 'nodata'): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(name) === '1';
}

// READ ONCE, at module load, into consts. Calling readFlag() inside each effect is what let
// ?nodata=1 heal itself: the 30s error-retry effect fires exactly when marketsError is true, which
// is the state ?nodata=1 creates, so the "outage" demo silently repaired itself mid-presentation.
const QA_OFFLINE = readFlag('offline');
const QA_NODATA = readFlag('nodata');

let lastSnapshotAt = 0;
let lastHiddenAt = 0;

/** Clears the inter-snapshot throttle. For tests, and for a hard manual refresh. */
export function resetSnapshotThrottle(): void {
  lastSnapshotAt = 0;
}

/**
 * Re-rank the universe from the LIVE ticker map. Zero requests — `tickers[pair].volume24h` is the
 * same quoteVolume the ranking sorts by, pushed for every pair about once a second. Exported so the
 * timer, the visibility handler and the tests can all call it.
 *
 * Writes through `rerankCoins`, NOT `setCoins`, and that is load-bearing rather than stylistic.
 * `setCoins` stamps `snapshotAt: Date.now()`, but this re-rank is purely local: it touches
 * `volume24h` and `rank` only, never `price` or `change24h`. Through a REST snapshot at 10:00
 * followed by a network partition (`refreshSnapshot` then fails silently, and correctly, because
 * `coins.length !== 0`), the RERANK_MS timer would restamp `snapshotAt` at 10:05, 10:10, ... while
 * every price on screen stayed the frozen 10:00 value — so `OfflineBanner`'s "prices shown as of
 * HH:MM" would report seconds-old prices over ten-minute-old numbers. `rerankCoins` leaves the field
 * alone, which keeps it a true price age. Guarded by tests in both this file and stores/market.test.ts.
 */
export function rerankFromTickers(): void {
  const { coins, tickers } = useMarket.getState();
  if (coins.length === 0) return;
  useMarket.getState().rerankCoins(rerank(coins, tickers));
}

/**
 * Pull a fresh market snapshot into the store. Module-level and callable with no arguments so any
 * component can trigger it (the Retry button in `DataUnavailable` does). Writes go straight to the
 * global store, so a late response after unmount is a harmless idempotent write.
 *
 * `marketsError` keeps its exact original semantics: **true only when there is nothing to show.** A
 * failed refresh while a good snapshot is on screen stays silent — the snapshot's age is disclosed
 * in the UI instead. There is deliberately no `marketsErrorKind`: `GeoBlockedError` only fires when
 * EVERY host returns 451, and the mixed-failure visitors are exactly the geo-blocked ones, so
 * branching the copy on the error subclass would produce a LESS accurate message. One honest
 * message covers both; the subclass only refines the console log.
 */
export async function refreshSnapshot(force = false): Promise<void> {
  // Hard stop, not just an effect guard: nothing may repopulate the store in ?nodata=1 mode, or the
  // outage demo repairs itself. `force` must NOT override this — the Retry button is part of the demo.
  if (QA_NODATA) return;
  if (!force && Date.now() - lastSnapshotAt < MIN_SNAPSHOT_GAP_MS) return;
  try {
    const coins = await fetchMarketSnapshot();
    // Already-resolved memoised promise — this does NOT issue a second exchangeInfo request.
    const pairs = await tradablePairs();
    // ONE set(): coins + byId + trending + pairs + snapshotAt + marketsError:false. Four separate
    // setters meant four render passes and a transient store with new coins beside stale gainers.
    useMarket.getState().setSnapshot(coins, pairs);
    lastSnapshotAt = Date.now();
  } catch (e) {
    if (e instanceof GeoBlockedError) {
      console.info('[feed] Market data source returned 451 from every host — region blocked');
    }
    // NEVER setStatus here. `status` belongs to wsManager; a REST failure is not a socket event.
    // This is the fix for the non-sticky-polling bug — see Task 12 Step 8.
    if (useMarket.getState().coins.length === 0) useMarket.getState().setMarketsError(true);
  }
}

export function useMarketFeed(): void {
  const status = useMarket((s) => s.status);
  const marketsError = useMarket((s) => s.marketsError);

  // 1) Mount: one forced snapshot.
  useEffect(() => {
    if (QA_NODATA) {
      useMarket.getState().setMarketsError(true);
      return;
    }
    void refreshSnapshot(true);
  }, []);

  // 2) WebSocket: mirror status into the store, subscribe all-market mini tickers.
  useEffect(() => {
    // ?nodata=1 must skip the SOCKET too, not just REST. Suppressing `refreshSnapshot` alone does
    // not demo an outage any more: since Task 15 a failed snapshot with a live socket renders the
    // tickers-only table, so the real stream refilled `tickers` and the "unreachable market-data-source" demo
    // painted 50 live rows about a second after load. Unreachable means unreachable — no socket, so
    // `tickers` stays empty and MarketsTable's rows.length === 0 && marketsError branch yields
    // <DataUnavailable />.
    if (QA_OFFLINE || QA_NODATA) {
      // The ONE sanctioned setStatus outside wsManager.onStatus. Safe because these branches never
      // call connect(), so no socket and therefore no onStatus mirror exists to race with it.
      // Do NOT "fix" this — see Step 11a. 'polling' is also the honest status for both demos: no
      // live stream, and (in nodata) no fallback source either — exactly what the badge's title says.
      useMarket.getState().setStatus('polling');
      return;
    }
    const offStatus = wsManager.onStatus((s) => useMarket.getState().setStatus(s));
    useMarket.getState().setStatus(wsManager.status);
    // Subscribe BEFORE connect(). connect() builds the combined-stream URL from whatever streams
    // are registered at that moment, so connecting first would request `<host>/stream?streams=`
    // (empty) — which the real source rejects and closes. That close counts as a connection failure,
    // rotates hosts, and after 4 attempts drops a perfectly healthy visitor into 'polling'.
    const offTickers = wsManager.subscribe('!miniTicker@arr', (data) => {
      if (Array.isArray(data)) useMarket.getState().applyTickers(mapMiniTickers(data));
    });
    wsManager.connect();
    return () => {
      offTickers();
      offStatus();
    };
  }, []);

  // 3) Re-rank interval: every 5 minutes, LOCALLY. Issues no request — the socket has already
  //    delivered every volume figure the ranking needs.
  useEffect(() => {
    if (QA_NODATA) return;
    const id = setInterval(rerankFromTickers, RERANK_MS);
    return () => clearInterval(id);
  }, []);

  // 4) Error retry: while we have nothing to show, try every 30s. Cleared the moment it heals.
  //    The QA_NODATA gate is load-bearing: without it this effect fires exactly when ?nodata=1 is
  //    active and silently repairs the outage demo 30 seconds in.
  useEffect(() => {
    if (!marketsError || QA_NODATA) return;
    const id = setInterval(() => void refreshSnapshot(true), ERROR_RETRY_MS);
    return () => clearInterval(id);
  }, [marketsError]);

  // 5) Entering 'polling': the numbers are about to freeze, so make them as fresh as possible.
  useEffect(() => {
    if (status !== 'polling' || QA_NODATA) return;
    void refreshSnapshot(true);
  }, [status]);

  // 6) Tab visibility. On the way out, remember when. On the way back: re-fetch ONLY if we were
  //    away long enough for membership to have changed (>15 min) — otherwise just re-rank locally,
  //    because the socket has been pushing every number we display. Then replace the socket if it
  //    is nominally OPEN but has gone silent: connect() alone would see an open socket and no-op,
  //    leaving a dead stream in place.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        lastHiddenAt = Date.now();
        return;
      }
      const awayMs = lastHiddenAt > 0 ? Date.now() - lastHiddenAt : 0;
      if (awayMs > REFETCH_IDLE_MS) void refreshSnapshot();
      else rerankFromTickers();
      // Both QA switches leave effect 2 without a socket AND without a subscribed stream, so
      // falling through would call wsManager.connect() with an empty registry — which builds
      // `?streams=` (rejected by market-data-source) — and, in nodata mode, would open the very stream the
      // demo is asserting is unreachable the first time the tab is re-focused.
      if (QA_OFFLINE || QA_NODATA) return;
      if (
        useMarket.getState().status === 'streaming' &&
        Date.now() - useMarket.getState().lastMessageAt > ZOMBIE_SOCKET_MS
      ) {
        wsManager.disconnect();
      }
      wsManager.connect();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
