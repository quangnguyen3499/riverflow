# Stocks Page ("Riverflow › Stocks") — Design Spec

**Date:** 2026-08-02
**Status:** Approved pending user review
**Depends on:** [`2026-08-02-crypto-trading-demo-design.md`](./2026-08-02-crypto-trading-demo-design.md) (the crypto app must exist first — this spec reuses its shell, stores, formatters and chart)
**Purpose:** Add one US-equities page to the Riverflow demo so the portfolio piece is not "crypto only". The stocks page must look like it belongs to the same product, must never pretend to be live, and must not destabilise the working crypto app.

---

## 1. Goals and success criteria

- A visitor clicks **Stocks** in the nav and, within one page load, sees three credible ranked tables of real large-cap US tickers — Top Gainers, Top Losers, Most Active — for the last completed trading session.
- Clicking any row opens a stock detail page with a daily candlestick chart rendered by the **same chart component** the crypto pages use.
- **Nobody can mistake stock data for live data.** A `DELAYED · EOD` badge sits beside every stock price surface and a one-line explainer names the session date. The header connection badge does not say "Live" while a stocks route is open.
- Total upstream cost stays inside Massive's **5 requests/minute** free-tier cap under any amount of traffic: steady state is ~3 upstream calls per 12 hours for the whole movers page plus 1 call per viewed ticker per 24 hours.
- The crypto pages are **byte-for-byte unchanged in behaviour**. The only edits to existing files are: one nav link, one pathname-aware branch in `ConnectionBadge`, three new types in `lib/types.ts`, and a behaviour-preserving extraction inside `components/CandleChart.tsx`.
- Non-goals: real-time stock quotes, stock paper trading (see §2.1), options, intraday charts, company logos, search over tickers.

---

## 2. Scope decisions

Each row below is a decision, not an option. Rationale follows for the three that matter.

| Decision | Choice |
|---|---|
| Pages added | Exactly two routes: `/stocks` (three tabs) and `/stocks/[ticker]` (detail) |
| Gainers/Losers/Actives layout | **Tabs** (segmented control), not three side-by-side columns |
| Data source | Massive.com (ex-Polygon.io) **Stocks Basic, free** — server-side only |
| Movers source endpoint | Derived locally from `/v2/aggs/grouped/...` — `/v2/snapshot/*` is paid-only |
| Data recency shown | End-of-day close of the last completed US session. No live, no 15-min delayed. |
| Stock paper trading | **Read-only in v1.** No Buy/Sell for equities. (§2.1) |
| Chart | Reuse the existing chart via a behaviour-preserving extraction. (§2.2) |
| Data fetch shape | Cached Next.js route handlers + client hook + Zustand store — identical to `/api/markets` (§2.3) |
| Company logos | None. Text tickers only (logos cost 1 authenticated call per ticker and 401 in `<img src>`). |
| Company names | Best-effort, detail page only, cached 30 days. Table shows tickers only. |
| Public deployment | Public build ships **synthetic fixture data**; live Massive data runs local/private only (§8) |

### 2.1 Stocks are read-only in v1 — do not touch the portfolio store

**Decision: v1 renders stock prices and charts only. There is no stock Buy/Sell.** The slot where `TradePanel` sits on the coin page instead renders a short "Trading unavailable for stocks in this demo" panel.

Justification, from what the code actually does:

1. **The store is crypto-keyed by identifier, not just by name.** `lib/trading.ts` signatures are `executeBuy(s, coinId, symbol, qty, price, now)` and `executeSell(s, coinId, qty, price, now)`; `Holding` is `{ coinId, symbol, qty, avgCost }`; `Trade` carries `coinId`. `portfolioValue(cash, holdings, priceOf)` resolves every position through `priceOf(coinId)`. Supporting stocks means renaming the key to an `assetId` across `lib/trading.ts`, `lib/types.ts`, `stores/portfolio.ts`, plus every consumer (`HoldingsTable`, `TradeHistory`, `PortfolioSummary`, `TradePanel`, `HeaderBalance`).
2. **It is a persisted-storage migration, not a refactor.** Holdings live in `localStorage` under `riverflow-portfolio`. Renaming the key requires a `zustand/persist` `version` bump and a `migrate` function, and any bug there wipes a returning visitor's demo positions mid-demo.
3. **It invalidates a green test suite.** `stores/portfolio.test.ts` (9 tests) and `lib/trading.test.ts` assert the exact object shape `{ coinId: 'bitcoin', symbol: 'btc', qty, avgCost }` and the exact persisted JSON. All of them would need rewriting for zero visible demo value.
4. **The strongest reason is honesty, not effort.** The Portfolio page's headline feature is *live-ticking* P&L. An EOD stock position would sit in that table with a price frozen at Friday's close while everything around it ticks every second. Either the number silently lies, or the page needs a per-row liveness caveat — which makes the portfolio uglier and less impressive, not more.

Read-only is also honest about the data: you cannot credibly "execute at the current price" when the current price does not exist on this tier.

**Explicitly not a dead end.** The v2 path is written down so this is a deferral, not a wall: bump `Holding`/`Trade` to `{ assetId, assetClass: 'crypto' | 'stock', symbol, ... }`, namespace ids (`crypto:bitcoin`, `stock:AAPL`), add `persist` `version: 1` with a `migrate` that maps every legacy `coinId` to `crypto:${coinId}`, and give `HoldingsTable` a per-row `EOD` badge that reuses `DelayedBadge`. Estimated at half a day, and it belongs in its own task after the stocks page ships and works.

### 2.2 Chart reuse: a behaviour-preserving extraction

The requirement is to reuse `CandleChart`. Today's `components/CandleChart.tsx` is welded to market-data source — it imports `fetchKlines`, `wsManager` and `useMarket`, and its props are `{ pair, coinId }`. A stock cannot use it as-is, and copy-pasting 120 lines of chart setup would leave two drifting chart themes.

**Decision: split the file in two, keeping `CandleChart`'s public props identical so `app/coin/[symbol]/page.tsx` is not edited at all.**

- `components/CandleChartCanvas.tsx` — new. Owns everything visual and imperative: `createChart`, `addSeries(CandlestickSeries, …)`, the theme colours, `ResizeObserver`, the loading spinner overlay, the error/Retry overlay, and the `chart.remove()` cleanup. Purely driven by props; imports nothing from `lib/market-data/*` or `stores/market`.
- `components/CandleChart.tsx` — rewritten to be the *crypto wrapper*: same exported name, same props `{ pair: string | null; coinId: string }`, same Sparkline fallback when `pair === null`, same timeframe buttons. It now holds `candles` in state from `fetchKlines`, renders `<CandleChartCanvas>`, and pushes live kline ticks through the canvas's imperative handle.
- `components/stocks/StockCandleChart.tsx` — new. Renders `<CandleChartCanvas>` with daily candles and a client-side range selector. Never calls `update()`.

Canvas contract (fixed — implementation must match):

```ts
export interface CandleChartHandle { update(candle: Candle): void }

export interface CandleChartCanvasProps {
  candles: Candle[];                              // UNIX seconds, ascending; empty while loading
  status: 'loading' | 'ready' | 'error';
  onRetry?: () => void;                           // omitted → no Retry button in the error overlay
  height?: number;                                // default 420
}
```

Two effects inside the canvas: one creates/destroys the chart (deps `[height]`), one calls `series.setData(...)` + `timeScale().fitContent()` whenever the `candles` array identity changes. `useImperativeHandle` exposes `update`, which calls `series.update(...)`.

Risk and how it is contained: this edits working crypto code. It is a pure move — no logic changes, no prop changes, no new dependencies — and it is verified by re-running the existing Task 19 visual checklist (`/coin/btc`: 500 candles, live last-candle growth, all five timeframe buttons, resize, lightweight-charts attribution logo visible, Retry on blocked market-data source, `/coin/usdt` sparkline fallback) before any stocks work starts.

### 2.3 Route handlers + client hook, not React Server Components

Server-rendering `/stocks` directly from `lib/massive.ts` would be marginally simpler. We use route handlers anyway because: it matches the established `/api/markets` pattern the rest of the codebase already reads as idiomatic; the tab UI is client-side regardless, so one client fetch feeds all three tabs with zero refetch on tab change; and route handlers are unit-testable with the exact vitest pattern already used in `app/api/markets/route.test.ts` (assert the exported `revalidate` constant, assert the success body, assert the error body).

---

## 3. Page design

### 3.1 Markets · Stocks — `/stocks`

Layout, top to bottom, inside the existing `mx-auto max-w-7xl px-4 py-6` container:

**a. Page header row**
`STOCKS` heading (`text-sm font-bold tracking-widest`) + `<DelayedBadge />` + on the right, `US Equities`.

**b. EOD explainer bar** — always visible, never dismissible. Slim bar in the muted/amber panel style already used by `GeoBanner`:

> **End-of-day data.** Showing the last completed US session — **close of Fri 31 Jul 2026**. Unlike the crypto pages, these prices do not tick live.

The date is `sessionDate` from the payload, formatted `EEE d MMM yyyy` in `America/New_York`. When `sessionDate` is not the current NY calendar date, append ` · US market closed`. On Sunday 2026-08-02 (today) this reads "close of Fri 31 Jul 2026 · US market closed" — which is the correct, non-broken behaviour, not an error state.

**c. Tabs** — `role="tablist"` segmented control reusing the exact timeframe-button styling from `CandleChart` (`rounded px-2.5 py-1 text-xs font-medium`, active = `bg-panel2 text-text`, inactive = `text-muted hover:text-text`):

`Top Gainers` · `Top Losers` · `Most Active`

Tab state is local `useState`, default `gainers`. Switching tabs triggers **no** network request — all three lists arrive in one payload. Tabs (not three columns) because three 4-column tables side by side are unreadable below 1280px, and tabs let the tables keep the dense single-table look of the crypto Markets page.

**d. Table** — one `MoversTable` component, three datasets. Columns:

| # | Symbol | Close `[DELAYED]` | Change % | Volume |
|---|---|---|---|---|

- `#` — 1-based rank within the tab, `text-muted`.
- `Symbol` — the ticker in `font-medium text-text`, uppercase. No logo, no company name (§2 — logos are 1 authenticated call per ticker).
- `Close` — `formatUsd(row.close)`, `font-mono tabular-nums`. The column **header** carries a single small `DELAYED` tag rather than repeating a badge on 20 rows.
- `Change %` — `formatPercent(row.changePct)`, `text-up` when `>= 0` else `text-down`.
- `Volume` — `formatCompact(row.volume)`, `text-muted tabular-nums`.

Row click → `router.push('/stocks/' + ticker)`. Hover `bg-panel2`. Wrapper `overflow-x-auto rounded-lg border border-border bg-panel`, table `min-w-[560px]` so it scrolls rather than squashing on mobile. No star button — the watchlist store holds CoinGecko ids and stays crypto-only in v1.

Row counts: 20 per tab (mirrors the shape of Massive's own paid movers endpoint).

**e. Footnote** under the table, `text-xs text-muted`:

> Ranked from the full US equities session summary. Filtered to close ≥ $5.00 and volume ≥ 500,000 to exclude illiquid microcaps.

### 3.2 Stock detail — `/stocks/[ticker]`

Mirrors `/coin/[symbol]` so the two feel like one product.

**Header panel** (`rounded-lg border border-border bg-panel px-4 py-3`, same as the coin page):
- Left: a colored initial-letter avatar (`h-8 w-8 rounded-full bg-panel2`, first letter of the ticker) in place of the coin logo, then the ticker as `<h1>` with the company name beneath in `text-xs text-muted` (or `US Equity` when the name lookup was skipped or failed).
- `Close` — big `font-mono text-lg`, tinted up/down, with `<DelayedBadge />` immediately to its right. This is the one place the badge sits directly against a price, per requirement.
- Then four `Stat` cells reusing the coin page's `Stat` shape: `Change` (`formatPercent`), `Day High`, `Day Low`, `Volume` (`formatCompact`).
- All values are for `sessionDate`, which is printed under the price as `Session close · Fri 31 Jul 2026`.

**Chart** — `<StockCandleChart ticker={ticker} />`, ~1 year of **daily** candles.
- Range selector above the chart: `1M · 3M · 6M · 1Y`, styled identically to the crypto timeframe buttons. **These slice the already-fetched payload client-side — they cost zero API calls.** There is no intraday option because the free tier has no live data and an intraday chart would imply otherwise.
- Loading, error and Retry overlays come free from `CandleChartCanvas`.

**Right column** — where `TradePanel` sits on the coin page, a matching-height panel:

> **Trading unavailable for stocks**
> This demo executes paper trades at live prices. Stock data on the free tier is end-of-day only, so there is no live price to fill against. Crypto paper trading is fully functional — try `/coin/btc`.
> `[ Browse crypto markets ]`

This turns a missing feature into a visibly deliberate one, which reads better to a client than a greyed-out Buy button.

### 3.3 Global shell changes

- **Nav** (`app/layout.tsx`): add `Stocks` between `Markets` and `Watchlist`, same `text-sm text-muted hover:text-text` styling, with a tiny `EOD` tag after the label so the caveat is visible before the click.
- **Connection badge** (`components/ConnectionBadge.tsx`): the badge currently reads `⚡ Live` from the market-data source socket state. On a stocks route that is actively misleading. Add one branch — `const onStocks = usePathname().startsWith('/stocks')` — and when true render the neutral `EOD` variant (`text-muted`, no lightning bolt, `title="End-of-day data — stocks do not stream"`) instead of the crypto status. This is the only functional change to an existing component outside the chart extraction.
- **Footer**: no change. Deliberately **no** "Powered by Massive/Polygon" credit — see §8.

### 3.4 `DelayedBadge`

One component, two modes, driven by the payload's `mode` field:

| Mode | Text | Style | Tooltip |
|---|---|---|---|
| `live` (real Massive data) | `DELAYED · EOD` | `rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent` | "End-of-day data — demo only. Not real-time. Not for trading decisions." |
| `fixture` (public build) | `SAMPLE DATA` | same, `text-muted` / `border-border` | "This public demo ships a synthetic sample dataset. The live data integration runs locally — see the source." |

Never rendered with no text and never conditionally hidden.

---

## 4. Architecture and data flow

```
browser ──GET /api/stocks/movers ─────► route handler (revalidate 43200, force-static)
                                          └─ lib/massive.ts ──► api.massive.com   (≤3 calls / 12h)
browser ──GET /api/stocks/AAPL ───────► route handler (revalidate 86400)
                                          └─ lib/massive.ts ──► api.massive.com   (1–2 calls / 24h / ticker)
```

The browser never talks to Massive. `MASSIVE_API_KEY` is server-only and sent as `Authorization: Bearer …` (not `?apiKey=`) so it never lands in URLs, upstream logs or `Referer` headers.

### 4.1 Resolving the trading session (never from a local calendar)

`resolveSession()` in `lib/massive.ts`:

1. `GET /v2/aggs/ticker/SPY/prev?adjusted=true` → `results[0].t`, a **ms epoch marking the END of the window**.
2. `sessionDate = nyDate(t - 1)` where `nyDate(ms) = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms))` → `YYYY-MM-DD`. The `- 1` ms guards the case where an end-of-window timestamp lands exactly on midnight ET of the following day and would otherwise report the date one day late.
3. `prevSessionDate` is found by walking back one calendar day at a time from `sessionDate` and calling grouped-daily until `resultsCount > 0`, **max 5 attempts**. Each attempt is an upstream call, so the walk-back result is cached with the same 12h window.

This is why weekends and holidays are not a failure mode: the answer comes from the data, not from `Date.getDay()`.

### 4.2 Deriving the three movers lists

Two grouped-daily calls:

```
GET /v2/aggs/grouped/locale/us/market/stocks/{sessionDate}?adjusted=true&include_otc=false
GET /v2/aggs/grouped/locale/us/market/stocks/{prevSessionDate}?adjusted=true&include_otc=false
```

Each returns the entire US market (~10k rows: `T,o,h,l,c,v,vw,n,t`) in one call — note that here `t` is the **END** of the window, whereas in the single-ticker custom-bars endpoint `t` is the **START**. The spec never relies on grouped `t` for anything except the sanity check that it maps to `sessionDate`.

Ranking is pure and lives in `lib/stocks-movers.ts`:

```ts
export const MOVER_FILTERS = { minClose: 5, minVolume: 500_000, minTrades: 1_000, topN: 20 };
```

1. Index the previous session by `T`.
2. For each current-session row, keep it only if it appears in **both** sessions (drops IPOs, which otherwise show fake +∞), and `c >= 5 && v >= 500_000 && n >= 1_000`, and `prevClose > 0`.
3. `changePct = (c - prevClose) / prevClose * 100`; `dollarVolume = v * (vw ?? c)`.
4. `gainers` = sort `changePct` desc, take 20. `losers` = sort asc, take 20. `actives` = sort **`dollarVolume`** desc, take 20.

Two details that decide whether the demo looks credible:

- **The $5 floor is deliberately stricter than the $1 the brief allows and than Massive's own paid endpoint (10k shares).** At $1 the gainers tab fills with sub-dollar shells posting +300% on 600k shares, and a client reads the page as broken. At $5 with 500k shares and 1,000 trades the list is recognisable mid- and large-caps.
- **Most Active sorts by dollar volume, not share volume.** Share volume ranks the cheapest surviving tickers; dollar volume ranks NVDA/TSLA/AAPL, which is what a viewer expects under that label.

The response carries only the 60 selected rows (~6 KB), never the 10k-row upstream payload. The upstream body is 2–3 MB of JSON — it is parsed at most twice per 12 hours and must never be logged.

### 4.3 Detail route: exactly one upstream call

```
GET /v2/aggs/ticker/{TICKER}/range/1/day/{from}/{to}?adjusted=true&sort=asc&limit=5000
```
`from = sessionDate − 365 days`, `to = sessionDate` (well inside the free tier's 2-year window). Here `t` is the **START** of each window; map to `Candle` as `{ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c }`.

Everything in the detail header is derived from that same payload — last bar = the session's `o/h/l/c/v/vw`, second-to-last bar's close = `prevClose` → `changePct`. **No separate quote call.**

The company name is a best-effort extra: `GET /v3/reference/tickers/{TICKER}` with `next: { revalidate: 2592000 }` (30 days). If the token bucket is empty or the call fails, `name` is `null` and the UI shows the ticker alone. The name is never allowed to block or fail the chart.

### 4.4 Quota discipline (5 req/min is a hard cap, not a guideline)

Four layers, listed most- to least-important:

1. **ISR is the real protection.** `/api/stocks/movers` is `export const dynamic = 'force-static'` + `revalidate = 43200`, so it is prerendered and served from cache; traffic volume has no effect on upstream calls. Every upstream `fetch` in `lib/massive.ts` additionally passes `next: { revalidate, tags: ['massive'] }`, so the Next Data Cache covers the dynamic `[ticker]` route too.
2. **Token bucket, 4 requests/minute** (one spare below the cap) in `lib/massive.ts`, with **single-flight per URL** so concurrent cold isolates cannot fan out into duplicate upstream calls. When the bucket is empty the call throws `RateLimitError` *without* hitting upstream. Honest caveat: this bucket is per-process, and Vercel runs multiple isolates — it is a second belt, not the primary defence. The primary defence is layer 1.
3. **Ticker allowlist on the detail route.** `[ticker]` is validated against `/^[A-Z][A-Z.]{0,5}$/` **and** must be either present in the cached movers universe (60 tickers) or in `ALWAYS_ALLOWED = ['SPY','QQQ','AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA']`. Anything else returns `404` with zero upstream calls. Without this, one script walking `/api/stocks/AAAA…ZZZZ` drains the daily quota in seconds.
4. **Serve-stale-on-error.** `lib/massive.ts` keeps a module-level `lastGood` map keyed by cache key. On any upstream failure, if a last-good payload exists it is returned with `stale: true` and its original `asOf`, and the UI shows a "data may be stale" note rather than an error.

Budget check. Cold movers build: 1 (`SPY/prev`) + 1 (grouped `D1`) + 1 (grouped `D0`, typically first try) = **3 calls**, worst case 7 after a long holiday weekend, serialised by the bucket over ~2 minutes at deploy/revalidate time only. Steady state: 3 calls per 12h + 1–2 per viewed ticker per 24h. A demo session that opens ten stock detail pages costs ~13 calls in a day against a 7,200/day allowance.

### 4.5 Revalidate table

| Route / fetch | `revalidate` | Why |
|---|---|---|
| `app/api/stocks/movers/route.ts` | **43200** (12 h) | A closed session's data is immutable; nightly refresh lands after the ~21:00 ET post-close settle. Shorter only burns quota. |
| `app/api/stocks/[ticker]/route.ts` | **86400** (24 h) | Completed daily bars never change. |
| `resolveSession()` fetch (`SPY/prev`) | **43200** (12 h) | One session-date lookup per half-day, shared by every route via the Data Cache. |
| grouped-daily fetch (`D1`, `D0`) | **43200** (12 h) | Keyed by resolved date, so the key itself rotates daily. |
| daily-bars fetch (per ticker) | **86400** (24 h) | Immutable history. |
| ticker-overview fetch (name) | **2592000** (30 d) | Effectively static reference data. |

### 4.6 State

`stores/stocks.ts` — Zustand, **in memory only, deliberately not persisted**. Persisting EOD data to `localStorage` would let a returning visitor see last week's close with today's framing. Shape:

```ts
{
  movers: StockMovers | null;
  moversStatus: 'idle' | 'loading' | 'ready' | 'error';
  moversError: StocksErrorCode | null;
  details: Record<string, StockDetail>;              // ticker → detail, in-session cache
  detailStatus: Record<string, 'loading' | 'ready' | 'error'>;
  detailError: Record<string, StocksErrorCode>;
}
```

Fetching lives in `hooks/use-stocks.ts`, mirroring `hooks/use-market-feed.ts`: `useStocksFeed()` (mounted by `/stocks`, fetches once on mount, no polling — the data changes once a day), `useStockDetail(ticker)` (mounted by the detail page, skips the fetch when `details[ticker]` is already populated), and module-level `refreshStocks()` / `refreshStockDetail(ticker)` for the Retry buttons — the same escape hatch `refreshMarkets()` provides today. Components read the store and never fetch.

---

## 5. Modules (exact file paths)

**New**

```
app/
  stocks/page.tsx                        # tabs + explainer + MoversTable
  stocks/[ticker]/page.tsx               # detail: header, StockCandleChart, read-only panel
  api/stocks/movers/route.ts             # revalidate 43200, dynamic 'force-static'
  api/stocks/movers/route.test.ts
  api/stocks/[ticker]/route.ts           # revalidate 86400
  api/stocks/[ticker]/route.test.ts
components/
  CandleChartCanvas.tsx                  # extracted presentational chart + CandleChartHandle
  stocks/DelayedBadge.tsx
  stocks/EodExplainer.tsx
  stocks/StocksTabs.tsx
  stocks/MoversTable.tsx
  stocks/StockCandleChart.tsx
  stocks/StocksReadOnlyPanel.tsx
hooks/
  use-stocks.ts                          # useStocksFeed, useStockDetail, refreshStocks, refreshStockDetail
lib/
  massive.ts                             # server-only client: bearer auth, token bucket, single-flight,
  massive.test.ts                        #   lastGood cache, resolveSession, typed errors
  stocks-movers.ts                       # pure: join D0/D1, filter, rank  (TDD target)
  stocks-movers.test.ts
  stocks-fixture.ts                      # synthetic sample dataset for the public build (§8)
stores/
  stocks.ts
e2e/
  stocks.spec.ts                         # Playwright, fully mocked routes
```

**Modified (four files, minimally)**

```
app/layout.tsx                # + <Link href="/stocks">Stocks <EOD tag></Link> in the nav
components/ConnectionBadge.tsx# + usePathname() branch → neutral "EOD" variant on /stocks*
components/CandleChart.tsx    # rewritten as the crypto wrapper; public props unchanged (§2.2)
lib/types.ts                  # + StockRow, StockMovers, StockDetail, StocksErrorCode
.env.local.example            # + MASSIVE_API_KEY=  and  STOCKS_DATA_MODE=fixture
```

**Untouched, on purpose:** `lib/trading.ts`, `stores/portfolio.ts`, `stores/watchlist.ts`, `stores/market.ts`, `lib/format.ts`, `lib/market-data/*`, `lib/coingecko.ts`, `components/TradePanel.tsx`, `app/coin/[symbol]/page.tsx`, `app/portfolio/page.tsx`.

### 5.1 New types (append to `lib/types.ts`)

```ts
export interface StockRow {
  ticker: string;         // "AAPL"
  close: number;          // session close, USD
  prevClose: number;
  changePct: number;      // percent, session over previous session
  volume: number;         // shares
  dollarVolume: number;   // v * (vw ?? c) — the Most Active sort key
}

export interface StockMovers {
  mode: 'live' | 'fixture';
  sessionDate: string;      // "2026-07-31", America/New_York calendar date
  prevSessionDate: string;
  asOf: number;             // ms epoch the upstream data was fetched
  stale: boolean;           // true when served from lastGood after an upstream failure
  gainers: StockRow[];      // 20
  losers: StockRow[];       // 20
  actives: StockRow[];      // 20
}

export interface StockDetail {
  mode: 'live' | 'fixture';
  ticker: string;
  name: string | null;      // null when the (best-effort) name lookup was skipped or failed
  sessionDate: string;
  open: number; high: number; low: number; close: number;
  prevClose: number | null;
  changePct: number | null;
  volume: number;
  vwap: number | null;
  stale: boolean;
  candles: Candle[];        // daily, ascending, UNIX seconds — reuses the existing Candle type
}

export type StocksErrorCode =
  | 'no-key' | 'rate-limited' | 'upstream' | 'not-found' | 'no-session';
```

Formatting uses the existing helpers unchanged: `formatUsd` for close/high/low, `formatPercent` for change, `formatCompact` for volume. (`formatPrice`'s significant-digit branch for values below 1 is never reached — the $5 filter guarantees it.)

Boundaries preserved from the crypto app: components read stores and never fetch; `lib/massive.ts` is the only module that talks to Massive and is imported only by route handlers; `lib/stocks-movers.ts` is pure so all ranking logic is unit-testable without React or network.

---

## 6. Error handling

Route-handler contract (mirrors the existing `502 {error:'upstream'}` shape). Every failure returns `{ error: StocksErrorCode }`; the UI maps the code to copy.

| Condition | Route response | What the user sees |
|---|---|---|
| `MASSIVE_API_KEY` missing/empty | `503 {error:'no-key'}` | Panel: **"Stock data not configured."** — "This build has no market-data key. The crypto pages are unaffected." Link: *Back to Markets*. No Retry button (retrying cannot help). |
| Upstream `429` / `403`, or local token bucket empty, **and** `lastGood` exists | `200` with `stale: true` | Full page renders normally plus an amber line: **"Showing the last successfully loaded data (as of {asOf}) — the data provider is rate-limited."** Retry button. |
| Upstream `429` / `403` with no `lastGood` | `503 {error:'rate-limited'}` | Panel: **"Rate limit reached."** — "The free data tier allows 5 requests per minute. Try again in a minute." Retry button, disabled for 60 s with a countdown. |
| Upstream `5xx`, network error, or malformed JSON, no `lastGood` | `502 {error:'upstream'}` | Panel: **"Stock data temporarily unavailable."** Retry button. |
| **Weekend / market holiday** | `200`, normal payload | **Not an error.** The session date resolves to the last completed session, tables render, and the explainer reads "close of Fri 31 Jul 2026 · US market closed". Today (Sun 2026-08-02) is exactly this case. |
| Session probe returns no bar, and grouped-daily returns `resultsCount: 0` for 5 consecutive walk-back days | `502 {error:'no-session'}` | Panel: **"Could not resolve the last trading session."** Retry button. |
| Movers ranking survives the filters with fewer than 3 rows in a tab | `200`, short list | Table renders what exists; below it, `text-xs text-muted`: "Only {n} tickers met the liquidity filter for this session." |
| A tab's list is empty | `200`, empty array | `EmptyState` — title "No movers for this session", body "No tickers met the close ≥ $5 / volume ≥ 500k filter.", link back to `/stocks`. |
| Detail: ticker fails the regex or is not in the allowlist | `404 {error:'not-found'}` — **no upstream call** | `EmptyState` — "Stock not found", "{TICKER} is not in this demo's coverage.", link *Back to Stocks*. |
| Detail: valid ticker but the daily-bars payload has `resultsCount: 0` (delisted) | `404 {error:'not-found'}` | Same as above. |
| Detail: name lookup fails or is skipped | `200`, `name: null` | Header shows the ticker with `US Equity` as the subtitle. Chart is unaffected. |
| Chart fetch fails after the page has rendered | — | `CandleChartCanvas` error overlay with Retry (inherited from the crypto chart, unchanged). |
| First paint before data resolves | — | Pulse skeletons matching the crypto Markets page: an explainer-height bar, a tab-height bar, twelve `h-12` rows. Skeletons stop as soon as `moversStatus` leaves `'loading'` — they never spin forever. |

Backoff rules in `lib/massive.ts`: treat **both 429 and 403** as rate-limit signals (Massive does not document the 429 body or headers — the only confirmed error shape is `401 {"status":"ERROR","error":"Unknown API Key"}`); honour `Retry-After` when present, otherwise a **fixed 60 s** backoff. Do not use the official Python client's `backoff_factor=0.1` — sub-second retries are meaningless against a 5/min bucket. Never retry a `401` or `404`.

---

## 7. Testing

**Vitest — pure logic (TDD, write the failing test first)**

`lib/stocks-movers.test.ts`
- Joins on `T` and computes `changePct` from the previous session's close, not from `(c - o) / o`.
- Excludes a ticker absent from the previous session (IPO) instead of producing `Infinity`.
- Excludes `close = 0.80` (penny), `volume = 400_000` (thin), `n = 200` (few trades).
- Guards `prevClose = 0` — excluded, no `NaN` in the output.
- `gainers` desc / `losers` asc / both length ≤ 20 with a 25-candidate fixture.
- `actives` sorts by `v * vw`, proven with a $6 × 20M-share row ranking **below** a $400 × 2M-share row.
- Falls back to `v * c` when `vw` is absent.

`lib/massive.test.ts` (mocked `fetch`, never networked)
- Sends `Authorization: Bearer <key>`; the key never appears in the URL.
- Throws `MissingApiKeyError` with zero fetch calls when `MASSIVE_API_KEY` is unset (`vi.stubEnv`).
- `429` and `403` both throw `RateLimitError`; `401` throws without retrying.
- Passes `next: { revalidate: N }` matching the §4.5 table on every call.
- `resolveSession()` converts an end-of-window ms epoch to the correct `America/New_York` date, including the midnight-boundary case that the `- 1 ms` guard fixes.
- Walk-back: grouped-daily returning `resultsCount: 0` twice then a hit resolves on the third call; five misses throw `NoSessionError`.
- Token bucket: a 5th call inside one minute throws `RateLimitError` **without** calling `fetch`.
- Single-flight: two concurrent calls for the same URL produce exactly one `fetch`.
- `lastGood`: after one success, a subsequent upstream failure returns the cached payload with `stale: true`.

**Vitest — route handlers** (mock `@/lib/massive`, exactly as `app/api/markets/route.test.ts` mocks `@/lib/coingecko`)
- `app/api/stocks/movers/route.test.ts`: `expect(revalidate).toBe(43200)`; success returns a `StockMovers` body; each error code maps to the status in §6.
- `app/api/stocks/[ticker]/route.test.ts`: `expect(revalidate).toBe(86400)`; `AAPL` succeeds; `aapl123` and `ZZZZZZZ` return `404` with **zero** calls into `lib/massive` (assert the mock was not called — this is the quota guard); a name-lookup rejection still yields `200` with `name: null`.

**Regression guard on the chart extraction**
- Re-run the Task 19 crypto checklist manually before merging: `/coin/btc` renders ~500 candles, the last candle grows live, all five timeframes reload, resize follows the container, the lightweight-charts attribution logo is present, blocking market-data source shows the Retry overlay, and `/coin/usdt` still falls back to the sparkline.
- `npx vitest run` must stay fully green — in particular `stores/portfolio.test.ts` (9 tests) and `lib/trading.test.ts`, which prove §2.1's promise that the portfolio was not touched.

**Playwright — `e2e/stocks.spec.ts`, all network mocked**
1. `page.route('**/api/stocks/movers', …)` with a fixture → visit `/stocks`, assert the `DELAYED · EOD` badge is visible, assert the explainer contains the fixture's session date, assert 20 rows.
2. Click `Top Losers` → the first row's change is negative, and **no** new request fired (assert the route handler was called once).
3. Click a row → lands on `/stocks/AAPL`, chart container present, `DELAYED · EOD` badge next to the price.
4. **Honesty assertions:** on `/stocks` and `/stocks/AAPL` the header badge shows `EOD` and never the string `Live`; the detail page contains **no** element matching `button:has-text("Buy")` or `button:has-text("Sell")`.
5. Mock `503 {error:'rate-limited'}` → the rate-limit panel and Retry button render, and the page is not blank.
6. Mock `503 {error:'no-key'}` → the "not configured" panel renders **and** navigating to `/` still shows a working crypto Markets page (proves the failure is contained).

**Manual demo-day additions to the README checklist**
Load `/stocks` on a phone (tables scroll, tabs wrap cleanly); load it on a Sunday and confirm it shows Friday's close rather than an error; confirm the gainers tab contains recognisable names, not shells.

---

## 8. Compliance

**This is the section to read before deploying. The blocker is licensing, not the rate limit.**

### 8.1 The finding

Massive/Polygon's Market Data Terms of Service — controlling document **https://massive.com/legal/market-data-terms-of-service, last updated 28 August 2025** (the Polygon-branded PDF at `/terms/market_data_terms.pdf` is a stale artifact; §9 Conflicts makes the Market Data Terms controlling over the general ToS) — **prohibits publishing this data on a public website on the free tier, and on every individual paid tier**:

- **§1 (grant):** "…exclusively for your personal, non-business, and non-commercial purposes … **you may not use the Market Data to build an application intended for use by end users other than you.**" A public portfolio demo is, by definition, an application for end users other than you.
- **§2:** Market Data "may not be … **publicly displayed** … or distributed in any way … to any other computer, server, **website**, or other medium for publication or distribution … without Massive's express prior written consent." Publication to a website is its own prohibited act, independent of commercial purpose.
- **§5(c):** bars redistributing or **displaying** the data "or any data, **charts**, analytics … derived from the Market Data ('Derived Works')". **Recomputing movers from grouped-daily does not escape this** — derived is explicitly covered, and so is a chart.
- **Knowledge base, verbatim:** "Any user who wishes to redistribute Massive's market data must sign up for one of our business products."
- **Upgrading does not fix it.** Starter/Developer/Advanced are all footnoted "Individual use". Only the Businesses ToS contains **"Edge Users"** — defined as "individuals or entities that are users of Customer's products and services" — the licensing mechanism for public display. That defined term exists nowhere in the individual regime. Massive drew the line at **audience**, not revenue: free, ad-free and non-commercial change nothing.

Two things that reduce the *risk*, not the *breach*: the free tier is end-of-day, and the OPRA and NYSE schedules are scoped by their own wording to **real-time** data — so the exchanges are not third-party beneficiaries here and there is no fee-shifting exposure under NYSE Schedule 2 §3. §1/§2/§5(c) contain **no delay-based carve-out**. Realistic downside is account termination under §7 plus deletion of all Market Data under §8 — but it is still a breach of contract.

Additional note specific to this project: the account email is on a company domain (`gegroup.com.au`), which makes a "personal, non-business" posture harder to argue than it would be for a personal address.

### 8.2 What we do about it — the plan of record

**Ship the app, not the data.** `STOCKS_DATA_MODE` (server-side env var) selects the source in `app/api/stocks/*`:

- `STOCKS_DATA_MODE=live` — calls `lib/massive.ts`. **Local and private deployments only.** Never set on a public URL.
- `STOCKS_DATA_MODE=fixture` (**the default**, and what the public Vercel build uses) — serves `lib/stocks-fixture.ts` with `mode: 'fixture'`.

The fixture must be **synthetic** — a deterministic generator producing plausible tickers, closes, changes and 250 daily candles from a fixed seed. **Do not commit a frozen snapshot of real Massive closes.** A real captured session is still "copied, reproduced, republished" under §2 and a Derived Work under §5(c); a synthetic dataset is simply not Market Data. This also makes the E2E suite deterministic for free.

Consequences to accept: the public demo shows invented numbers. The `SAMPLE DATA` badge and the explainer say so plainly, and the README links the real `lib/massive.ts` integration — which is the part a technical reviewer actually evaluates. Shipping the integration in readable source with a synthetic default reads as *better* engineering judgment than a hardcoded key, not worse.

Optional and free, worth doing in parallel: email `support@massive.com` describing the non-commercial portfolio demo. §2 and §5 both open with an express-written-consent carve-out. **Do not launch on silence** — the terms require express consent, so no reply means no. If a genuinely live public feed becomes a hard requirement, the answer is to switch providers (Alpha Vantage, Finnhub, Twelve Data — each verified independently in writing), not to upgrade the Massive plan.

### 8.3 Honesty badge — required, and not a licensing cure

The `DELAYED · EOD` badge, the explainer bar, the `EOD` connection badge on stocks routes and the read-only trading panel are **required in every mode**. Their purpose is that no client ever believes stock prices are live. They are a UX/honesty measure and **do not** create any display right — do not treat the badge as mitigation for §8.1.

### 8.4 Attribution: deliberately none

There is **no** attribution requirement in the Market Data ToS, the Individuals ToS, the Businesses ToS, or the knowledge base. The terms run the other way: Market Data ToS §6 — "You agree that you have no right to any Massive trademark or service mark and may not use any such mark in any way unless expressly authorized by Massive." A "Powered by Massive/Polygon" badge on a public demo would be a **second, separate violation** (unauthorized mark use) stacked on the first.

**Therefore: do not add a Massive/Polygon logo or credit line to the footer.** This is the opposite of the CoinGecko rule the crypto pages follow — CoinGecko *requires* attribution, Massive effectively forbids it. Do not let a future contributor "fix the missing attribution".

Likewise: **do not ship a disclaimer as a workaround.** "Data provided by Massive, for demo purposes only" addresses liability, not licensing; it advertises the breach to the licensor; and per §6 it also misuses their mark. Publishing-with-disclaimer is strictly worse than either the fixture build or not publishing.

### 8.5 Unchanged obligations

- "Powered by CoinGecko" stays in the footer (crypto pages).
- lightweight-charts attribution logo stays enabled — `CandleChartCanvas` must keep `layout.attributionLogo: true`, so it applies to the stock chart too.
- Site disclaimer stays: "Demo application. Simulated trading with fictional funds — not financial advice."
- Vercel Hobby remains non-commercial: no ads, payments or donation links.
- `MASSIVE_API_KEY` is server-only, `Authorization: Bearer`, never in a URL, never in `NEXT_PUBLIC_*`. `.env.local` is git-ignored; `.env.local.example` ships the empty key name plus `STOCKS_DATA_MODE=fixture`.

---

## 9. Out of scope (v2 backlog)

Stock paper trading (§2.1 has the migration path) · intraday / real-time stock prices and any WebSocket · company logos and the branding proxy · stock search in the ⌘K command palette · starring stocks into the watchlist · sector or index filters · a full searchable ticker universe beyond the movers set plus `ALWAYS_ALLOWED` · fundamentals, earnings dates, news · options, futures, forex · pre/post-market prices · technical indicators · a persistent Redis/KV cache in place of the ISR Data Cache · a nightly cron warmer.
