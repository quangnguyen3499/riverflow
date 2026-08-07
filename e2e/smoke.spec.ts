import { test, expect, type Request, type Route } from '@playwright/test';
import type { RawTicker24h } from '@/lib/market-data/rest';

// GET /api/v3/exchangeInfo — establishes the tradable USDT universe.
const exchangeInfoFixture = {
  timezone: 'UTC',
  symbols: [
    { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
    { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' },
    { symbol: 'ETHBTC', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'BTC' },
    // Halted: must not reach the table.
    { symbol: 'LUNAUSDT', status: 'BREAK', baseAsset: 'LUNA', quoteAsset: 'USDT' },
    // Genuinely TRADING and USDT-quoted. Only isCryptoBase keeps it off the table.
    { symbol: 'USDCUSDT', status: 'TRADING', baseAsset: 'USDC', quoteAsset: 'USDT' },
  ],
};

// GET /api/v3/ticker/24hr — every numeric is a string, exactly as the source sends it.
const tickerFixture: RawTicker24h[] = [
  {
    symbol: 'BTCUSDT',
    lastPrice: '100000.00',
    priceChangePercent: '2.500',
    highPrice: '101500.00',
    lowPrice: '97800.00',
    quoteVolume: '30000000000.00',
    count: 1_204_331,
  },
  {
    symbol: 'ETHUSDT',
    lastPrice: '4000.00',
    priceChangePercent: '-1.200',
    highPrice: '4090.00',
    lowPrice: '3950.00',
    quoteVolume: '15000000000.00',
    count: 622_004,
  },
  // Not in exchangeInfo → dropped. Proves the tradable-set filter really runs.
  {
    symbol: 'SOLUSDT',
    lastPrice: '200.00',
    priceChangePercent: '5.100',
    highPrice: '205.00',
    lowPrice: '188.00',
    quoteVolume: '4000000000.00',
    count: 300_000,
  },
  // Non-USDT quote → dropped.
  {
    symbol: 'ETHBTC',
    lastPrice: '0.04',
    priceChangePercent: '0.300',
    highPrice: '0.041',
    lowPrice: '0.039',
    quoteVolume: '900000000.00',
    count: 50_000,
  },
  // Tradable, USDT-quoted, and the HIGHEST volume here — so on a pure volume ranking it heads the
  // table, which is exactly what happens against live market-data source (USD Coin $908M vs Bitcoin $518M).
  // The crypto-only universe filter is the only thing that drops it. Its `count` is the measured
  // live figure and is a reminder that trade count is not a depth signal.
  {
    symbol: 'USDCUSDT',
    lastPrice: '1.0001',
    priceChangePercent: '0.010',
    highPrice: '1.0003',
    lowPrice: '0.9998',
    quoteVolume: '90000000000.00',
    count: 3_286,
  },
];

// GET /api/v3/klines — [openTime(ms), open, high, low, close, volume, closeTime, …]
const klinesFixture = [
  [1_722_556_800_000, '99000.00', '99500.00', '98800.00', '99400.00', '12.3', 1_722_556_859_999],
  [1_722_556_860_000, '99400.00', '100200.00', '99300.00', '100000.00', '9.9', 1_722_556_919_999],
];

/** Single handler for both market-data hosts, so nothing can silently reach the real network. */
async function market-data source(route: Route, request: Request) {
  const url = request.url();
  // `includes`, not equality: the real request carries ?showPermissionSets=false&symbolStatus=TRADING,
  // which shrinks that payload from 17.4 MB to 2.49 MB for an identical result.
  if (url.includes('/api/v3/exchangeInfo')) return route.fulfill({ json: exchangeInfoFixture });
  if (url.includes('/api/v3/ticker/24hr')) return route.fulfill({ json: tickerFixture });
  if (url.includes('/api/v3/klines')) return route.fulfill({ json: klinesFixture });
  // Anything unmocked fails loudly rather than escaping to the internet.
  return route.fulfill({ status: 404, json: { msg: `unmocked: ${url}` } });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://data-api.market-data source.vision/**', market-data source);
  await page.route('https://api.market-data source.com/**', market-data source);
});

test('smoke: markets → star → coin detail → buy → portfolio → watchlist', async ({ page }) => {
  // 1. Land on Markets with the stream forced off, so prices are frozen at the fixture values.
  await page.goto('/?offline=1');
  // OfflineBanner (renamed from GeoBanner) states a TIMESTAMP, never a refresh cadence — matching on
  // "prices shown as of" is therefore stable copy, whereas "refresh every 30s" was a false claim.
  await expect(page.getByText(/prices shown as of/i).first()).toBeVisible();

  // 2. The table shows exactly the two tradable CRYPTO USDT markets, BTC first (highest crypto volume).
  const btcRow = page.getByRole('row', { name: /bitcoin/i });
  await expect(btcRow).toBeVisible();
  await expect(btcRow).toContainText('100,000.00');
  // 24h Trades comes from RawTicker24h.count — a snapshot value the miniTicker frame does not carry.
  await expect(btcRow).toContainText('1,204,331');
  await expect(page.getByRole('row', { name: /ethereum/i })).toBeVisible();
  // SOLUSDT was in ticker/24hr but not in exchangeInfo, so it must not be listed.
  await expect(page.getByRole('row', { name: /solana/i })).toHaveCount(0);
  // USDCUSDT is TRADING, USDT-quoted and the largest market in the fixture — unfiltered it would be
  // row #1. The crypto-only universe filter (isCryptoBase) is what keeps it off a table captioned
  // "crypto", and this assertion is the end-to-end proof that the filter actually runs.
  await expect(page.getByRole('row', { name: /usd coin/i })).toHaveCount(0);

  // 3. Star BTC — the star is the row's only <button>; stopPropagation means no navigation.
  await btcRow.getByRole('button').first().click();
  await expect(page).toHaveURL(/offline=1/); // still on Markets

  // 4. Open the coin detail page by clicking the row's name cell
  //    (client-side nav keeps the offline mode in the market store).
  await btcRow.getByText('Bitcoin').click();
  await expect(page).toHaveURL(/\/coin\/btc/);
  await expect(page.getByText('Bitcoin').first()).toBeVisible();

  // 5. Buy 0.1 BTC at the fixture price: notional 10,000 + 0.1% fee = 10,010.00.
  //    Trading stays ENABLED in offline mode (the price is real, just not live), so this must work.
  //    The Buy/Sell side tabs are also <button>s whose names would match /buy/i, so target the
  //    submit button by its exact accessible name "Buy BTC" (Task 20).
  await page.getByRole('spinbutton').first().fill('0.1');
  await page.getByRole('button', { name: /^buy btc$/i }).click();

  // 6. Success toast (sonner).
  await expect(page.getByText(/order filled/i).first()).toBeVisible();

  // 7. Portfolio shows the position and the updated cash: 100,000 − 10,010 = $89,990.00.
  await page.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page).toHaveURL(/\/portfolio/);
  await expect(page.getByText(/btc/i).first()).toBeVisible();
  await expect(page.getByText('$89,990.00').first()).toBeVisible();

  // 8. Watchlist shows the starred coin.
  await page.getByRole('link', { name: 'Watchlist' }).click();
  await expect(page).toHaveURL(/\/watchlist/);
  await expect(page.getByText('Bitcoin').first()).toBeVisible();
});
