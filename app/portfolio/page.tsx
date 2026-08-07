'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DataUnavailable } from '@/components/DataUnavailable';
import { EmptyState } from '@/components/EmptyState';
import { ResetDialog } from '@/components/ResetDialog';
import { useNow } from '@/hooks/use-now';
import { formatPercent, formatUsd } from '@/lib/format';
import { INITIAL_CASH, portfolioValue, unrealizedPnl } from '@/lib/trading';
import { displayStatus, useMarket } from '@/stores/market';
import { usePortfolio } from '@/stores/portfolio';

const UNKNOWN = '—';

function formatQty(q: number): string {
  return q.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function signedUsd(n: number): string {
  return `${n >= 0 ? '+' : '-'}${formatUsd(Math.abs(n))}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PortfolioPage() {
  const cash = usePortfolio((s) => s.cash);
  const holdings = usePortfolio((s) => s.holdings);
  const trades = usePortfolio((s) => s.trades);
  const reset = usePortfolio((s) => s.reset);
  // THIS is the sanctioned use of priceFor: a Holding carries only a coinId, so this page cannot key
  // the ticker map itself. priceFor is get()-based and creates no subscription on its own, which is
  // exactly why the bare `s.tickers` subscription on the next line is mandatory — without it the P&L
  // numbers would paint once and freeze. Row-shaped surfaces that HOLD a CoinMarket (Markets table,
  // gainer chips, Watchlist rows, coin header) must instead subscribe to s.tickers[coin.pair].
  const priceFor = useMarket((s) => s.priceFor);
  useMarket((s) => s.tickers); // subscribe: live ticks re-render P&L
  useMarket((s) => s.coins); //   subscribe: a new snapshot re-resolves holdings
  const marketsError = useMarket((s) => s.marketsError);
  const status = useMarket(displayStatus);
  const lastMessageAt = useMarket((s) => s.lastMessageAt);
  const now = useNow(5000);
  const [resetOpen, setResetOpen] = useState(false);
  // Hydration guard: `usePortfolio` rehydrates cash, holdings and trades from localStorage on the
  // client only, so markup that printed real balances during SSR would mismatch. The one-shot mount
  // flag is the intended pattern and the cascading render is the point — the second pass is the one
  // allowed to disagree with the server.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount flag, see above
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="h-24 animate-pulse rounded-lg bg-panel" />
        <div className="h-48 animate-pulse rounded-lg bg-panel" />
      </div>
    );
  }

  // A total that silently substitutes cost basis for an unpriceable holding would mean something
  // different from "market value", so it is shown as unknown instead.
  const pricesKnown = holdings.every((h) => priceFor(h.coinId) !== undefined);
  const totalValue = pricesKnown ? portfolioValue(cash, holdings, priceFor) : null;
  const pnl = totalValue === null ? null : totalValue - INITIAL_CASH;
  const history = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  const isEmpty = holdings.length === 0 && trades.length === 0;
  const stale = status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Portfolio</h1>
        <button
          onClick={() => setResetOpen(true)}
          className="rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-down hover:text-down"
        >
          Reset demo
        </button>
      </div>

      {marketsError && <DataUnavailable compact />}

      <section className="grid gap-4 rounded-lg border border-border bg-panel p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted">Total Value</p>
          <p
            className="font-mono text-2xl"
            title={totalValue === null ? 'Live prices unavailable' : undefined}
          >
            {totalValue === null ? UNKNOWN : formatUsd(totalValue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Total P&amp;L</p>
          <p
            className={`font-mono text-2xl ${pnl === null ? '' : pnl >= 0 ? 'text-up' : 'text-down'}`}
            title={pnl === null ? 'Live prices unavailable' : undefined}
          >
            {pnl === null
              ? UNKNOWN
              : `${signedUsd(pnl)} (${formatPercent((pnl / INITIAL_CASH) * 100)})`}
          </p>
        </div>
        <div>
          {/* Always exact: cash never depends on a market price. */}
          <p className="text-xs text-muted">Cash</p>
          <p className="font-mono text-2xl">{formatUsd(cash)}</p>
        </div>
      </section>

      {isEmpty ? (
        <EmptyState
          title="You have $100,000 waiting"
          body="Make your first trade — fictional funds, live prices."
          href="/"
          linkText="Go to Markets"
        />
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted">Holdings</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-panel">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Asset</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Avg Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 text-right font-medium">Unrealized P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted">
                        No open positions
                      </td>
                    </tr>
                  ) : (
                    holdings.map((h) => {
                      // Unpriceable: delisted, below the volume floor, a stale pre-rewrite
                      // localStorage id, or the whole snapshot is missing. Qty and avg cost are
                      // still exact, so show them and mark only what we cannot know.
                      // Compare `live === undefined` inline everywhere so TS narrows it to number.
                      const live = priceFor(h.coinId);
                      const pnlH = live === undefined ? null : unrealizedPnl(h, live);
                      const cost = h.qty * h.avgCost;
                      const dim = stale ? 'opacity-50' : '';
                      return (
                        <tr key={h.coinId} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 font-medium uppercase">
                            {h.symbol}
                            {live === undefined && !marketsError && (
                              <span className="ml-2 text-xs normal-case text-muted opacity-70">
                                Not currently listed in the live market set
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{formatQty(h.qty)}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatUsd(h.avgCost)}</td>
                          <td
                            className={`px-4 py-2 text-right font-mono ${dim}`}
                            title={live === undefined ? 'Live prices unavailable' : undefined}
                          >
                            {live === undefined ? UNKNOWN : formatUsd(live)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {live === undefined ? UNKNOWN : formatUsd(h.qty * live)}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-mono ${
                              pnlH === null ? 'text-muted' : pnlH >= 0 ? 'text-up' : 'text-down'
                            } ${dim}`}
                          >
                            {pnlH === null
                              ? UNKNOWN
                              : `${signedUsd(pnlH)} (${formatPercent(
                                  cost > 0 ? (pnlH / cost) * 100 : 0,
                                )})`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            {/* Every column here is a stored historical fact — including realized P&L, which was
                computed at execution time. None of it depends on a live price, so this table is
                fully correct even with market-data source unreachable. */}
            <h2 className="mb-2 text-sm font-semibold text-muted">Trade History</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-panel">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Side</th>
                    <th className="px-4 py-2 font-medium">Coin</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Fee</th>
                    <th className="px-4 py-2 text-right font-medium">Realized P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-muted">{formatTime(t.timestamp)}</td>
                      <td
                        className={`px-4 py-2 font-semibold uppercase ${
                          t.side === 'buy' ? 'text-up' : 'text-down'
                        }`}
                      >
                        {t.side}
                      </td>
                      <td className="px-4 py-2 uppercase">{t.symbol}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatQty(t.qty)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatUsd(t.price)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatUsd(t.fee)}</td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          t.realizedPnl === null
                            ? 'text-muted'
                            : t.realizedPnl >= 0
                              ? 'text-up'
                              : 'text-down'
                        }`}
                      >
                        {t.realizedPnl === null ? UNKNOWN : signedUsd(t.realizedPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <ResetDialog
        open={resetOpen}
        onConfirm={() => {
          reset();
          setResetOpen(false);
          toast.success('Demo reset — balance restored to $100,000');
        }}
        onClose={() => setResetOpen(false)}
      />
    </div>
  );
}
