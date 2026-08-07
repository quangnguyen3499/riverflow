import { describe, it, expect } from 'vitest';
import {
  FEE_RATE,
  INITIAL_CASH,
  InsufficientFundsError,
  InsufficientHoldingsError,
  executeBuy,
  executeSell,
  unrealizedPnl,
  portfolioValue,
  type PortfolioSlice,
} from '@/lib/trading';
import type { Holding } from '@/lib/types';

const NOW = 1_754_100_000_000; // fixed ms epoch so timestamps are deterministic

function slice(cash: number, holdings: Holding[] = []): PortfolioSlice {
  return { cash, holdings };
}

describe('constants', () => {
  it('uses a 0.1% taker fee and $100k starting cash', () => {
    expect(FEE_RATE).toBe(0.001);
    expect(INITIAL_CASH).toBe(100_000);
  });
});

describe('executeBuy', () => {
  it('opens a new position at the execution price and deducts cost including fee', () => {
    const r = executeBuy(slice(INITIAL_CASH), 'bitcoin', 'btc', 0.5, 60_000, NOW);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0]).toEqual({
      coinId: 'bitcoin',
      symbol: 'btc',
      qty: 0.5,
      avgCost: 60_000,
    });
    // cost = 0.5 * 60_000 * 1.001 = 30_030 → cash 69_970
    expect(r.cash).toBeCloseTo(100_000 - 30_000 * 1.001, 6);
    expect(r.trade.fee).toBeCloseTo(30, 10); // 0.5 * 60_000 * 0.001
  });

  it('averages cost across two buys at different prices', () => {
    const first = executeBuy(slice(INITIAL_CASH), 'ethereum', 'eth', 1, 100, NOW);
    const second = executeBuy(
      { cash: first.cash, holdings: first.holdings },
      'ethereum',
      'eth',
      1,
      200,
      NOW + 1,
    );
    expect(second.holdings).toHaveLength(1);
    expect(second.holdings[0].qty).toBe(2);
    // (1*100 + 1*200) / (1+1) = 150 — fees never enter this formula
    expect(second.holdings[0].avgCost).toBeCloseTo(150, 10);
    expect(second.cash).toBeCloseTo(100_000 - 100.1 - 200.2, 6);
  });

  it('charges the fee to cash but keeps it out of avgCost', () => {
    const r = executeBuy(slice(INITIAL_CASH), 'solana', 'sol', 2, 50, NOW);
    expect(r.holdings[0].avgCost).toBe(50); // exactly the price — no fee baked in
    expect(r.cash).toBeCloseTo(100_000 - 100 - 0.1, 6); // fee $0.10 came out of cash
    expect(r.trade.fee).toBeCloseTo(0.1, 10);
  });

  it('throws InsufficientFundsError when cost exceeds cash', () => {
    // cost = 1 * 100 * 1.001 = 100.1 > 100 cash
    expect(() => executeBuy(slice(100), 'bitcoin', 'btc', 1, 100, NOW)).toThrow(
      InsufficientFundsError,
    );
  });

  it('allows an exactly-affordable buy (boundary) and leaves ~0 cash', () => {
    // Same expression the implementation uses, so the doubles are identical
    const cost = 2 * 100 * (1 + FEE_RATE);
    const r = executeBuy(slice(cost), 'bitcoin', 'btc', 2, 100, NOW);
    expect(r.holdings[0].qty).toBe(2);
    expect(r.cash).toBeCloseTo(0, 10);
  });

  it('returns a well-formed buy Trade', () => {
    const r = executeBuy(slice(INITIAL_CASH), 'bitcoin', 'btc', 0.5, 60_000, NOW);
    expect(typeof r.trade.id).toBe('string');
    expect(r.trade.id.length).toBeGreaterThan(0);
    expect(r.trade).toMatchObject({
      side: 'buy',
      coinId: 'bitcoin',
      symbol: 'btc',
      qty: 0.5,
      price: 60_000,
      realizedPnl: null,
      timestamp: NOW,
    });
  });

  it('does not mutate the input slice', () => {
    const s = slice(INITIAL_CASH, [
      { coinId: 'ethereum', symbol: 'eth', qty: 1, avgCost: 100 },
    ]);
    const r = executeBuy(s, 'ethereum', 'eth', 1, 200, NOW);
    expect(s.cash).toBe(INITIAL_CASH);
    expect(s.holdings[0]).toEqual({
      coinId: 'ethereum',
      symbol: 'eth',
      qty: 1,
      avgCost: 100,
    });
    expect(r.holdings).not.toBe(s.holdings); // fresh array returned
  });
});

describe('executeSell', () => {
  const eth: Holding = { coinId: 'ethereum', symbol: 'eth', qty: 4, avgCost: 2_000 };

  it('credits proceeds net of fee and records realizedPnl', () => {
    const r = executeSell(slice(1_000, [eth]), 'ethereum', 3, 2_500, NOW);
    expect(r.cash).toBeCloseTo(1_000 + 3 * 2_500 * 0.999, 6); // 8_492.5
    expect(r.trade.realizedPnl).toBeCloseTo(1_500, 10); // 3 * (2_500 - 2_000)
    expect(r.trade.fee).toBeCloseTo(7.5, 10); // 3 * 2_500 * 0.001
  });

  it('keeps avgCost unchanged on a partial sell', () => {
    const r = executeSell(slice(0, [eth]), 'ethereum', 3, 2_500, NOW);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].qty).toBeCloseTo(1, 10);
    expect(r.holdings[0].avgCost).toBe(2_000);
  });

  it('removes the position when the full quantity is sold', () => {
    const r = executeSell(slice(0, [eth]), 'ethereum', 4, 2_500, NOW);
    expect(r.holdings).toHaveLength(0);
  });

  it('removes float-dust positions within epsilon of zero', () => {
    // 0.1 + 0.2 === 0.30000000000000004 — selling "0.3" must still close the position
    const b1 = executeBuy(slice(1_000), 'bitcoin', 'btc', 0.1, 100, NOW);
    const b2 = executeBuy(
      { cash: b1.cash, holdings: b1.holdings },
      'bitcoin',
      'btc',
      0.2,
      100,
      NOW,
    );
    expect(b2.holdings[0].qty).not.toBe(0.3); // proves the dust exists
    const r = executeSell(
      { cash: b2.cash, holdings: b2.holdings },
      'bitcoin',
      0.3,
      110,
      NOW,
    );
    expect(r.holdings).toHaveLength(0); // remaining ~4e-17 ≤ 1e-9 → removed
    expect(r.trade.realizedPnl).toBeCloseTo(3, 6); // 0.3 * (110 - 100)
  });

  it('throws InsufficientHoldingsError when qty exceeds the held amount', () => {
    expect(() => executeSell(slice(0, [eth]), 'ethereum', 4.5, 2_500, NOW)).toThrow(
      InsufficientHoldingsError,
    );
  });

  it('throws InsufficientHoldingsError when the coin is not held at all', () => {
    expect(() => executeSell(slice(0, [eth]), 'dogecoin', 1, 0.1, NOW)).toThrow(
      InsufficientHoldingsError,
    );
  });

  it('returns a well-formed sell Trade and does not mutate the input', () => {
    const s = slice(0, [eth]);
    const r = executeSell(s, 'ethereum', 4, 2_500, NOW);
    expect(typeof r.trade.id).toBe('string');
    expect(r.trade).toMatchObject({
      side: 'sell',
      coinId: 'ethereum',
      symbol: 'eth', // symbol looked up from the holding
      qty: 4,
      price: 2_500,
      timestamp: NOW,
    });
    expect(s.holdings).toHaveLength(1); // input untouched
    expect(s.holdings[0].qty).toBe(4);
    expect(s.cash).toBe(0);
  });
});

describe('unrealizedPnl', () => {
  const h: Holding = { coinId: 'bitcoin', symbol: 'btc', qty: 2, avgCost: 100 };

  it('is qty * (livePrice - avgCost)', () => {
    expect(unrealizedPnl(h, 120)).toBeCloseTo(40, 10);
    expect(unrealizedPnl(h, 90)).toBeCloseTo(-20, 10);
    expect(unrealizedPnl(h, 100)).toBe(0);
  });
});

describe('portfolioValue', () => {
  const holdings: Holding[] = [
    { coinId: 'bitcoin', symbol: 'btc', qty: 1, avgCost: 100 },
    { coinId: 'ethereum', symbol: 'eth', qty: 2, avgCost: 50 },
  ];

  it('sums cash plus holdings at live prices', () => {
    const priceOf = (id: string) => (id === 'bitcoin' ? 150 : 60);
    expect(portfolioValue(500, holdings, priceOf)).toBeCloseTo(500 + 150 + 120, 10);
  });

  it('falls back to avgCost when a live price is missing', () => {
    const priceOf = (id: string) => (id === 'bitcoin' ? 150 : undefined);
    // eth has no live price → valued at avgCost: 2 * 50 = 100
    expect(portfolioValue(500, holdings, priceOf)).toBeCloseTo(500 + 150 + 100, 10);
  });

  it('returns just cash when there are no holdings', () => {
    expect(portfolioValue(1_234.56, [], () => undefined)).toBe(1_234.56);
  });
});
