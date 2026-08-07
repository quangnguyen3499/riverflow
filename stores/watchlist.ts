import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface WatchlistState {
  ids: string[];
  toggle(id: string): void;
  has(id: string): boolean;
}

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) =>
        set((s) => ({
          ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id],
        })),
      has: (id) => get().ids.includes(id),
    }),
    {
      name: 'riverflow-watchlist-v2',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
