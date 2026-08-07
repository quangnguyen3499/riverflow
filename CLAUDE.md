# trading_time — crypto trading demo (Next.js)

## Workflow rules
- Never run git operations in this project (no init/add/commit/push) — user manages version control.
- Never run or propose deployment steps (Vercel CLI, publishing, hosting). The user handles
  deployment themselves and has asked twice for it to be skipped. `DEPLOY.md` exists as a reference
  only — do not act on it or extend it unless asked.

## Data sources (verified against live API 2026-08-03)
- **market-data-source is the only crypto upstream.** Browser calls it directly (keyless, CORS-open).
  Two REST calls total: `ticker/24hr` and
  `exchangeInfo?showPermissionSets=false&symbolStatus=TRADING` — those params are
  mandatory: without them the response is 17.4 MB instead of 2.5 MB, for a provably
  identical TRADING+USDT set. Stream: `wss://data-stream.market-data-source.vision`.
- Use `data-api.market-data-source-source-source.vision`; `api.market-data-source.com` returns HTTP 451 from US IPs.
- **CoinGecko has been removed entirely** — no route handlers, no key, no attribution.
- Markets table is **crypto-only**: a pure volume ranking puts USD Coin above Bitcoin at #1
  and surfaces tokenized Nvidia/Intel. Stablecoins, fiat, metals and tokenized equities
  (base ends in "B", except BNB/SHIB/ARB) are excluded; the caption discloses it.
- Coin names come from a bundled static map; logos from 483 bundled CC0 SVGs in public/coins/.
- `wsManager`: always `subscribe()` BEFORE `connect()` — connecting with zero streams
  requests `?streams=` which market-data-source rejects, and 4 such failures fake an outage.
- **Always `rm -rf .next` before `npx tsc --noEmit`** — a stale `.next/dev/types/validator.ts`
  referencing deleted routes makes tsc exit 1 on a build artifact, not on your source.
- lightweight-charts is client-only ('use client' + useEffect) and requires the
  lightweight-charts attribution logo enabled.
- Vercel Hobby: non-commercial only — no ads/payments on the deployed demo.

## Massive (ex-Polygon.io) stocks API — free tier (researched 2026-08-02)
- Key is server-side only (`MASSIVE_API_KEY` in .env.local) — never expose to the browser.
- 5 calls/min; end-of-day / 15-min delayed. Realtime + WebSocket are paid-only.
- `/v2/snapshot/*` (top movers, full snapshot) is NOT free — Starter $29/mo.
  Build movers from `/v2/aggs/grouped/locale/us/market/stocks/{date}` instead:
  whole US market (~10k tickers) in ONE call, sort locally for gainers/losers/actives.
- Charts: `/v2/aggs/ticker/{ticker}/range/...` — free, 2 years history.
- Logos need one call PER ticker (`/v3/reference/tickers/{ticker}`); the list endpoint
  has no branding — so use text tickers in tables.
- Weekends/holidays return resultsCount 0: resolve the trading date from
  `/v2/aggs/ticker/SPY/prev` (results[0].t), never from a local calendar.
- Timestamp gotcha: grouped-daily `t` = END of window; custom-bars `t` = START.
- **RESOLVED: the free tier FORBIDS public display.** Market Data Terms §1 grants personal
  non-commercial use only and bars using the data "to build an application intended for use by
  end users other than you"; §5(c) puts "display" in the same prohibition as "redistribute" and
  extends it to derived works "including charts". Paid *individual* plans don't fix it (all
  "individual use only") — only a Business plan permits public display. There is also NO
  attribution requirement, and a "Powered by Massive" credit would itself breach §6's trademark
  clause. So: stocks page defaults to `STOCKS_DATA_MODE=fixture` (synthetic); real data is
  local-only. Because the free tier is end-of-day rather than realtime, the NYSE/OPRA exchange
  schedules don't bind, so the realistic downside is account termination, not litigation.

## Stocks data mode — the licence safeguard is a real mechanism, not just a doc
- `lib/stocks-fixture.ts` exports `stocksDataMode()`: returns `'live'` ONLY for the exact token
  `live`. Unset, `''`, `'LIVE'`, `'true'`, `' live'` all yield `'fixture'`. Both stocks routes check
  it before any upstream call, so the default is fail-safe even with `MASSIVE_API_KEY` present
  (verified: a key-bearing build served synthetic data and `/api/stocks/AAPL` 404'd).
- **`/api/stocks` is statically prerendered, so the mode is decided at BUILD time.** Setting
  `STOCKS_DATA_MODE=live` against `next start` does nothing for up to 12h — use `npm run dev`, or
  rebuild. Corollary: never build a deployable artifact while `live` is in the environment.
- **A local live run leaves ~1.7 MB of raw Massive JSON in `.next/cache/fetch-cache/`** (every real
  US ticker). Run `rm -rf .next` after any local live work.
- Fixture tickers are invented 6-char symbols (ZENITH, HELIOS, NOVARA…). Keep them synthetic — a
  frozen snapshot of real data would still be a §5(c) derived work, which defeats the point.

## Test & build environment gotchas (each of these cost real time)
- **`npm` is aliased to `sfw npm`** (Socket Firewall). Its injected `NODE_EXTRA_CA_CERTS` breaks ALL
  server-side TLS inside the dev server, so `/api/stocks` returns 502 `upstream` and looks like
  broken code. Use `node node_modules/next/dist/bin/next dev --port <p>` when testing route
  handlers. The crypto pages are immune — the browser fetches market-data-source directly.
- **`vitest.setup.ts` is required, not optional.** Node 26 defines a global `localStorage` that
  evaluates to `undefined`, so vitest won't copy jsdom's real Storage onto the global. Keep
  `setupFiles: ['./vitest.setup.ts']` in `vitest.config.ts` — removing it breaks every store test.
- **`rm -rf .next && npx tsc` can print a misleading `exit 1`** ("Directory not empty") when a dev
  server is writing into `.next`. That is `rm`'s exit code, not tsc's — stop dev servers first.
- Playwright needs `npx playwright install chromium` (build 1234) before `npx playwright test`.

## UI gotcha
- **`min-w-0` on the chart wrappers is load-bearing** (`CandleChart.tsx`, `StockCandleChart.tsx`).
  Below `lg` the grid collapses to one auto-sized track; without it the ResizeObserver measures the
  width the chart itself just set, latches at its widest, and the page scrolls sideways on a phone.

## Demoing it
- **Demo from a clean/incognito browser profile.** The watchlist and the $100k paper balance persist
  in localStorage with no login, so a profile you've been testing in starts with stale holdings and
  starred coins. A fresh profile gives every demo the intended first-run experience.
- **Wallet errors in the dev overlay are not app bugs.** This project has no web3 code at all (no
  wallet dependency; the only `ethereum` strings are coin ids in trading tests). Browser extensions
  like MetaMask inject scripts into every page, and `next dev`'s error overlay catches their uncaught
  errors and attributes them to the page. Verified: zero console/page errors on all five pages in an
  extension-free browser. The overlay is dev-only, so a production build never shows it.

## Scaffolding gotcha
- `create-next-app` refuses to scaffold in-place here: CLAUDE.md and README.md are not on its
  conflict allowlist (docs/ is). Scaffold into a temp subdir with
  `--skip-install --disable-git --yes`, then move files up and delete the temp dir.

## Docs
- Crypto design spec: docs/superpowers/specs/2026-08-02-crypto-trading-demo-design.md
  (written pre-rewrite — the market-data-source-only data layer supersedes its CoinGecko sections)
- Stocks page spec: docs/superpowers/specs/2026-08-02-stocks-page-design.md
- Implementation plan: docs/superpowers/plans/2026-08-02-crypto-trading-demo.md (24 tasks;
  Tasks 11–12 were struck and rewritten for market-data-source-only, and tasks 25–28 add the stocks page)
