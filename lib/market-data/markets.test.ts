import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeoBlockedError, type RawTicker24h } from '@/lib/market-data/rest';
import {
  buildCoinMarkets,
  clearPairsCache,
  fetchMarketSnapshot,
  MIN_GAINER_CHANGE_PCT,
  MIN_GAINER_VOLUME,
  MIN_UNIVERSE_QUOTE_VOLUME,
  pickGainers,
  rerank,
} from '@/lib/market-data/markets';
import type { CoinMarket, LiveTicker } from '@/lib/types';

/** Minimal Response stand-in so tests never depend on the runtime's Response class. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function row(over: Partial<RawTicker24h> & { symbol: string }): RawTicker24h {
  return {
    lastPrice: '100',
    priceChangePercent: '1.5',
    highPrice: '110',
    lowPrice: '90',
    quoteVolume: String(MIN_UNIVERSE_QUOTE_VOLUME * 10),
    count: 1000,
    ...over,
  };
}

const TRADABLE = new Set([
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ZZZUSDT',
  // Both END in UP/DOWN-ish text and are REAL coins. There is no leveraged-token filter any more
  // (see Step 11) and these two are the regression guard proving it stays that way.
  'JUPUSDT', 'SYRUPUSDT',
  // Tokenized equities — Nvidia, a NASDAQ-100 ETF, Circle. Real, liquid, and not crypto markets.
  // The B-suffix RULE drops all three; the 8-name list this replaced knew about only one of them.
  'NVDABUSDT', 'QQQBUSDT', 'CRCLBUSDT',
  // The only three real crypto bases that end in B. TICKER_B_ALLOWLIST is what keeps them.
  'BNBUSDT', 'SHIBUSDT', 'ARBUSDT',
  // Dollar / fiat / metal proxies. USDCUSDT is the exchange's LARGEST USDT market by 24h volume,
  // which is precisely why it must not head a table captioned "crypto".
  'USDCUSDT', 'EURUSDT', 'XAUTUSDT',
  // A live non-ASCII base: 币安人生USDT ("Market Life"), ~$3.5M/24h, around rank 54.
  '币安人生USDT',
]);

beforeEach(() => {
  clearPairsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCoinMarkets', () => {
  it('keeps only symbols present in the tradable set', () => {
    const coins = buildCoinMarkets(
      [row({ symbol: 'BTCUSDT' }), row({ symbol: 'DOGEUSDT' }), row({ symbol: 'ETHBTC' })],
      TRADABLE,
    );
    expect(coins.map((c) => c.pair)).toEqual(['BTCUSDT']);
  });

  it('derives the base asset by stripping the 4-character USDT quote', () => {
    const [coin] = buildCoinMarkets([row({ symbol: 'SOLUSDT' })], TRADABLE);
    expect(coin).toEqual({
      id: 'sol',
      symbol: 'sol',
      name: 'Solana',
      pair: 'SOLUSDT',
      rank: 1,
      price: 100,
      change24h: 1.5,
      high24h: 110,
      low24h: 90,
      volume24h: MIN_UNIVERSE_QUOTE_VOLUME * 10,
      trades24h: 1000,
    });
  });

  it('resolves the display name from the coin-name map', () => {
    const coins = buildCoinMarkets([row({ symbol: 'BTCUSDT' }), row({ symbol: 'ETHUSDT' })], TRADABLE);
    expect(coins.map((c) => c.name).sort()).toEqual(['Bitcoin', 'Ethereum']);
  });

  it('falls back to the uppercase ticker for an unmapped base asset', () => {
    const [coin] = buildCoinMarkets([row({ symbol: 'ZZZUSDT' })], TRADABLE);
    expect(coin.name).toBe('ZZZ');
    expect(coin.id).toBe('zzz');
  });

  it('skips rows with a non-finite numeric field', () => {
    // Every value here is GENUINELY non-finite. An earlier draft used `highPrice: ''` and asserted
    // it was skipped, which was simply false: Number('') === 0, which IS finite, and there is no
    // range check on high24h — that row would have been kept and the test would have failed. If you
    // want blanks rejected, add an explicit check; do not assume `Number.isFinite` catches them.
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'BTCUSDT' }),
        row({ symbol: 'ETHUSDT', lastPrice: 'nope' }),
        row({ symbol: 'SOLUSDT', highPrice: 'NaN' }),
      ],
      TRADABLE,
    );
    expect(coins.map((c) => c.pair)).toEqual(['BTCUSDT']);
  });

  it('treats an empty numeric string as zero, not as non-finite', () => {
    // Documents the trap above so nobody re-adds the broken assertion. An empty highPrice yields a
    // KEPT row with high24h === 0; only `price` has a range check strict enough to reject blanks.
    const [coin] = buildCoinMarkets([row({ symbol: 'SOLUSDT', highPrice: '' })], TRADABLE);
    expect(coin.high24h).toBe(0);
    expect(buildCoinMarkets([row({ symbol: 'SOLUSDT', lastPrice: '' })], TRADABLE)).toEqual([]);
  });

  it('skips rows whose price is zero or negative', () => {
    const coins = buildCoinMarkets(
      [row({ symbol: 'BTCUSDT', lastPrice: '0' }), row({ symbol: 'ETHUSDT', lastPrice: '-5' })],
      TRADABLE,
    );
    expect(coins).toEqual([]);
  });

  it('keeps real tickers that merely end in UP — there is no leveraged-token filter', () => {
    const coins = buildCoinMarkets(
      [
        // SYNTHETIC volumes, deliberately well above the floor. Live, SYRUP does NOT survive the
        // universe filter at all — $0.39M of 24h quote volume, 61% BELOW the $1M floor — and JUP
        // clears it only barely at $1.31M. So this test is not a claim about real-world universe
        // membership (the source's to decide, and it changes daily). Its subject is the DELETED
        // /(UP|DOWN|BULL|BEAR)$/ regex: with the volume floor satisfied by fixture, the only thing
        // that could drop these rows is that regex coming back.
        row({ symbol: 'JUPUSDT', quoteVolume: String(MIN_UNIVERSE_QUOTE_VOLUME * 5) }),
        row({ symbol: 'SYRUPUSDT', quoteVolume: String(MIN_UNIVERSE_QUOTE_VOLUME * 5) }),
      ],
      TRADABLE,
    );
    // The upstream has RETIRED every BLVT UP/DOWN token: there are ZERO leveraged tokens in the current
    // TRADING USDT set. So a /(UP|DOWN|BULL|BEAR)$/ filter has no true positives available and
    // produces only false ones — it deletes JUP (Jupiter) and SYRUP, both real coins.
    expect(coins.map((c) => c.id).sort()).toEqual(['jup', 'syrup']);
  });

  it('excludes stablecoin, fiat and metal bases from the UNIVERSE, not just from the strip', () => {
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'USDCUSDT', quoteVolume: '908000000' }),
        row({ symbol: 'EURUSDT', quoteVolume: '60000000' }),
        row({ symbol: 'XAUTUSDT', quoteVolume: '40000000' }),
        row({ symbol: 'BTCUSDT', quoteVolume: '518000000' }),
      ],
      TRADABLE,
    );
    // The fixture volumes are the measured live ones, and they are the whole argument: a pure
    // 24h-volume ranking puts USD Coin at #1 ($908M) ABOVE Bitcoin at #2 ($518M), the Euro at #7,
    // and fills 7 of the visible 50 rows with dollar proxies carrying 43.6% of the visible volume.
    // "USD Coin, Bitcoin, Caldera" reads as broken data to a client, so isStableBase is a UNIVERSE
    // filter here — not merely a gainers-strip filter.
    expect(coins.map((c) => c.id)).toEqual(['btc']);
  });

  it('excludes tokenized equities by the B-suffix rule, with no list to maintain', () => {
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'NVDABUSDT', quoteVolume: '99000000' }),
        row({ symbol: 'QQQBUSDT', quoteVolume: '99000000' }),
        row({ symbol: 'CRCLBUSDT', quoteVolume: '99000000' }),
        row({ symbol: 'BTCUSDT' }),
      ],
      TRADABLE,
    );
    // Nvidia, a NASDAQ-100 ETF and Circle. `exchangeInfo` carries NO machine-readable marker for
    // any of them — NVDABUSDT and BTCUSDT have byte-identical permissions and permissionSets — so
    // nothing can be inferred from the API and this has to be a naming rule. The 8-name list it
    // replaces was already stale: 7 equity tokens above the $1M floor were missing from it (SNXXB,
    // CRCLB, NBISB, NVDAB, MUUB, DRAMB, INTCB) with TSLAB, AMDB, GOOGLB, AAPLB, SPYB and ~25 more
    // queued just below.
    expect(coins.map((c) => c.id)).toEqual(['btc']);
  });

  it('keeps the three real crypto bases that end in B', () => {
    const coins = buildCoinMarkets(
      [row({ symbol: 'BNBUSDT' }), row({ symbol: 'SHIBUSDT' }), row({ symbol: 'ARBUSDT' })],
      TRADABLE,
    );
    // Measured: exactly 3 false positives against 15 true positives, and TICKER_B_ALLOWLIST is all
    // three of them. Deleting the allowlist deletes BNB from a demo.
    expect(coins.map((c) => c.id).sort()).toEqual(['arb', 'bnb', 'shib']);
  });

  it('excludes a base that is not plain A-Z0-9', () => {
    const coins = buildCoinMarkets(
      [row({ symbol: '币安人生USDT', quoteVolume: '3500000' }), row({ symbol: 'BTCUSDT' })],
      TRADABLE,
    );
    // 币安人生USDT ("Market Life") is live today at ~$3.5M of 24h volume, around rank 54 — one quiet
    // day from the visible 50. It breaks three specified behaviours at once: avatarLetter's /[A-Z]/
    // matches nothing, so the avatar renders a CJK glyph at 11px inside a 24px circle; the route
    // becomes /coin/%E5%B8%81%E5%AE%89%E4%BA%BA%E7%94%9F, an encoding nothing in the design
    // specifies; and isStableBase does not catch it, so it could render as a gainer chip.
    expect(coins.map((c) => c.id)).toEqual(['btc']);
  });

  it('skips pairs below MIN_UNIVERSE_QUOTE_VOLUME', () => {
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'BTCUSDT', quoteVolume: String(MIN_UNIVERSE_QUOTE_VOLUME) }),
        row({ symbol: 'ETHUSDT', quoteVolume: String(MIN_UNIVERSE_QUOTE_VOLUME - 1) }),
      ],
      TRADABLE,
    );
    expect(coins.map((c) => c.pair)).toEqual(['BTCUSDT']);
  });

  it('sorts by 24h quote volume descending, breaking ties by pair ascending', () => {
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'SOLUSDT', quoteVolume: '5000000' }),
        row({ symbol: 'ETHUSDT', quoteVolume: '9000000' }),
        row({ symbol: 'BTCUSDT', quoteVolume: '9000000' }),
      ],
      TRADABLE,
    );
    expect(coins.map((c) => c.pair)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('assigns 1-based contiguous ranks after sorting', () => {
    const coins = buildCoinMarkets(
      [
        row({ symbol: 'SOLUSDT', quoteVolume: '3000000' }),
        row({ symbol: 'ETHUSDT', quoteVolume: '9000000' }),
        row({ symbol: 'BTCUSDT', quoteVolume: '99000000' }),
        row({ symbol: 'DOGEUSDT', quoteVolume: '99000000' }), // not tradable → dropped
      ],
      TRADABLE,
    );
    expect(coins.map((c) => [c.id, c.rank])).toEqual([
      ['btc', 1],
      ['eth', 2],
      ['sol', 3],
    ]);
  });
});

describe('fetchMarketSnapshot', () => {
  const EXCHANGE_INFO = {
    symbols: [
      { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
      { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' },
      { symbol: 'ETHBTC', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'BTC' },
      { symbol: 'LUNAUSDT', status: 'BREAK', baseAsset: 'LUNA', quoteAsset: 'USDT' },
    ],
  };

  const TICKERS = [
    row({ symbol: 'BTCUSDT', quoteVolume: '2810000000' }),
    row({ symbol: 'ETHUSDT', quoteVolume: '990000000' }),
    row({ symbol: 'ETHBTC', quoteVolume: '500000000' }),
    row({ symbol: 'LUNAUSDT', quoteVolume: '400000000' }),
  ];

  /** Routes by URL so the two parallel calls can be answered independently. */
  function route(handler: (url: string) => Response | Promise<Response>) {
    const fn = vi.fn((url: string) => Promise.resolve(handler(url)));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  const happyPath = (url: string) =>
    url.includes('/ticker/24hr') ? jsonResponse(TICKERS) : jsonResponse(EXCHANGE_INFO);

  it('requests ticker/24hr and exchangeInfo from the primary host', async () => {
    const fetchMock = route(happyPath);

    await fetchMarketSnapshot();

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain('https://data-api.market-data source.vision/api/v3/ticker/24hr');
    expect(urls).toContain(
      'https://data-api.market-data source.vision/api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING',
    );
    expect(urls).toHaveLength(2);
  });

  it('keeps only TRADING USDT pairs, so a BTC-quoted and a halted pair are both dropped', async () => {
    route(happyPath);

    const coins = await fetchMarketSnapshot();

    expect(coins.map((c) => c.pair)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('ranks the snapshot by 24h quote volume', async () => {
    route(happyPath);

    const coins = await fetchMarketSnapshot();

    expect(coins.map((c) => [c.id, c.rank, c.volume24h])).toEqual([
      ['btc', 1, 2_810_000_000],
      ['eth', 2, 990_000_000],
    ]);
  });

  it('falls back to the second host when the primary fails for one of the two calls', async () => {
    const fetchMock = route((url) => {
      if (url.startsWith('https://data-api.market-data source.vision') && url.includes('/ticker/24hr')) {
        return jsonResponse({ msg: 'oops' }, 500);
      }
      return happyPath(url);
    });

    const coins = await fetchMarketSnapshot();

    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      'https://api.market-data source.com/api/v3/ticker/24hr',
    );
    expect(coins.map((c) => c.id)).toEqual(['btc', 'eth']);
  });

  it('propagates GeoBlockedError when every host returns 451', async () => {
    route(() => jsonResponse({ msg: 'blocked' }, 451));

    await expect(fetchMarketSnapshot()).rejects.toBeInstanceOf(GeoBlockedError);
  });

  it('fetches exchangeInfo once per session and reuses it on the next snapshot', async () => {
    // The memo in `tradablePairs` is the reason the 2.49 MB exchangeInfo payload is not re-fetched on
    // every snapshot refresh. Deleting it leaves every other test in this file green, so this is the
    // only guard: the ticker call repeats per snapshot, the exchangeInfo call must not.
    const fetchMock = route(happyPath);

    await fetchMarketSnapshot();
    await fetchMarketSnapshot();

    const infoCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/exchangeInfo'));
    const tickerCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/ticker/24hr'));
    expect(infoCalls).toHaveLength(1);
    expect(tickerCalls).toHaveLength(2);
  });

  it('does not memoise an exchangeInfo failure, so a retry can still succeed', async () => {
    // The `.catch` reset inside `tradablePairs` is what makes a retry possible. Without it a single
    // transient exchangeInfo failure poisons `pairsPromise` for the whole page session: every later
    // refresh replays the same rejected promise, so the app is stuck in the degraded tickers-only
    // table until a hard reload. Nothing else in the suite notices that.
    let failInfo = true;
    route((url) => {
      if (url.includes('/exchangeInfo') && failInfo) return jsonResponse({ msg: 'oops' }, 500);
      return happyPath(url);
    });

    await expect(fetchMarketSnapshot()).rejects.toBeInstanceOf(Error);
    failInfo = false;
    const coins = await fetchMarketSnapshot();

    expect(coins.map((c) => c.id)).toEqual(['btc', 'eth']);
  });
});

describe('pickGainers', () => {
  /** A ready-made CoinMarket — pickGainers consumes the OUTPUT of buildCoinMarkets, not raw rows. */
  function coin(over: Partial<CoinMarket> & { id: string; change24h: number }): CoinMarket {
    return {
      symbol: over.id,
      name: over.id.toUpperCase(),
      pair: `${over.id.toUpperCase()}USDT`,
      rank: 1,
      price: 1,
      high24h: 1.1,
      low24h: 0.9,
      volume24h: MIN_GAINER_VOLUME,
      trades24h: 1000,
      ...over,
    };
  }

  /** Enough qualifying movers that the MIN_GAINER_CHIPS floor is never what a test is measuring. */
  const FILLER = [
    coin({ id: 'aaa', change24h: 2 }),
    coin({ id: 'bbb', change24h: 2 }),
    coin({ id: 'ccc', change24h: 2 }),
  ];

  it('excludes coins below MIN_GAINER_VOLUME', () => {
    const gainers = pickGainers([
      ...FILLER,
      coin({ id: 'micro', change24h: 90, volume24h: MIN_GAINER_VOLUME - 1 }),
    ]);
    // The +90% micro-cap is exactly what the floor exists to keep off the strip. Note the floor is
    // $2M, and both $10M and $3M were measured and rejected: at $10M only 3 live candidates clear
    // +2% (and a real move like BICO +51% on ~$6M was excluded for being insufficiently liquid);
    // at $3M there were exactly 7 candidates for exactly 7 slots — no headroom, so the strip
    // rendered +2.00% / +2.02% / +2.05% chips, which is the barrel-scraping look the +2% gate
    // exists to prevent. $2M yields ~10 candidates, so the gate can actually reject something.
    expect(gainers.map((c) => c.id)).not.toContain('micro');
  });

  it('excludes coins that moved less than MIN_GAINER_CHANGE_PCT', () => {
    const gainers = pickGainers([
      ...FILLER,
      coin({ id: 'weak', change24h: MIN_GAINER_CHANGE_PCT - 0.1 }),
      coin({ id: 'flat', change24h: 0 }),
      coin({ id: 'down', change24h: -4 }),
    ]);
    // A +1% chip is not a rally and makes the strip look like it is scraping the barrel.
    expect(gainers.map((c) => c.id).sort()).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('excludes stablecoin bases, whose moves are depegs rather than rallies', () => {
    const gainers = pickGainers([
      ...FILLER,
      // Redundant against the real pipeline — Task 11's isCryptoBase already keeps these out of the
      // universe — and kept deliberately: pickGainers is a pure function over a caller-supplied
      // list, and this test feeds it stablecoins directly. Measured live: USDC is the #1 USDT market
      // by volume, with USD1, EUR, XAUT and RLUSD all inside the top 20. The two-entry version of
      // STABLE_BASES shipped a gainers strip reading "USD1 +0.00%".
      coin({ id: 'usdc', symbol: 'usdc', change24h: 3 }),
      coin({ id: 'usd1', symbol: 'usd1', change24h: 4 }),
      coin({ id: 'rlusd', symbol: 'rlusd', change24h: 5 }),
      coin({ id: 'eur', symbol: 'eur', change24h: 6 }),
      coin({ id: 'xaut', symbol: 'xaut', change24h: 7 }),
    ]);
    expect(gainers.map((c) => c.id).sort()).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('treats any unlisted base containing USD as a stablecoin too', () => {
    // Belt and braces: a dollar proxy listed next week is excluded before anyone updates the set.
    const gainers = pickGainers([...FILLER, coin({ id: 'newusd', symbol: 'newusd', change24h: 9 })]);
    expect(gainers.map((c) => c.id)).not.toContain('newusd');
  });

  it('sorts by 24h change descending and caps at 7 by default', () => {
    const input = Array.from({ length: 12 }, (_, i) =>
      coin({ id: `c${i}`, change24h: i + 3 }),
    );
    const gainers = pickGainers(input);
    expect(gainers).toHaveLength(7);
    expect(gainers.map((c) => c.change24h)).toEqual([14, 13, 12, 11, 10, 9, 8]);
    expect(pickGainers(input, 3).map((c) => c.change24h)).toEqual([14, 13, 12]);
  });

  it('renders nothing rather than a short list when fewer than 3 movers qualify', () => {
    // Two real movers is not a strip. Better to say "nothing is up 2%" than to show a stub.
    expect(pickGainers([coin({ id: 'a', change24h: 9 }), coin({ id: 'b', change24h: 8 })])).toEqual([]);
    expect(
      pickGainers([coin({ id: 'a', change24h: 9 }), coin({ id: 'b', change24h: 8 }), coin({ id: 'c', change24h: 7 })]),
    ).toHaveLength(3);
  });

  it('returns an empty array on a deep-red day rather than padding the strip', () => {
    expect(pickGainers([coin({ id: 'btc', change24h: -1 }), coin({ id: 'eth', change24h: -9 })]))
      .toEqual([]);
  });
});

describe('rerank', () => {
  /** A ready-made CoinMarket — rerank consumes the store's universe, not raw rows. */
  function coin(over: Partial<CoinMarket> & { id: string; volume24h: number }): CoinMarket {
    return {
      symbol: over.id,
      name: over.id.toUpperCase(),
      pair: `${over.id.toUpperCase()}USDT`,
      rank: 1,
      price: 100,
      change24h: 1.5,
      high24h: 110,
      low24h: 90,
      trades24h: 1000,
      ...over,
    };
  }

  function ticker(pair: string, volume24h: number): LiveTicker {
    return {
      pair,
      price: 100,
      open24h: 98,
      high24h: 110,
      low24h: 90,
      volume24h,
      updatedAt: 1_722_600_000_000,
    };
  }

  // Deliberately chosen so volume order (btc, eth, ada) and pair order (ADA, BTC, ETH) DISAGREE.
  // With matching orders a broken volume fallback would still produce ranks 1..3 in the original
  // sequence and the test would pass while the ranking was destroyed.
  const UNIVERSE = [
    coin({ id: 'btc', volume24h: 3_000_000_000 }),
    coin({ id: 'eth', volume24h: 2_000_000_000 }),
    coin({ id: 'ada', volume24h: 1_000_000_000 }),
  ];

  it('keeps each snapshot volume, and the whole order, when the ticker map is empty', () => {
    // The reachable path, not a hypothetical: the socket gives up → setStatus('polling') clears the
    // ticker map to {} → the visibility handler's else-branch calls rerankFromTickers() against it.
    // With the `?? c.volume24h` fallback broken to `?? 0`, every volume reads $0, the Markets table
    // silently re-sorts alphabetically by pair, and pickGainers (re-run inside setCoins) empties the
    // gainers strip. Nothing else in the suite notices.
    const out = rerank(UNIVERSE, {});
    expect(out.map((c) => [c.id, c.volume24h, c.rank])).toEqual([
      ['btc', 3_000_000_000, 1],
      ['eth', 2_000_000_000, 2],
      ['ada', 1_000_000_000, 3],
    ]);
  });

  it('takes the live volume where a tick exists and the snapshot volume where none does', () => {
    const out = rerank(UNIVERSE, { ETHUSDT: ticker('ETHUSDT', 9_000_000_000) });
    // ETH out-trades everything on the live figure; BTC and ADA keep their snapshot volumes and
    // fall in behind it rather than collapsing to zero.
    expect(out.map((c) => [c.id, c.volume24h, c.rank])).toEqual([
      ['eth', 9_000_000_000, 1],
      ['btc', 3_000_000_000, 2],
      ['ada', 1_000_000_000, 3],
    ]);
  });

  it('breaks equal volumes by pair ascending, so the row order is deterministic', () => {
    // Same tie-break as buildCoinMarkets: without it the Markets table can reshuffle rows on a
    // re-rank that learned nothing, which reads as a glitch.
    const out = rerank(
      [
        coin({ id: 'sol', volume24h: 5_000_000 }),
        coin({ id: 'ada', volume24h: 5_000_000 }),
        coin({ id: 'eth', volume24h: 5_000_000 }),
      ],
      {},
    );
    expect(out.map((c) => [c.pair, c.rank])).toEqual([
      ['ADAUSDT', 1],
      ['ETHUSDT', 2],
      ['SOLUSDT', 3],
    ]);
  });

  it('does not mutate the coins it was given', () => {
    // rerank rewrites volume24h and rank, and the store publishes its result as a new `coins` array.
    // Mutating the input in place would rewrite the objects the previous render still holds.
    const input = [coin({ id: 'btc', volume24h: 3_000_000_000, rank: 1 })];
    rerank(input, { BTCUSDT: ticker('BTCUSDT', 8_000_000_000) });
    expect(input[0].volume24h).toBe(3_000_000_000);
    expect(input[0].rank).toBe(1);
  });
});
