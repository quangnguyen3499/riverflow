'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoinIcon } from '@/components/CoinIcon';
import { useMarket } from '@/stores/market';
import { coinLabel } from '@/lib/coin-names';
import { formatPercent, formatUsd } from '@/lib/format';
import type { CoinMarket } from '@/lib/types';

function PaletteRow({
  coin,
  active,
  onSelect,
  onHover,
}: {
  coin: CoinMarket;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  // ONE subscription per row, to a stable object reference — the same shape MarketRow uses, and for
  // the same reason. `coin.price`/`coin.change24h` come from the REST snapshot, which in a healthy
  // session is fetched ONCE at page load (the 5-minute re-rank deliberately rewrites only
  // volume24h/rank), so rendering them directly would ship a palette whose prices are right on
  // first paint and frozen forever. NEVER `priceFor(coin.id)` here either: it is get()-based and
  // creates no subscription at all.
  const t = useMarket((s) => s.tickers[coin.pair]);
  const price = t?.price ?? coin.price;
  const change =
    t && t.open24h > 0 ? ((t.price - t.open24h) / t.open24h) * 100 : coin.change24h;
  // coinLabel, not {coin.name} + {coin.symbol}: ~40% of the STORE has no display name (vs ~0-10%
  // of the visible top 50), and the palette searches the whole store — so this is one of the two
  // surfaces where the fallback shape actually shows. The naive pair prints the ticker twice
  // ("ERA  ERA").
  const { primary, secondary } = coinLabel(coin);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={onHover}
        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm ${
          active ? 'bg-panel2' : ''
        }`}
      >
        <CoinIcon symbol={coin.symbol} size={20} />
        <span className="font-medium text-text">{primary}</span>
        <span className="text-xs uppercase text-muted">{secondary}</span>
        <span className="ml-auto tabular-nums text-muted">{formatUsd(price)}</span>
        <span
          className={`w-16 text-right text-xs tabular-nums ${
            change >= 0 ? 'text-up' : 'text-down'
          }`}
        >
          {formatPercent(change)}
        </span>
      </button>
    </li>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const coins = useMarket((s) => s.coins);
  const snapshotAt = useMarket((s) => s.snapshotAt);
  const marketsError = useMarket((s) => s.marketsError);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // The query/highlight reset lives here, not in an `open`-dependent effect: ⌘K is the only
        // path that opens the palette, so this is observably identical to resetting on open (every
        // other path only ever closes, and the next open comes back through here). It also keeps
        // `react-hooks/set-state-in-effect` — an ERROR under this project's Next 16 config —
        // satisfied without suppressing it.
        setQuery('');
        setActive(0);
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focusing a DOM node is what effects are for. rAF waits for the freshly mounted input to
    // exist; cancelling on cleanup makes Strict Mode's double-invoke a no-op.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? coins.filter(
          (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q),
        )
      : coins;
    return list.slice(0, 8);
  }, [coins, query]);

  // `results.length === 0` is also true when the STORE is empty, so blaming the query there would
  // print `No coins match “”` — smart quotes around nothing, and a false explanation. Two ways in:
  // ⌘K in the few hundred ms before the first snapshot resolves, and permanently for a geo-blocked
  // or REST-failed visitor (the one Task 15 serves a tickers-only table to). Naming the real cause
  // is the whole point of this app's degraded states, so branch on WHY the list is empty.
  const emptyMessage =
    coins.length > 0
      ? `No coins match “${query}”`
      : snapshotAt === 0 && !marketsError
        ? 'Loading coins…'
        : 'Coin list unavailable';

  function select(index: number) {
    const coin = results[index];
    if (!coin) return;
    setOpen(false);
    router.push(`/coin/${coin.symbol}`);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(active);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search coins"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Search coins by name or symbol…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">{emptyMessage}</li>
          )}
          {results.map((coin, i) => (
            <PaletteRow
              key={coin.id}
              coin={coin}
              active={i === active}
              onSelect={() => select(i)}
              onHover={() => setActive(i)}
            />
          ))}
        </ul>
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
