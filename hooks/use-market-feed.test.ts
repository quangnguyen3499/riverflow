import { beforeEach, describe, expect, it, vi } from 'vitest';
import { displayStatus, useMarket } from '@/stores/market';
import {
  mapMiniTickers,
  rerankFromTickers,
  refreshSnapshot,
  resetSnapshotThrottle,
} from '@/hooks/use-market-feed';
import type { CoinMarket } from '@/lib/types';

// `pickGainers` and `rerank` are NOT mocked: stores/market.ts calls pickGainers inside setSnapshot,
// and mocking it would break every seeded-store assertion in this file.
vi.mock('@/lib/market-data/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/market-data/markets')>()),
  fetchMarketSnapshot: vi.fn(),
  tradablePairs: vi.fn(),
}));

import { fetchMarketSnapshot, tradablePairs } from '@/lib/market-data/markets';

describe('mapMiniTickers', () => {
  it('maps raw market-data source miniTicker fields (s,c,o,h,l,q,E) to LiveTicker', () => {
    const raw = [
      {
        e: '24hrMiniTicker',
        E: 1_722_600_000_000,
        s: 'BTCUSDT',
        c: '67241.50',
        o: '65000.00',
        h: '68000.10',
        l: '64500.00',
        v: '12345.6',
        q: '812345678.9',
      },
    ];
    expect(mapMiniTickers(raw)).toEqual([
      {
        pair: 'BTCUSDT',
        price: 67241.5,
        open24h: 65000,
        high24h: 68000.1,
        low24h: 64500,
        volume24h: 812345678.9,
        updatedAt: 1_722_600_000_000,
      },
    ]);
  });

  it('skips entries that are not objects, lack a pair, or have non-numeric fields', () => {
    const raw = [
      null,
      42,
      'junk',
      { c: '1.0', o: '1', h: '1', l: '1', q: '1', E: 1 }, // missing s
      { s: 'ETHUSDT', c: 'not-a-number', o: '1', h: '1', l: '1', q: '1', E: 1 },
      { s: 'SOLUSDT', c: '150.5', o: '140', h: '155', l: '139', q: '99', E: 1_722_600_000_001 },
    ];
    expect(mapMiniTickers(raw)).toEqual([
      {
        pair: 'SOLUSDT',
        price: 150.5,
        open24h: 140,
        high24h: 155,
        low24h: 139,
        volume24h: 99,
        updatedAt: 1_722_600_000_001,
      },
    ]);
  });

  it('returns an empty array for an empty payload', () => {
    expect(mapMiniTickers([])).toEqual([]);
  });
});

describe('refreshSnapshot', () => {
  const BTC: CoinMarket = {
    id: 'btc', symbol: 'btc', name: 'Bitcoin', pair: 'BTCUSDT', rank: 1,
    price: 50_000, change24h: 2, high24h: 51_000, low24h: 49_000, volume24h: 3_000_000_000,
    trades24h: 1_204_331,
  };

  beforeEach(() => {
    resetSnapshotThrottle();
    vi.mocked(fetchMarketSnapshot).mockReset();
    vi.mocked(tradablePairs).mockReset();
    vi.mocked(tradablePairs).mockResolvedValue(new Set(['BTCUSDT']));
    useMarket.setState({
      coins: [], byId: {}, trending: [], tickers: {}, pairs: new Set<string>(),
      status: 'connecting', lastMessageAt: 0, snapshotAt: 0, marketsError: false,
    });
  });

  it('fills coins and pairs and clears marketsError on success', async () => {
    useMarket.getState().setMarketsError(true);
    vi.mocked(fetchMarketSnapshot).mockResolvedValue([BTC]);

    await refreshSnapshot(true);

    const s = useMarket.getState();
    expect(s.coins).toEqual([BTC]);
    expect(s.byId.btc).toEqual(BTC);
    expect(s.pairs.has('BTCUSDT')).toBe(true);
    expect(s.marketsError).toBe(false);
    // trending is derived inside setSnapshot; BTC is +2% on $3B so it qualifies on volume and
    // change, but a single mover is below MIN_GAINER_CHIPS, so the honest answer is no strip.
    expect(s.trending).toEqual([]);
  });

  it('re-ranks locally from the live ticker map without issuing any request', async () => {
    vi.mocked(fetchMarketSnapshot).mockResolvedValue([
      BTC,
      { ...BTC, id: 'eth', symbol: 'eth', name: 'Ethereum', pair: 'ETHUSDT', rank: 2, volume24h: 1_000_000_000 },
    ]);
    await refreshSnapshot(true);
    vi.mocked(fetchMarketSnapshot).mockClear();

    // ETH out-trades BTC over the next hours; the socket already told us so.
    useMarket.getState().applyTickers([
      { pair: 'ETHUSDT', price: 3_000, open24h: 2_900, high24h: 3_100, low24h: 2_800, volume24h: 9_000_000_000, updatedAt: 1 },
    ]);

    rerankFromTickers();

    expect(useMarket.getState().coins.map((c) => [c.id, c.rank])).toEqual([
      ['eth', 1],
      ['btc', 2],
    ]);
    // The whole point of the change: no 1.88 MB re-download to learn an order we already had.
    expect(fetchMarketSnapshot).not.toHaveBeenCalled();
  });

  it('rerankFromTickers leaves snapshotAt alone — a local re-sort is not a fresh price', async () => {
    // The 5-minute re-rank timer runs for the lifetime of the tab and issues no request. If it
    // restamped snapshotAt (which `setCoins` does, and which is why this writes through
    // `rerankCoins`), then during a network partition — refreshSnapshot failing silently because a
    // good snapshot is on screen — OfflineBanner's "prices shown as of HH:MM" would advance every
    // 5 minutes while every displayed price stayed frozen at its last real value.
    vi.mocked(fetchMarketSnapshot).mockResolvedValue([BTC]);
    await refreshSnapshot(true);

    const realSnapshot = 1_700_000_000_000;
    useMarket.setState({ snapshotAt: realSnapshot });

    rerankFromTickers();

    expect(useMarket.getState().snapshotAt).toBe(realSnapshot);
    expect(useMarket.getState().coins.map((c) => c.id)).toEqual(['btc']);
  });

  it('raises marketsError when the snapshot fails and there is nothing on screen', async () => {
    vi.mocked(fetchMarketSnapshot).mockRejectedValue(new Error('network down'));

    await refreshSnapshot(true);

    expect(useMarket.getState().marketsError).toBe(true);
    expect(useMarket.getState().coins).toEqual([]);
  });

  it('stays silent and keeps the last good snapshot when a later refresh fails', async () => {
    vi.mocked(fetchMarketSnapshot).mockResolvedValueOnce([BTC]);
    await refreshSnapshot(true);

    vi.mocked(fetchMarketSnapshot).mockRejectedValueOnce(new Error('network down'));
    await refreshSnapshot(true);

    // marketsError means "there is nothing to show" — not "the last request failed".
    expect(useMarket.getState().marketsError).toBe(false);
    expect(useMarket.getState().coins).toEqual([BTC]);
  });

  it('never writes status on a REST failure, and the badge still reads Offline', async () => {
    useMarket.getState().setStatus('streaming');
    vi.mocked(fetchMarketSnapshot).mockRejectedValue(new Error('network down'));

    await refreshSnapshot(true);

    // Half 1: the hook did not touch `status`, so wsManager stays its only writer.
    expect(useMarket.getState().status).toBe('streaming');
    // Half 2: an open socket with no universe is still not "Live".
    expect(displayStatus(useMarket.getState())).toBe('polling');
  });
});
