'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { formatUsd } from '@/lib/format';
import {
  FEE_RATE,
  InsufficientFundsError,
  InsufficientHoldingsError,
} from '@/lib/trading';
import { useMarket } from '@/stores/market';
import { usePortfolio } from '@/stores/portfolio';

const PERCENTS = [25, 50, 75, 100] as const;

/**
 * Trim a quantity to 8 decimals for display in the amount box.
 *
 * `Math.floor(q * 1e8) / 1e8` is NOT a floor: the divide-back can round up, so it
 * returns more than `q` for ~2% of large quantities (e.g. 63248348236.083984 →
 * 63248348236.08399). The `Math.min` clamps that — a quick-fill that came back
 * larger than the funds it was sized from would fail its own affordability check.
 */
function trimQty(q: number): string {
  const floored = Math.min(Math.floor(q * 1e8) / 1e8, q);
  return floored > 0 ? String(floored) : '';
}

/**
 * Shaved off a percent-sized buy so the fill stays affordable under `executeBuy`'s
 * own cost expression despite double rounding. On the $100,000 demo balance this is
 * $0.0001 — invisible in the UI, and without it a 100% fill of a sub-cent coin
 * dead-ends on "Insufficient cash".
 */
const BUY_SLACK = 1 - 1e-9;

export function TradePanel({
  coinId,
  symbol,
  name,
}: {
  coinId: string;
  symbol: string;
  name: string;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const cash = usePortfolio((s) => s.cash);
  const holdings = usePortfolio((s) => s.holdings);
  const buy = usePortfolio((s) => s.buy);
  const sell = usePortfolio((s) => s.sell);
  const priceFor = useMarket((s) => s.priceFor);
  useMarket((s) => s.tickers); // subscribe so the preview follows live ticks
  useMarket((s) => s.coins); //  and polling-mode price refreshes

  const ticker = symbol.toUpperCase();
  const price = priceFor(coinId);
  const heldQty = holdings.find((h) => h.coinId === coinId)?.qty ?? 0;
  const qty = Number.parseFloat(amount);
  const validQty = Number.isFinite(qty) && qty > 0;
  const notional = validQty && price !== undefined ? qty * price : 0;
  const fee = notional * FEE_RATE;
  // Written exactly as `executeBuy` computes it — `notional + fee` differs by an ULP
  // upward, which is enough to reject a fill the store would have accepted.
  const buyCost =
    validQty && price !== undefined ? qty * price * (1 + FEE_RATE) : 0;
  const total = side === 'buy' ? buyCost : notional - fee;

  let reason: string | null = null;
  if (price === undefined) reason = 'Price unavailable';
  else if (!validQty) reason = 'Enter an amount';
  else if (side === 'buy' && buyCost > cash) reason = 'Insufficient cash';
  else if (side === 'sell' && qty > heldQty)
    reason = `Insufficient ${ticker} balance`;

  const setPercent = (pct: number) => {
    if (price === undefined || price <= 0) return;
    if (side === 'sell') {
      // A max sell must carry the EXACT held quantity from the store: any rounded
      // display value can land above it, and `executeSell`'s epsilon is asymmetric
      // (`qty > held + 1e-9` throws), so the panel would reject its own fill and
      // leave the position un-closable.
      if (pct === 100) {
        setAmount(heldQty > 0 ? String(heldQty) : '');
        return;
      }
      setAmount(trimQty(heldQty * (pct / 100)));
      return;
    }
    setAmount(
      trimQty(((cash * (pct / 100)) / (price * (1 + FEE_RATE))) * BUY_SLACK),
    );
  };

  const submit = () => {
    if (reason !== null || price === undefined) return;
    try {
      if (side === 'buy') buy(coinId, symbol, qty, price);
      else sell(coinId, qty, price);
      toast.success(
        `Order filled — ${side === 'buy' ? 'bought' : 'sold'} ${amount} ${ticker} @ ${formatUsd(price)}`,
      );
      setAmount('');
    } catch (err) {
      if (err instanceof InsufficientFundsError)
        toast.error('Order rejected — insufficient cash');
      else if (err instanceof InsufficientHoldingsError)
        toast.error(`Order rejected — insufficient ${ticker} balance`);
      else toast.error('Order rejected');
    }
  };

  return (
    <aside className="h-fit rounded-lg border border-border bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">Trade {name}</h2>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded bg-panel2 p-1 text-sm">
        <button
          onClick={() => setSide('buy')}
          className={`rounded py-1.5 font-medium transition-colors ${
            side === 'buy' ? 'bg-up text-black' : 'text-muted hover:text-text'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`rounded py-1.5 font-medium transition-colors ${
            side === 'sell' ? 'bg-down text-black' : 'text-muted hover:text-text'
          }`}
        >
          Sell
        </button>
      </div>
      <label className="mb-1 block text-xs text-muted" htmlFor="trade-amount">
        Amount ({ticker})
      </label>
      <input
        id="trade-amount"
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mb-2 w-full rounded border border-border bg-panel2 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />
      <div className="mb-3 grid grid-cols-4 gap-1">
        {PERCENTS.map((p) => (
          <button
            key={p}
            onClick={() => setPercent(p)}
            className="rounded bg-panel2 py-1 text-xs text-muted transition-colors hover:text-text"
          >
            {p}%
          </button>
        ))}
      </div>
      <dl className="mb-3 space-y-1 text-xs text-muted">
        <div className="flex justify-between">
          <dt>{side === 'buy' ? 'Cost' : 'Value'}</dt>
          <dd className="font-mono text-text">≈ {formatUsd(notional)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Fee (0.1%)</dt>
          <dd className="font-mono text-text">{formatUsd(fee)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{side === 'buy' ? 'Total' : 'You receive'}</dt>
          <dd className="font-mono text-text">≈ {formatUsd(total)}</dd>
        </div>
      </dl>
      <button
        onClick={submit}
        disabled={reason !== null}
        className={`w-full rounded py-2.5 text-sm font-semibold text-black transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          side === 'buy'
            ? 'bg-up hover:brightness-110'
            : 'bg-down hover:brightness-110'
        }`}
      >
        {reason ?? `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-muted">
        {side === 'buy'
          ? `Available: ${formatUsd(cash)}`
          : `Available: ${heldQty.toLocaleString('en-US', {
              maximumFractionDigits: 8,
            })} ${ticker}`}
      </p>
    </aside>
  );
}
