'use client';

import { useRouter } from 'next/navigation';
import { CoinIcon } from '@/components/CoinIcon';
import { formatPercent, formatUsd } from '@/lib/format';
import { coinLabel } from '@/lib/coin-names';
import type { CoinMarket } from '@/lib/types';
import { useMarket } from '@/stores/market';

function GainerChip({ coin, onOpen }: { coin: CoinMarket; onOpen: () => void }) {
  // ONE subscription per chip, to a stable object reference. This is what makes the chip tick.
  // `priceFor(coin.id)` here would read the store once and never re-render — the chip would show a
  // correct price on first paint and freeze, on the one strip whose point is that it is live.
  const t = useMarket((s) => s.tickers[coin.pair]);
  const price = t?.price ?? coin.price;
  const change =
    t && t.open24h > 0 ? ((t.price - t.open24h) / t.open24h) * 100 : coin.change24h;
  // The chip already prints the ticker as its main label, so the muted sub-line must never repeat it.
  // `coinLabel`'s primary IS the ticker whenever `coinName` fell back (and for the audited self-titled
  // entries like U / COTI), so take `secondary` in that case: "Bitcoin" for named coins, "ERA/USDT" for
  // unmapped ones — which is exactly what lib/coin-names.ts prescribes for a fallback row.
  const { primary, secondary } = coinLabel(coin);
  const sub = primary === coin.symbol.toUpperCase() ? secondary : primary;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-[150px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-panel px-3 py-2 text-left hover:bg-panel2"
    >
      <span className="flex items-center gap-2">
        <CoinIcon symbol={coin.symbol} size={20} />
        {/* The ticker is the right main label on a chip this small. `sub` below is chosen so it is
            never the same string as this one. */}
        <span className="text-sm font-semibold uppercase text-text">{coin.symbol}</span>
      </span>
      <span className="truncate text-[10px] text-muted" title={sub}>
        {sub}
      </span>
      <span className="text-sm tabular-nums text-text">{formatUsd(price)}</span>
      <span className={`text-xs tabular-nums ${change >= 0 ? 'text-up' : 'text-down'}`}>
        {formatPercent(change)}
      </span>
    </button>
  );
}

export function TrendingStrip() {
  const trending = useMarket((s) => s.trending);
  const router = useRouter();

  return (
    <section aria-label="Top gainers">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Top gainers</h2>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted opacity-70">
          24h
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-xs text-muted">
        USDT markets over $2M 24h volume, up at least 2%.
      </p>

      {trending.length === 0 ? (
        <p className="text-sm text-muted">No market is up more than 2% over the last 24 hours.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {trending.map((coin) => (
            <GainerChip
              key={coin.id}
              coin={coin}
              onOpen={() => router.push(`/coin/${coin.id}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
