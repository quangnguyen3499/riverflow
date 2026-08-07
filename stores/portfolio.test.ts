import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Holding } from '@/lib/types';

async function fresh() {
  vi.resetModules();
  const [storeMod, trading] = await Promise.all([
    import('@/stores/portfolio'),
    import('@/lib/trading'),
  ]);
  return { usePortfolio: storeMod.usePortfolio, trading };
}

describe('usePortfolio', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with INITIAL_CASH, no holdings, no trades', async () => {
    const { usePortfolio, trading } = await fresh();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('buy debits cash including fee, adds a holding, and records the trade', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    const s = usePortfolio.getState();
    expect(s.cash).toBeCloseTo(49_950, 6); // 100000 - 50000*1.001
    expect(s.holdings).toEqual([
      { coinId: 'bitcoin', symbol: 'btc', qty: 1, avgCost: 50_000 },
    ]);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0]).toMatchObject({
      side: 'buy',
      coinId: 'bitcoin',
      symbol: 'btc',
      qty: 1,
      price: 50_000,
      realizedPnl: null,
    });
    expect(s.trades[0].fee).toBeCloseTo(50, 6);
    expect(typeof s.trades[0].timestamp).toBe('number');
  });

  it('buy beyond cash throws InsufficientFundsError and leaves state unchanged', async () => {
    const { usePortfolio, trading } = await fresh();
    expect(() => usePortfolio.getState().buy('bitcoin', 'btc', 3, 50_000)).toThrow(
      trading.InsufficientFundsError,
    );
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('sell credits proceeds minus fee, removes the emptied holding, records realized P&L', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    usePortfolio.getState().sell('bitcoin', 1, 60_000);
    const s = usePortfolio.getState();
    expect(s.cash).toBeCloseTo(109_890, 6); // 49950 + 60000*0.999
    expect(s.holdings).toEqual([]);
    expect(s.trades).toHaveLength(2);
    expect(s.trades[0]).toMatchObject({ side: 'sell', coinId: 'bitcoin', qty: 1, price: 60_000 }); // newest first
    expect(s.trades[0].realizedPnl).toBeCloseTo(10_000, 6);
  });

  it('sell beyond holdings throws InsufficientHoldingsError and leaves state unchanged', async () => {
    const { usePortfolio, trading } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    expect(() => usePortfolio.getState().sell('bitcoin', 2, 60_000)).toThrow(
      trading.InsufficientHoldingsError,
    );
    const s = usePortfolio.getState();
    expect(s.holdings).toHaveLength(1);
    expect(s.holdings[0].qty).toBe(1);
    expect(s.trades).toHaveLength(1);
  });

  it('reset restores INITIAL_CASH and clears holdings and trades', async () => {
    const { usePortfolio, trading } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 0.5, 40_000);
    usePortfolio.getState().reset();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('persists under the "riverflow-portfolio-v2" key', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('ethereum', 'eth', 2, 3_000);
    const raw = localStorage.getItem('riverflow-portfolio-v2');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.cash).toBeCloseTo(93_994, 6); // 100000 - 2*3000*1.001
    expect(persisted.holdings).toEqual([
      { coinId: 'ethereum', symbol: 'eth', qty: 2, avgCost: 3_000 },
    ]);
    expect(persisted.trades).toHaveLength(1);
  });

  it('a fresh store hydrates persisted cash/holdings/trades', async () => {
    const holdings: Holding[] = [{ coinId: 'bitcoin', symbol: 'btc', qty: 0.25, avgCost: 48_000 }];
    localStorage.setItem(
      'riverflow-portfolio-v2',
      JSON.stringify({ state: { cash: 1_234.56, holdings, trades: [] }, version: 0 }),
    );
    const { usePortfolio } = await fresh();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(1_234.56);
    expect(s.holdings).toEqual(holdings);
    expect(s.trades).toEqual([]);
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    localStorage.setItem('riverflow-portfolio-v2', 'not-json{{{');
    const { usePortfolio, trading } = await fresh();
    expect(usePortfolio.getState().cash).toBe(trading.INITIAL_CASH);
    expect(usePortfolio.getState().holdings).toEqual([]);
    expect(usePortfolio.getState().trades).toEqual([]);
  });
});
