import { beforeEach, describe, expect, it, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  const mod = await import('@/stores/watchlist');
  return mod.useWatchlist;
}

describe('useWatchlist', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toggle adds an id, toggling again removes it', async () => {
    const useWatchlist = await freshStore();
    useWatchlist.getState().toggle('bitcoin');
    expect(useWatchlist.getState().ids).toEqual(['bitcoin']);
    useWatchlist.getState().toggle('ethereum');
    expect(useWatchlist.getState().ids).toEqual(['bitcoin', 'ethereum']);
    useWatchlist.getState().toggle('bitcoin');
    expect(useWatchlist.getState().ids).toEqual(['ethereum']);
  });

  it('has() reports membership', async () => {
    const useWatchlist = await freshStore();
    expect(useWatchlist.getState().has('bitcoin')).toBe(false);
    useWatchlist.getState().toggle('bitcoin');
    expect(useWatchlist.getState().has('bitcoin')).toBe(true);
  });

  it('writes state to localStorage under "riverflow-watchlist-v2"', async () => {
    const useWatchlist = await freshStore();
    useWatchlist.getState().toggle('solana');
    const raw = localStorage.getItem('riverflow-watchlist-v2');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state.ids).toEqual(['solana']);
  });

  it('a fresh store hydrates ids from localStorage', async () => {
    localStorage.setItem(
      'riverflow-watchlist-v2',
      JSON.stringify({ state: { ids: ['cardano', 'dogecoin'] }, version: 0 }),
    );
    const useWatchlist = await freshStore();
    expect(useWatchlist.getState().ids).toEqual(['cardano', 'dogecoin']);
    expect(useWatchlist.getState().has('cardano')).toBe(true);
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    localStorage.setItem('riverflow-watchlist-v2', '{"state": {{{ not json');
    const useWatchlist = await freshStore();
    expect(useWatchlist.getState().ids).toEqual([]);
    useWatchlist.getState().toggle('bitcoin');
    expect(useWatchlist.getState().ids).toEqual(['bitcoin']);
  });
});
