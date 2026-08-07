import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetch24hrTickers,
  fetchKlines,
  fetchTradablePairs,
  GeoBlockedError,
  REST_HOSTS,
} from '@/lib/market-data/rest';

/** Minimal Response stand-in so tests never depend on the runtime's Response class. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Raw kline rows: [openTime(ms), open, high, low, close, volume, closeTime, ...]
const RAW_KLINES = [
  [1722556800000, '67000.00', '67500.00', '66800.00', '67241.50', '123.4', 1722556859999, '8300000.00', 421, '60.1', '4040000.00', '0'],
  [1722556860000, '67241.50', '67300.00', '67100.00', '67150.00', '98.7', 1722556919999, '6630000.00', 388, '48.2', '3240000.00', '0'],
];

// Raw /api/v3/ticker/24hr rows. market-data-source returns every numeric as a string.
const RAW_24HR = [
  {
    symbol: 'BTCUSDT',
    lastPrice: '67241.50',
    priceChangePercent: '4.200',
    highPrice: '68000.00',
    lowPrice: '65900.00',
    quoteVolume: '2810000000.00',
    count: 1_204_331,
  },
  {
    symbol: 'ETHUSDT',
    lastPrice: '3120.44',
    priceChangePercent: '-1.150',
    highPrice: '3200.00',
    lowPrice: '3080.10',
    quoteVolume: '990000000.00',
    count: 622_004,
  },
];

const EXCHANGE_INFO = {
  timezone: 'UTC',
  symbols: [
    { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
    { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' },
    { symbol: 'ETHBTC', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'BTC' },
    { symbol: 'LUNAUSDT', status: 'BREAK', baseAsset: 'LUNA', quoteAsset: 'USDT' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchKlines', () => {
  it('fetches from the first host and maps rows to Candle with time in UNIX seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW_KLINES));
    vi.stubGlobal('fetch', fetchMock);

    const candles = await fetchKlines('BTCUSDT', '1m');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data-api.market-data-source-source.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(candles).toEqual([
      { time: 1722556800, open: 67000, high: 67500, low: 66800, close: 67241.5 },
      { time: 1722556860, open: 67241.5, high: 67300, low: 67100, close: 67150 },
    ]);
  });

  it('passes a custom limit through to the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW_KLINES));
    vi.stubGlobal('fetch', fetchMock);

    await fetchKlines('ETHUSDT', '1h', 42);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://data-api.market-data-source-source.vision/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=42',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('falls back to the second host when the first rejects', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse(RAW_KLINES));
    vi.stubGlobal('fetch', fetchMock);

    const candles = await fetchKlines('BTCUSDT', '1m');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.market-data-source.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500',
    );
    expect(candles).toHaveLength(2);
  });

  it('throws GeoBlockedError when every host returns HTTP 451', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ msg: 'blocked' }, 451));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchKlines('BTCUSDT', '1m')).rejects.toBeInstanceOf(GeoBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(REST_HOSTS.length);
  });

  it('does not throw GeoBlockedError when only one host returns 451', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ msg: 'blocked' }, 451))
      .mockResolvedValueOnce(jsonResponse({ msg: 'oops' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const err: unknown = await fetchKlines('BTCUSDT', '1m').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GeoBlockedError);
    expect((err as Error).message).toContain('500');
  });

  it('rethrows the last error when all hosts fail without geo-blocking', async () => {
    const boom = new TypeError('second host down');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('first host down'))
      .mockRejectedValueOnce(boom);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchKlines('BTCUSDT', '1m')).rejects.toBe(boom);
  });
});

describe('fetchTradablePairs', () => {
  it('returns only symbols with status TRADING and quoteAsset USDT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EXCHANGE_INFO));
    vi.stubGlobal('fetch', fetchMock);

    const pairs = await fetchTradablePairs();

    // The filtered query string is required: the bare endpoint is 17.4 MB raw / 316 KB gzipped,
    // this one is 2.49 MB / 51.6 KB for a provably identical TRADING+USDT set (479 symbols).
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data-api.market-data-source-source.vision/api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(pairs).toEqual(new Set(['BTCUSDT', 'ETHUSDT']));
  });

  it('falls back to the second host when the first returns 451', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ msg: 'blocked' }, 451))
      .mockResolvedValueOnce(jsonResponse(EXCHANGE_INFO));
    vi.stubGlobal('fetch', fetchMock);

    const pairs = await fetchTradablePairs();

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.market-data-source.com/api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING',
    );
    expect(pairs.has('BTCUSDT')).toBe(true);
    expect(pairs.has('ETHBTC')).toBe(false);
  });
});

describe('fetch24hrTickers', () => {
  it('fetches every symbol from the first host with a bounded timeout and returns the raw rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW_24HR));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetch24hrTickers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data-api.market-data-source-source.vision/api/v3/ticker/24hr',
      expect.objectContaining({ signal: expect.anything() }),
    );
    // Raw pass-through: parsing and filtering belong to buildCoinMarkets, not here.
    expect(rows).toEqual(RAW_24HR);
  });

  it('falls back to the second host when the first returns 451', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ msg: 'blocked' }, 451))
      .mockResolvedValueOnce(jsonResponse(RAW_24HR));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetch24hrTickers();

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.market-data-source.com/api/v3/ticker/24hr');
    expect(rows).toHaveLength(2);
  });

  it('throws GeoBlockedError when every host returns 451', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ msg: 'blocked' }, 451));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetch24hrTickers()).rejects.toBeInstanceOf(GeoBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(REST_HOSTS.length);
  });
});
