'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CoinIcon } from '@/components/CoinIcon';
import { DataUnavailable } from '@/components/DataUnavailable';
import { EmptyState } from '@/components/EmptyState';
import { PriceCell } from '@/components/PriceCell';
import { Sparkline } from '@/components/Sparkline';
import { useNow } from '@/hooks/use-now';
import { useSparklines } from '@/hooks/use-sparklines';
import { coinLabel, coinName } from '@/lib/coin-names';
import { formatPercent } from '@/lib/format';
import type { CoinMarket } from '@/lib/types';
import { useMarket } from '@/stores/market';
import { useWatchlist } from '@/stores/watchlist';

const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto_5rem_auto_auto] items-center gap-4 border-b border-border px-4 py-3 last:border-0';

function usePrevious(value: number): number | undefined {
  const ref = useRef<number | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  // Reading the ref during render IS the point: this returns the value from the previous commit so
  // PriceCell gets an explicit flash reference. Note PriceCell already keeps the same ref internally
  // and falls back to it when `prev` is omitted (which is what MarketsTable does), so this helper is
  // redundant rather than load-bearing — flagged for the plan owner.
  // eslint-disable-next-line react-hooks/refs -- previous committed value, see above
  return ref.current;
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      aria-label={`Remove ${name} from watchlist`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }}
      className="rounded px-2 py-1 text-muted transition-colors hover:bg-panel hover:text-down"
    >
      ✕
    </button>
  );
}

function WatchRow({
  coin,
  points,
  onRemove,
}: {
  coin: CoinMarket;
  points: number[];
  onRemove: () => void;
}) {
  const ticker = useMarket((s) => s.tickers[coin.pair]);
  const now = useNow(10_000);
  const price = ticker?.price ?? coin.price;
  const prev = usePrevious(price);
  const stale = ticker ? now - ticker.updatedAt > 60_000 : false;
  const change =
    ticker && ticker.open24h > 0
      ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
      : coin.change24h;

  const { primary, secondary } = coinLabel(coin);

  return (
    <Link href={`/coin/${coin.id}`} className={`${ROW} transition-colors hover:bg-panel2`}>
      <span className="flex min-w-0 items-center gap-3">
        <CoinIcon symbol={coin.symbol} size={24} />
        {/* Never the ticker twice: for an unnamed coin `primary` IS the ticker and `secondary`
            becomes the market pair. */}
        <span className="truncate font-medium">{primary}</span>
        <span className="text-xs uppercase text-muted">{secondary}</span>
      </span>
      <PriceCell value={price} prev={prev} stale={stale} />
      <span className={`text-right font-mono text-sm ${change >= 0 ? 'text-up' : 'text-down'}`}>
        {formatPercent(change)}
      </span>
      <Sparkline points={points} className="h-8 w-24" />
      <RemoveButton name={primary} onRemove={onRemove} />
    </Link>
  );
}

/** A starred id we cannot price: no snapshot, delisted, or a stale pre-rewrite localStorage entry. */
function UnresolvedRow({
  id,
  note,
  onRemove,
}: {
  id: string;
  note: string | null;
  onRemove: () => void;
}) {
  const dash = (
    <span className="text-right font-mono text-sm text-muted" title="Live prices unavailable">
      —
    </span>
  );
  return (
    <div className={ROW}>
      <span className="flex min-w-0 items-center gap-3">
        <CoinIcon symbol={id} size={24} />
        <span className="truncate font-medium">{coinName(id)}</span>
        <span className="text-xs uppercase text-muted">{id}</span>
        {note && <span className="shrink-0 text-xs text-muted opacity-70">{note}</span>}
      </span>
      {dash}
      {dash}
      <Sparkline points={[]} className="h-8 w-24" />
      <RemoveButton name={coinName(id)} onRemove={onRemove} />
    </div>
  );
}

export default function WatchlistPage() {
  const ids = useWatchlist((s) => s.ids);
  const toggle = useWatchlist((s) => s.toggle);
  const byId = useMarket((s) => s.byId);
  const coins = useMarket((s) => s.coins);
  const marketsError = useMarket((s) => s.marketsError);
  // Hydration guard: `useWatchlist` rehydrates the starred ids from localStorage on the client only,
  // so rows rendered during SSR would mismatch. The one-shot mount flag is the intended pattern and
  // the cascading render is the point — the second pass is the one allowed to disagree with the
  // server.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount flag, see above
  useEffect(() => setMounted(true), []);

  // All hooks run unconditionally, before any early return.
  const resolved = mounted
    ? ids.map((id) => byId[id]).filter((c): c is CoinMarket => c !== undefined)
    : [];
  // Issues no requests at all while marketsError is true (guarded inside the hook).
  const sparks = useSparklines(resolved.map((c) => c.pair));

  const heading = <h1 className="mb-4 text-lg font-semibold">Watchlist</h1>;

  // Genuinely still waiting for the first snapshot.
  if (!mounted || (ids.length > 0 && coins.length === 0 && !marketsError)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        {heading}
        <div className="overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse border-b border-border bg-panel last:border-0"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-6">
      {heading}
      {marketsError && <DataUnavailable compact />}
      {ids.length === 0 ? (
        // An empty watchlist is not an error and must never be replaced by one.
        <EmptyState
          title="No coins yet"
          body="⭐ Star coins on the Markets page to track them here."
          href="/"
          linkText="Browse Markets"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          {/* Column labels exist for ONE reason: the sparkline is a 7-day series sitting beside a
              24-hour percentage. Labelling both windows is the fix for their apparent disagreement —
              they are different measurements, not a contradiction. */}
          <div className={`${ROW} text-xs uppercase tracking-wider text-muted`} aria-hidden="true">
            <span>Coin</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h</span>
            <span className="text-center">7d</span>
            <span />
          </div>
          {ids.map((id) => {
            const coin = byId[id];
            if (!coin) {
              return (
                <UnresolvedRow
                  key={id}
                  id={id}
                  note={marketsError ? null : 'Not currently listed in the live market set'}
                  onRemove={() => toggle(id)}
                />
              );
            }
            return (
              <WatchRow
                key={id}
                coin={coin}
                points={sparks[coin.pair] ?? []}
                onRemove={() => toggle(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
