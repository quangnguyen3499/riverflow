import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { executeBuy, executeSell, INITIAL_CASH } from '@/lib/trading';
import type { Holding, Trade } from '@/lib/types';

interface PortfolioState {
  cash: number;
  holdings: Holding[];
  trades: Trade[];
  buy(coinId: string, symbol: string, qty: number, price: number): void;
  sell(coinId: string, qty: number, price: number): void;
  reset(): void;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      cash: INITIAL_CASH,
      holdings: [],
      trades: [],
      buy: (coinId, symbol, qty, price) => {
        const { cash, holdings, trades } = get();
        const next = executeBuy({ cash, holdings }, coinId, symbol, qty, price, Date.now());
        set({ cash: next.cash, holdings: next.holdings, trades: [next.trade, ...trades] });
      },
      sell: (coinId, qty, price) => {
        const { cash, holdings, trades } = get();
        const next = executeSell({ cash, holdings }, coinId, qty, price, Date.now());
        set({ cash: next.cash, holdings: next.holdings, trades: [next.trade, ...trades] });
      },
      reset: () => set({ cash: INITIAL_CASH, holdings: [], trades: [] }),
    }),
    {
      name: 'riverflow-portfolio-v2',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
