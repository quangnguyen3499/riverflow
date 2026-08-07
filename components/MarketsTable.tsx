'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoinIcon } from '@/components/CoinIcon';
import { DataUnavailable } from '@/components/DataUnavailable';
import { PriceCell } from '@/components/PriceCell';
import { RangeBar } from '@/components/RangeBar';
import { refreshSnapshot } from '@/hooks/use-market-feed';
import { useNow } from '@/hooks/use-now';
import { isFallbackPair } from '@/lib/market-data/markets';
import { coinLabel, coinName } from '@/lib/coin-names';
import { formatCompact, formatPercent } from '@/lib/format';
import type { CoinMarket } from '@/lib/types';
import { displayStatus, useMarket } from '@/stores/market';
import { useWatchlist } from '@/stores/watchlist';

const VISIBLE_ROWS = 50;

function MarketRow({
  coin,
  stale,
  hydrated,
}: {
  coin: CoinMarket;
  stale: boolean;
  hydrated: boolean;
}) {
  // ONE subscription per row, to a stable object reference. This is what makes the row tick.
  // NEVER `priceFor(coin.id)` here: it is get()-based, creates no subscription, and the row would
  // paint once and freeze. Never return a freshly-allocated object from a selector either —
  // zustand compares by reference and it would loop forever.
  const t = useMarket((s) => s.tickers[coin.pair]);
  // A boolean selector, so starring one coin does not re-render the other 49 rows.
  const isStarred = useWatchlist((s) => s.ids.includes(coin.id));
  const toggle = useWatchlist((s) => s.toggle);
  const router = useRouter();

  const price = t?.price ?? coin.price;
  const change =
    t && t.open24h > 0 ? ((t.price - t.open24h) / t.open24h) * 100 : coin.change24h;
  const high = t?.high24h ?? coin.high24h;
  const low = t?.low24h ?? coin.low24h;
  const volume = t?.volume24h ?? coin.volume24h;
  const starred = hydrated && isStarred;
  const dim = stale ? 'opacity-50' : '';
  // Two lines, never the ticker twice: for the ~half of rows with no display name the primary
  // label IS the ticker and the secondary line becomes the market pair ("ERA/USDT").
  const { primary, secondary } = coinLabel(coin);

  return (
    <tr
      onClick={() => router.push(`/coin/${coin.id}`)}
      className="cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-panel2"
    >
      <td className="px-2 py-2 tabular-nums text-muted">{coin.rank}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <CoinIcon symbol={coin.symbol} size={20} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium text-text">{primary}</span>
            <span className="truncate text-[11px] text-muted">{secondary}</span>
          </span>
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        <PriceCell value={price} stale={stale} />
      </td>
      <td
        className={`px-2 py-2 text-right tabular-nums ${change >= 0 ? 'text-up' : 'text-down'} ${dim}`}
      >
        {formatPercent(change)}
      </td>
      <td className={`hidden px-2 py-2 md:table-cell ${dim}`}>
        {/* Live: low, high and price are all in the miniTicker frame, so this ticks for free. */}
        <RangeBar low={low} high={high} price={price} className="w-28" />
      </td>
      <td className={`hidden px-2 py-2 text-right tabular-nums text-muted sm:table-cell ${dim}`}>
        ${formatCompact(volume)}
      </td>
      <td className="hidden px-2 py-2 text-right tabular-nums text-muted lg:table-cell">
        {/* Snapshot value: the miniTicker frame has no trade count. An em-dash when we only have
            socket data (the tickers-only fallback below), because 0 would be a false number. */}
        {coin.trades24h > 0 ? coin.trades24h.toLocaleString('en-US') : '—'}
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          aria-label={
            starred ? `Remove ${primary} from watchlist` : `Add ${primary} to watchlist`
          }
          onClick={(e) => {
            e.stopPropagation();
            toggle(coin.id);
          }}
          className={`cursor-pointer text-base leading-none ${
            starred ? 'text-accent' : 'text-muted hover:text-accent'
          }`}
        >
          {starred ? '★' : '☆'}
        </button>
      </td>
    </tr>
  );
}

export function MarketsTable() {
  const coins = useMarket((s) => s.coins);
  const tickers = useMarket((s) => s.tickers);
  const marketsError = useMarket((s) => s.marketsError);
  const status = useMarket(displayStatus);
  const lastMessageAt = useMarket((s) => s.lastMessageAt);
  const now = useNow(5000);

  // Hydration guard for the watchlist stars: `useWatchlist` reads localStorage on the client only,
  // so a row that painted a filled star during SSR would hydration-mismatch. The one-shot mount
  // flag is the intended pattern here and the cascading render it causes is exactly the point —
  // the second pass is the one allowed to disagree with the server.
  const [hydrated, setHydrated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount flag, see above
  useEffect(() => setHydrated(true), []);

  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await refreshSnapshot(true);
    } finally {
      setRetrying(false);
    }
  };

  /**
   * TICKERS-ONLY FALLBACK. The snapshot failed but the socket is fine — it needs no REST call and
   * carries price, open, high, low and quote volume for every symbol. So we are missing display
   * NAMES (the bundled map solves that) and RANK (volume order recovers it), not data. Blanking the
   * page here produced a screen where the badge said "Live" beside a panel saying data was
   * unavailable — one of the two being false, mid-demo.
   *
   * Recomputed only when the snapshot is genuinely absent, and memoised on the ticker map so it does
   * not re-sort 400 symbols on every frame.
   */
  const fallbackRows = useMemo<CoinMarket[]>(() => {
    if (coins.length > 0) return [];
    // The one hygiene filter genuinely lost on this path is exchangeInfo's `status === 'TRADING'`, so
    // a halted pair can appear; the volume floor is not applied either. Both are acceptable in a
    // state the banner explicitly discloses, and neither is fixable without the call that failed.
    return Object.values(tickers)
      // The SAME crypto-only predicate the ranked path uses, so the degraded table cannot be headed
      // by USD Coin while the ranked one is headed by Bitcoin. isCryptoBase is pure and static — it
      // needs no exchangeInfo — so all three exclusions survive a failed snapshot intact. It is also
      // the exact predicate `displayStatus` asks about, so the badge cannot contradict these rows.
      .filter((t) => isFallbackPair(t.pair))
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, VISIBLE_ROWS)
      .map((t, i) => {
        const base = t.pair.slice(0, -4);
        return {
          id: base.toLowerCase(),
          symbol: base.toLowerCase(),
          name: coinName(base),
          pair: t.pair,
          rank: i + 1,
          price: t.price,
          change24h: t.open24h > 0 ? ((t.price - t.open24h) / t.open24h) * 100 : 0,
          high24h: t.high24h,
          low24h: t.low24h,
          volume24h: t.volume24h,
          trades24h: 0, // not in the frame → the column renders "—"
        };
      });
  }, [coins.length, tickers]);

  // Gray the numbers when the stream has gone quiet. Skipped in 'polling' mode, where the
  // OfflineBanner already states the snapshot's age — dimming everything there would just be noise.
  //
  // This reads `displayStatus`, and the fix to its clamp is what makes the line reachable in the
  // tickers-only state: while a streaming socket with a failed snapshot was clamped to 'polling',
  // the gate below was permanently false, so a fallback table whose socket later went silent would
  // have frozen at full opacity with no age disclosed anywhere on the page.
  const stale = status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;

  const usingFallback = coins.length === 0 && fallbackRows.length > 0;
  const rows = coins.length > 0 ? coins.slice(0, VISIBLE_ROWS) : fallbackRows;

  if (rows.length === 0) {
    // Genuinely nothing from either upstream: say so instead of pulsing forever.
    if (marketsError) return <DataUnavailable />;
    return (
      <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-muted">
        Loading markets…
      </div>
    );
  }

  return (
    <section aria-label="Markets">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Markets</h2>
      {/* Always visible, never a tooltip: `rank` is a volume rank, not a market-cap rank. */}
      <p className="mb-2 mt-0.5 text-xs text-muted">
        Top 50 crypto USDT markets, ranked by 24h volume.
      </p>
      {usingFallback && (
        <div
          role="status"
          className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-panel px-3 py-2 text-xs text-muted"
        >
          <span>
            Rankings and trade counts are unavailable — showing the top 50 USDT markets by live volume.
          </span>
          {/* Same pending affordance as DataUnavailable's retry: a REST attempt here can take up
              to 16 s (two 8 s per-host timeouts), and a link that looks inert for that long reads
              as broken. On success the banner disappears because `coins` is no longer empty. */}
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="cursor-pointer underline transition-colors hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-2 py-2" title="Rank by 24h volume">
                #
              </th>
              <th className="px-2 py-2">Coin</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">24h %</th>
              <th className="hidden px-2 py-2 md:table-cell">24h Range</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">24h Volume</th>
              <th className="hidden px-2 py-2 text-right lg:table-cell">24h Trades</th>
              <th className="w-8 px-2 py-2 text-center" aria-label="Watchlist" />
            </tr>
          </thead>
          <tbody>
            {rows.map((coin) => (
              <MarketRow key={coin.id} coin={coin} stale={stale} hydrated={hydrated} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
