'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CandleChart } from '@/components/CandleChart';
import { CoinIcon } from '@/components/CoinIcon';
import { DataUnavailable } from '@/components/DataUnavailable';
import { EmptyState } from '@/components/EmptyState';
import { TradePanel } from '@/components/TradePanel';
import { useNow } from '@/hooks/use-now';
import { coinLabel } from '@/lib/coin-names';
import { formatCompact, formatPercent, formatUsd } from '@/lib/format';
import { displayStatus, useMarket } from '@/stores/market';

function Stat({
  label,
  value,
  tone,
  dim,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  dim?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`font-mono text-sm ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        } ${dim ? 'opacity-50' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function CoinPage() {
  const params = useParams<{ symbol: string }>();
  // The folder is named [symbol] for historical reasons; the value IS the coin id.
  const id = (params?.symbol ?? '').toLowerCase();
  const coin = useMarket((s) => s.byId[id]);
  const coins = useMarket((s) => s.coins);
  const marketsError = useMarket((s) => s.marketsError);
  // THE live subscription for this page. Stable object reference, so no render loop, and every
  // number in the header below derives from it. priceFor/changeFor are deliberately NOT used here:
  // they are get()-based, create no subscription, and would freeze the header after first paint.
  const ticker = useMarket((s) => (coin ? s.tickers[coin.pair] : undefined));
  const status = useMarket(displayStatus);
  const lastMessageAt = useMarket((s) => s.lastMessageAt);
  const now = useNow(5000);

  // The snapshot failed with nothing cached. We do not know this coin's name, pair or price, so
  // there is no page to render — and no fallback source to try. Say so; do NOT 404.
  if (!coin && marketsError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <DataUnavailable />
        <p className="mt-2 text-center text-sm">
          <Link href="/" className="text-accent underline hover:opacity-80">
            ← Back to markets
          </Link>
        </p>
      </div>
    );
  }

  // Still waiting for the first snapshot.
  if (!coin && coins.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="h-16 animate-pulse rounded-lg bg-panel" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
          <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
        </div>
      </div>
    );
  }

  // Snapshot is present and this id is genuinely not in it: no USDT market, under the $1M floor, or
  // filtered out as a non-crypto asset. With a ~100-115-coin crypto universe this is COMMON —
  // /coin/sei and /coin/tia land here from our own name map, /coin/usdc and /coin/nvdab from the
  // crypto-only filter — so it must read as an answer, not as a failure. EmptyState, never
  // DataUnavailable: no cloud-off glyph, no "Try again", no red. The marketsError branch above is
  // what keeps the two distinct.
  if (!coin) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16">
        <EmptyState
          title="Not a crypto USDT market in this universe"
          // All three clauses are needed. USDC lands here and DOES have a huge USDT market, so the
          // shorter copy ("no USDT spot market in this universe") would be a false statement.
          body={`"${id.toUpperCase()}" has no USDT spot market in this universe, trades under $1M a day, or is not a crypto asset — stablecoins, fiat and tokenized equities are excluded from this table.`}
          href="/"
          linkText="Back to Markets"
        />
      </div>
    );
  }

  // Derived from the ONE subscribed ticker object, not from priceFor/changeFor: those are get()-based
  // and create no subscription, so the header price would paint once and then freeze.
  const price = ticker?.price ?? coin.price;
  const change =
    ticker && ticker.open24h > 0
      ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
      : coin.change24h;
  const high = ticker?.high24h ?? coin.high24h;
  const low = ticker?.low24h ?? coin.low24h;
  const volume = ticker?.volume24h ?? coin.volume24h;
  const stale = status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;
  const { primary } = coinLabel(coin);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <CoinIcon symbol={coin.symbol} size={32} />
          <div>
            {/* coinLabel's primary is the display name, or the bare ticker when there is none —
                never the ticker printed twice. The pair is already the natural second line here. */}
            <h1 className="font-semibold leading-tight">{primary}</h1>
            <p className="text-xs uppercase text-muted">{coin.pair}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted">Price</p>
          <p
            className={`font-mono text-lg leading-tight ${
              change >= 0 ? 'text-up' : 'text-down'
            } ${stale ? 'opacity-50' : ''}`}
          >
            {formatUsd(price)}
          </p>
        </div>
        <Stat
          label="24h Change"
          value={formatPercent(change)}
          tone={change >= 0 ? 'up' : 'down'}
          dim={stale}
        />
        {/* High and Low survive as STATS here, unlike in the Markets table where they were two
            near-duplicate columns (median 24h spread across the top 50 is only ~4.5%). On a detail
            page there is room, they are the two numbers a trader asks for next, and the candlestick
            chart beside them already carries the graphic load the table needed RangeBar for. */}
        <Stat label="24h High" value={formatUsd(high)} dim={stale} />
        <Stat label="24h Low" value={formatUsd(low)} dim={stale} />
        <Stat label="24h Volume" value={`$${formatCompact(volume)}`} dim={stale} />
        {/* Snapshot value (the miniTicker frame has no trade count), so it does not tick — and does
            not need to. It is the count market-data-source reports, and the one figure here no market-cap site
            can show. It is NOT a depth signal: live data had RLUSD showing 3,286 trades on $21.6M
            while ARB showed 17,402 on $3.7M. Present the number; claim nothing about it. */}
        <Stat
          label="24h Trades"
          value={coin.trades24h > 0 ? coin.trades24h.toLocaleString('en-US') : '—'}
        />
        <Stat label="Volume rank" value={`#${coin.rank}`} dim={stale} />
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CandleChart pair={coin.pair} />
        <TradePanel coinId={coin.id} symbol={coin.symbol} name={coin.name} />
      </div>
    </div>
  );
}
