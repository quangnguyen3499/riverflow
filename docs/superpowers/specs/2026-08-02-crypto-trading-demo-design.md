# Crypto Trading Demo ("Riverflow") — Design Spec

**Date:** 2026-08-02
**Status:** Approved pending user review
**Purpose:** A portfolio demo website that proves to prospective clients we can build a polished, realtime, market-grade trading UI. The demo must impress within the first 30 seconds of a cold visit and let the visitor *do* something (paper-trade) without any signup.

## 1. Goals and success criteria

- A client landing on the site sees live-ticking prices within ~3 seconds, no login wall.
- A first-time visitor can buy a coin with the demo balance within 60 seconds, unassisted.
- The site never looks broken during a live demo — every failure mode degrades gracefully.
- Works on mobile; total build effort ≈ 1 week.
- Non-goals: real trading, real money, user accounts, backend persistence.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Audience | General portfolio piece for winning client work |
| Trading depth | Paper trading, no login — $100k demo balance in localStorage |
| Stack | Next.js (App Router) + TypeScript + Tailwind CSS, deployed on Vercel Hobby |
| Visual style | Pro Terminal (market-data source-like dark, dense, green/red) for market pages; cleaner fintech touches on Portfolio |
| Architecture | Hybrid browser-direct: market-data source WebSocket in the browser + cached CoinGecko proxy routes |
| Charting | lightweight-charts `lightweight-charts` v5 (Apache-2.0, attribution logo on) |
| Working name | "Riverflow" (placeholder branding, rename anytime) |

## 3. Pages (4)

### 3.1 Markets — `/` (landing page, the first impression)
- **Trending strip** at top: the 15 CoinGecko trending coins as horizontal cards (logo, symbol, price, 24h %). Data from `/api/trending`.
- **Top-50 table** below: rank, logo, name/symbol, live price, 24h %, 24h volume, market cap, 7-day sparkline, star toggle.
  - Metadata + initial prices from `/api/markets`; live prices overlaid from the market-data source all-market ticker stream.
  - Price cells flash green/red on each change.
  - Row click → coin detail; star click → watchlist (event does not navigate).
- Header (all pages): logo, nav (Markets · Watchlist · Portfolio), demo cash balance chip, connection badge, ⌘K search.

### 3.2 Coin detail + trade — `/coin/[symbol]`
- **Live candlestick chart** (lightweight-charts): seeded with REST klines (500 candles), then the last candle grows in realtime from the `kline` stream. Timeframes: 1m, 15m, 1H, 4H, 1D. lightweight-charts attribution logo enabled.
- **Header stats:** live price, 24h change/high/low/volume.
- **Trade panel:** market orders only. Amount input in coin units with a USD ≈ preview and 25/50/75/100% quick buttons. BUY (green) / SELL (red). Executes at the current live price with a simulated 0.1% taker fee. Success toast "Order filled". Validation: buy ≤ cash, sell ≤ holdings; buttons disabled (with reason) otherwise.
- Coins with no USDT pair: chart area shows the 7-day sparkline from CoinGecko + "live chart unavailable for this coin"; trading uses the 60s CoinGecko price.

### 3.3 Watchlist — `/watchlist`
- Starred coins as rows/cards: logo, name, live price, 24h %, 7-day sparkline, remove (✕).
- Persisted in localStorage; survives revisits.
- Empty state: "No coins yet — ⭐ star coins on the Markets page", link back.

### 3.4 Portfolio — `/portfolio`
- **Summary bar:** total value (cash + holdings at live prices), total P&L ($ and %, live-ticking), cash.
- **Holdings table:** asset, qty, avg buy price, current price (live), market value, unrealized P&L ($ and %).
- **Trade history:** side, coin, qty, price, fee, time (newest first).
- **Reset demo** button → confirm dialog → restore $100k, clear holdings/history (watchlist untouched).
- Empty state: "You have $100,000 waiting — make your first trade", link to Markets.

## 4. Architecture and data flow

No custom backend. Two external data sources, joined in the browser.

### 4.1 market-data source (browser-direct, keyless — facts verified 2026-08-02)
- **WebSocket:** `wss://data-stream.market-data source.vision` (official market-data-only mirror; fallback `wss://stream.market-data source.com:443`). One shared connection, combined streams:
  - `!miniTicker@arr` — all-market mini tickers (1s cadence) → powers Markets table, Watchlist, Portfolio P&L.
  - `<symbol>@kline_<interval>` — subscribed only while a chart is open.
- **REST:** `https://data-api.market-data source.vision` for kline history (`/api/v3/klines`) and the tradable-pair list (`/api/v3/exchangeInfo`).
- Limits that shape the design: 1024 streams/connection, 24h max connection life, server ping every 20s (browser auto-pongs), 6000 request-weight/min/IP — all far above our usage.

### 4.2 CoinGecko (server-proxied via Next.js route handlers)
- `/api/trending` → CoinGecko `/search/trending`; `export const revalidate = 300` (upstream cache is 10 min).
- `/api/markets` → CoinGecko `/coins/markets?vs_currency=usd&per_page=50&sparkline=true&price_change_percentage=24h`; `revalidate = 60`.
- Demo API key lives in an env var, never shipped to the client. Total upstream usage ≈ 1–2 calls/min regardless of traffic (limit: 100/min, 10k/month).
- Footer shows "Powered by CoinGecko" (required attribution).

### 4.3 Symbol mapping (the one tricky join)
- CoinGecko identifies coins by id (`bitcoin`); market-data source by pair (`BTCUSDT`).
- `lib/symbol-map.ts`: candidate pair = `UPPER(symbol) + "USDT"`, validated against `exchangeInfo` (status `TRADING`, quote `USDT`). exchangeInfo fetched client-side once per session and cached in memory.
- Unmapped coins are first-class: they render with CoinGecko data (60s refresh) and never show a broken row. Stablecoins (USDT itself) show flat price, no live stream.

### 4.4 State (Zustand)
- `market` (in-memory): live prices/24h stats keyed by market-data source symbol; polling-mode data merges into the same shape so consumers don't care about the source.
- `watchlist` (persisted): array of CoinGecko ids.
- `portfolio` (persisted): `cash` (starts 100_000), `holdings` {coinId → qty, avgCost}, `trades[]`.
- localStorage persistence via zustand/persist; corrupt/missing storage falls back to defaults silently.

### 4.5 Paper-trading rules
- Prices in USD; USDT treated as 1 USD.
- Fee: 0.1% of notional per trade (market-data source taker fee), shown before confirm.
- **Buy:** cost = qty × price × 1.001; require cost ≤ cash. New avgCost = (oldQty × oldAvg + qty × price) / (oldQty + qty). (Fee reduces cash, not avgCost.)
- **Sell:** require qty ≤ held. Proceeds = qty × price × 0.999 → cash. Realized P&L = qty × (price − avgCost), stored on the trade record. avgCost unchanged; position removed at qty 0.
- Unrealized P&L = qty × (livePrice − avgCost).
- Execution price = latest live tick (or latest 60s price in polling/unmapped mode).

## 5. Modules

```
app/
  layout.tsx            # nav, balance chip, connection badge, footer attributions
  page.tsx              # Markets
  coin/[symbol]/page.tsx
  watchlist/page.tsx
  portfolio/page.tsx
  api/trending/route.ts # cached CoinGecko proxy
  api/markets/route.ts  # cached CoinGecko proxy
components/
  TrendingStrip, MarketsTable, PriceCell (flash animation), Sparkline,
  CandleChart ('use client', lightweight-charts in useEffect + cleanup),
  TradePanel, PortfolioSummary, HoldingsTable, TradeHistory,
  ConnectionBadge, CommandPalette (⌘K), EmptyState, ResetDialog
lib/
  market-data source/ws-manager.ts # singleton: subscribe/unsubscribe, reconnect, status, fallback trigger
  market-data source/rest.ts       # klines, exchangeInfo (mirror base URL + fallback)
  coingecko.ts          # server-side fetchers used by route handlers
  symbol-map.ts
  trading.ts            # pure buy/sell/P&L math (unit-test target)
  format.ts             # price/percent/compact-number formatting
stores/
  market.ts, watchlist.ts, portfolio.ts
```

Boundaries: components read stores and never touch the network; `ws-manager` writes only to `market`; `trading.ts` is pure functions so all money math is testable without React.

## 6. Error handling and fallbacks

| Failure | Behavior |
|---|---|
| WS drops | Auto-reconnect with exponential backoff (1s → 30s cap); badge shows "reconnecting"; last prices stay on screen (grayed after 60s staleness) |
| market-data source geo-blocked (REST 451 / WS won't open on both hosts) | Switch to polling mode: `market` store refreshes from `/api/markets` every 30s; slim banner "Live streaming unavailable in your region — prices refresh every 30s"; everything else works identically |
| CoinGecko route error/rate-limit | Serve stale cache when available; trending strip hides on hard failure; table falls back to market-data source-only data (no logos/ranks) rather than blanking |
| Chart data fails | Skeleton → retry button; page otherwise functional |
| Corrupt localStorage | Reset to defaults silently |
| WS 24h connection age / tab wake from sleep | Proactive reconnect on `visibilitychange` + staleness check |
| React strict-mode double effects (dev) | All socket/chart effects have cleanups; sockets live in refs |

## 7. Testing

- **Vitest (unit):** `trading.ts` (avg cost, fees, realized/unrealized P&L, insufficient-funds edges), `symbol-map.ts` (mapped/unmapped/stablecoin cases), `ws-manager` reconnect + fallback logic against a mock WebSocket, route handlers with mocked fetch.
- **Playwright (smoke):** one flow — land on Markets, see prices, star a coin, open detail, buy, verify Portfolio shows the position and Watchlist shows the star. Run with mocked network fixtures so CI never depends on live APIs.
- **Demo-day checklist (README):** phone check, adblock on, market-data source blocked (force polling via query flag `?polling=1`), throttled 3G first paint, reset-demo works.

## 8. Compliance and footer fine print

- "Powered by CoinGecko" attribution (required by their free tier).
- lightweight-charts attribution logo on charts (required by lightweight-charts license).
- Disclaimer: "Demo application. Simulated trading with fictional funds — not financial advice."
- Vercel Hobby is non-commercial: no ads, payments, or donation links on the deployed demo. If a paying client engagement builds on this, move hosting to a paid plan first.

## 9. Out of scope (v2 backlog)

Limit orders and order book · price alerts/notifications · portfolio value chart over time · multi-language · real auth + server persistence · fiat currency switcher · news feed.
