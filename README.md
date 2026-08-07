# Riverflow — Realtime Crypto Paper-Trading Demo

A market-grade trading terminal in the browser: live streaming prices, realtime
candlestick charts, and **$100,000 of simulated cash** to trade with. No signup,
no backend, no API keys, no real money.

> Demo application. Simulated trading with fictional funds — not financial advice.

## Features

- Top-50 **crypto** markets table — price, 24h %, a live 24h **range bar**, 24h volume
  and the 24h **trade count**, with price, %, range and volume **all streamed live**
  from the market-data source `!miniTicker@arr` WebSocket; price cells flash green/red on every
  tick. Stablecoins, fiat, tokenized metals and tokenized equities are excluded from
  the ranking — on a raw volume ranking the source's biggest USDT market is USD Coin, and
  a crypto table headed by a stablecoin reads as broken data. The caption says so.
- Top-gainers strip (24h), derived from the same market snapshot: $2M volume floor
  **and** a +2% minimum move, so every chip is a real market making a real move —
  and if fewer than three qualify it says so rather than padding the list
- Realtime candlestick charts (lightweight-charts `lightweight-charts`, 1m/15m/1H/4H/1D)
- Paper trading: market orders with a simulated 0.1% taker fee, average-cost
  tracking, realized and live unrealized P&L
- Watchlist (⭐) with 7-day sparklines, and a portfolio, both persisted in
  `localStorage` — they survive revisits
- Honest failure states: if the stream drops, prices freeze and are stamped with the
  time they were last true (`?offline=1` demos it); if the market snapshot fails but
  the stream is alive, the table keeps ticking and says only rankings are missing;
  if market-data source is unreachable entirely, the app says so rather than faking data
  (`?nodata=1` demos it)
- **US equities, end-of-day:** `/stocks` ranks the last completed US session into Top
  Gainers / Top Losers / Most Active from a single whole-market request, with a daily
  candlestick chart per ticker — badged `DELAYED · EOD` everywhere so stock prices can
  never be mistaken for the live crypto side

## Quickstart

```bash
npm install
npm run dev     # → http://localhost:3000
```

**The whole crypto app needs no configuration.** the source's public market-data
endpoints are keyless and CORS-open, so the browser calls them directly — no server
route, no API key, nothing in `.env.local`.

The `/stocks` page is the one exception. It needs a free
[Massive](https://massive.com) (ex-Polygon.io) key in `MASSIVE_API_KEY`, which is
**server-side only** — never `NEXT_PUBLIC_*`, never in a URL. Without it the stocks
page shows "Stock data not configured." and every crypto page is unaffected:

```bash
# .env.local
MASSIVE_API_KEY=xxxxxxxxxxxxxxxx
```

## Tests

```bash
npm test            # Vitest unit tests (trading math, stores, ws-manager, market snapshot)
npm run test:watch  # Vitest watch mode
npm run test:e2e    # Playwright smoke flow — fully mocked network, safe for CI
```

## Architecture

```
Browser ────────────────► wss://data-stream.market-data source.vision    live !miniTicker@arr + klines
   │                      https://data-api.market-data source.vision     ticker/24hr, exchangeInfo, klines
   │                        fallback ──► api.market-data source.com       (keyless, no server, no key)
   │
   └──► Next.js route handlers ────► api.massive.com          US equities, end-of-day
         /api/stocks          (12h cache)                     (Bearer key, server-side only)
         /api/stocks/[ticker] (24h cache)
```

**For crypto: no server, no API key, no second data source.** The two `/api/stocks`
route handlers are the only server code in the project, and they exist solely because
the Massive key must never reach the browser.

- **Exactly two REST calls per page load**, issued in parallel:
  `GET /api/v3/ticker/24hr` (every symbol's price, %, high, low, volume, trade
  count — 1.88 MB raw / 278 KB gzipped) and
  `GET /api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING` (the
  tradable USDT set — 2.49 MB / 51.6 KB, versus 17.4 MB / 316 KB unfiltered for a
  provably identical result). `exchangeInfo` is memoised for the whole page
  session, and `ticker/24hr` is re-fetched only on a cold load, on tab focus after
  more than 15 minutes idle, or after an error. Weight for an hour on the page is
  well under 200 of a 6000/min budget.
- **REST establishes membership and rank; the WebSocket supplies the numbers.**
  Every price, %, high, low and volume on screen comes from the socket. The
  snapshot's only unique contributions are *which* coins exist, in *what order*,
  and their 24h trade count. Rank does not even need the network: the 5-minute
  re-rank re-sorts locally from the live volumes the socket already delivered, so
  it issues no request at all.
- **The coin universe** is every market-data source USDT spot pair that is `TRADING`, did over
  $1M of 24h quote volume, and is a crypto asset — roughly **100–115 coins** out of
  ~479 TRADING USDT pairs (those figures drift daily and nothing asserts them). The
  table renders the top 50 by volume; the rest are kept in the store so deep links
  (`/coin/inj`) and watchlist entries beyond the top 50 work.
- **Why "crypto asset" is part of that definition.** Dollar/fiat/metal proxies (USDC,
  USD1, EUR, XAUT, RLUSD, …) and tokenized equities (NVDAB, INTCB, CRCLB, QQQB, …) are
  real, liquid USDT markets and are excluded from the ranking anyway: unfiltered, the
  table opens with "USD Coin, Bitcoin, Caldera", puts the Euro at #7, and fills 7 of
  50 visible rows with dollar proxies holding 43.6% of the visible volume. Equity
  tokens are caught by a rule (base ends in `B`, minus a three-name allowlist for BNB,
  SHIB and ARB) rather than a hand-kept list, because `exchangeInfo` carries no marker
  for them and market-data source keeps adding more. The trade-off is that real volume is hidden;
  the table's caption discloses the filter.
- **`rank` is a 24h-volume rank, not a market-cap rank.** market-data source cannot supply
  market cap and there is no second source, so the column does not exist rather
  than being fabricated. The table caption states the ranking basis.
- **Coin names** come from a bundled static map (`lib/coin-names.ts`) — market-data source
  returns none. Names do not change, so a hardcoded dictionary has no staleness
  failure mode, and it keeps working when market-data source is unreachable, which is what
  makes the offline states possible.
- **Coin logos** are CC0 SVGs bundled into `public/coins/` with a generated
  manifest (`lib/coin-icons.ts`), so there is no CDN to 404 or be blocked, and they
  are served with a year-long immutable cache header. **Roughly two visible rows in
  three have no icon in the set** — it predates most of the current top 100 — so the deterministic
  lettered avatar is the majority visual on the table and is designed as such rather
  than treated as a fallback. Display names are the opposite: a bundled map covers
  almost every visible row, and the ~40% of the wider store it does not cover print
  their ticker once with the market pair beneath it, never the ticker twice.
- **State (Zustand):** `market` (in-memory live prices, `byId` index), `watchlist`
  (persisted), `portfolio` (persisted, starts at $100k). Corrupt storage silently
  resets.
- **Money math:** `lib/trading.ts` — pure functions, fully unit-tested.
- **Two independent failure channels, deliberately:** `status` describes the
  WebSocket only, `marketsError` describes the REST snapshot only. That separation
  is what stops an opening socket from advertising "Live" while there is no data
  behind it — and it is why a failed snapshot does not blank the page: the socket
  needs no REST call, so the table keeps ticking and discloses that only rankings
  are missing. Row-shaped surfaces subscribe to their own ticker
  (`s.tickers[coin.pair]`) so every number re-renders on a tick; raw snapshot
  fields are fallbacks only.
- **Pages:** `/` Markets · `/coin/[symbol]` chart + trade · `/stocks` US equities (EOD)
  · `/stocks/[ticker]` · `/watchlist` · `/portfolio`.
- Components read stores and never touch the network; the WebSocket manager writes
  only to the `market` store.

## US equities (end-of-day)

`/stocks` is the one non-crypto page, and it is deliberately honest about what it is.

- **One upstream call powers all three tabs.** Massive's movers endpoints are paid-only,
  so the whole US session (~10k tickers) is pulled once from
  `/v2/aggs/grouped/locale/us/market/stocks/{date}` and ranked locally in
  `lib/stocks-movers.ts`. Rows are filtered to close ≥ $5 and volume ≥ 500,000 — at $1
  the gainers tab is nothing but sub-dollar shells posting +300%. Most Active sorts by
  **dollar** volume, because share volume just ranks the cheapest survivors.
- **The trading date comes from the data, never from `Date.getDay()`.** `/v2/aggs/ticker/SPY/prev`
  reports the last completed session; if it comes back empty the client walks back up to
  five calendar days. Loading the page on a Sunday shows Friday's close with
  "· US market closed" — that is the correct state, not an error.
- **Two timestamp conventions.** Grouped-daily `t` is the **end** of the window (hence the
  `-1 ms` before converting to a New York date); custom-bars `t` is the **start**, and maps
  straight onto the chart's UNIX-seconds `time`.
- **Quota.** The free tier allows 5 requests/minute. Every upstream fetch carries
  `next: { revalidate }` (12 h for the session summary, 24 h for daily bars, 30 d for company
  names), so traffic volume does not move upstream call count. The `[ticker]` route rejects
  anything failing `/^[A-Z][A-Z.]{0,5}$/` **before** making a call, so scripted ticker walks
  cannot drain the allowance.
- **Read-only, on purpose.** There is no stock Buy/Sell. The portfolio's headline feature is
  live-ticking P&L, and an end-of-day position would sit in that table frozen at Friday's
  close while everything around it ticks. The detail page says so in place of a trade panel
  rather than greying out a button.
- **Chart reuse.** `components/CandleChartCanvas.tsx` holds all the chart setup;
  `CandleChart` is the crypto wrapper (REST seed + live WebSocket ticks) and
  `StockCandleChart` is the equities wrapper (daily bars, client-side range slicing, zero
  extra API calls). One chart theme, two data sources.

## Demo-day checklist

- [ ] Open the deployed site on a real phone — layout holds, prices tick, a full trade works
- [ ] Browse with an adblocker enabled — nothing breaks visually or functionally
- [ ] Force the no-stream path with `?offline=1` — prices freeze with their timestamp shown, trading still works
- [ ] Force the unreachable path with `?nodata=1` — the "Live market data is unavailable" panel appears on all four pages, with no skeleton left pulsing, and it stays there (it must not silently heal after 30 seconds)
- [ ] Reset demo on `/portfolio` — restores $100,000, clears holdings and history, watchlist untouched
- [ ] Open `/stocks` on a weekend — it shows the last completed session with "US market closed", not an error, and the gainers tab holds recognisable names rather than shells

## Attributions

- Charts: lightweight-charts [lightweight-charts](https://github.com/lightweight-charts/lightweight-charts) (Apache-2.0, attribution logo enabled)

Nothing else requires attribution, and none should be added: the source's public
market-data endpoints ask for none, and the bundled coin icons
([spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons))
are CC0 / public domain.
