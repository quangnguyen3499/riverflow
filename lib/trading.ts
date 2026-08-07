import type { Holding, Trade } from '@/lib/types';

export const FEE_RATE = 0.001;
export const INITIAL_CASH = 100_000;

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class InsufficientHoldingsError extends Error {
  constructor(message = 'Insufficient holdings') {
    super(message);
    this.name = 'InsufficientHoldingsError';
  }
}

export interface PortfolioSlice {
  cash: number;
  holdings: Holding[];
}

/** Quantities within this distance of zero are treated as a closed position. */
const EPSILON = 1e-9;

export function executeBuy(
  s: PortfolioSlice,
  coinId: string,
  symbol: string,
  qty: number,
  price: number,
  now: number,
): { cash: number; holdings: Holding[]; trade: Trade } {
  const cost = qty * price * (1 + FEE_RATE);
  if (cost > s.cash) {
    throw new InsufficientFundsError(
      `Buy costs $${cost.toFixed(2)} but only $${s.cash.toFixed(2)} is available`,
    );
  }
  const fee = qty * price * FEE_RATE;

  const existing = s.holdings.find((h) => h.coinId === coinId);
  let holdings: Holding[];
  if (existing) {
    const newQty = existing.qty + qty;
    // Weighted average of what was actually paid per unit; fee excluded.
    const avgCost = (existing.qty * existing.avgCost + qty * price) / newQty;
    holdings = s.holdings.map((h) =>
      h.coinId === coinId ? { ...h, qty: newQty, avgCost } : h,
    );
  } else {
    holdings = [...s.holdings, { coinId, symbol, qty, avgCost: price }];
  }

  const trade: Trade = {
    id: crypto.randomUUID(),
    side: 'buy',
    coinId,
    symbol,
    qty,
    price,
    fee,
    realizedPnl: null,
    timestamp: now,
  };

  return { cash: s.cash - cost, holdings, trade };
}

export function executeSell(
  s: PortfolioSlice,
  coinId: string,
  qty: number,
  price: number,
  now: number,
): { cash: number; holdings: Holding[]; trade: Trade } {
  const existing = s.holdings.find((h) => h.coinId === coinId);
  if (!existing || qty > existing.qty + EPSILON) {
    throw new InsufficientHoldingsError(
      `Sell of ${qty} exceeds held quantity ${existing?.qty ?? 0}`,
    );
  }

  const fee = qty * price * FEE_RATE;
  const proceeds = qty * price * (1 - FEE_RATE);
  const realizedPnl = qty * (price - existing.avgCost);

  const remaining = existing.qty - qty;
  const holdings =
    remaining <= EPSILON
      ? s.holdings.filter((h) => h.coinId !== coinId)
      : s.holdings.map((h) =>
          h.coinId === coinId ? { ...h, qty: remaining } : h,
        );

  const trade: Trade = {
    id: crypto.randomUUID(),
    side: 'sell',
    coinId,
    symbol: existing.symbol,
    qty,
    price,
    fee,
    realizedPnl,
    timestamp: now,
  };

  return { cash: s.cash + proceeds, holdings, trade };
}

export function unrealizedPnl(h: Holding, livePrice: number): number {
  return h.qty * (livePrice - h.avgCost);
}

export function portfolioValue(
  cash: number,
  holdings: Holding[],
  priceOf: (coinId: string) => number | undefined,
): number {
  return holdings.reduce(
    (total, h) => total + h.qty * (priceOf(h.coinId) ?? h.avgCost),
    cash,
  );
}
