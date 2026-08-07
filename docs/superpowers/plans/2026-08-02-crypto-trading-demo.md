# Crypto Trading Demo ("Riverflow") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project rule (overrides skill defaults): NO git operations.** Never run `git init/add/commit/push`. Tasks end with test/lint/build verification instead of commits.

**Goal:** A polished, realtime, market-style crypto demo site (4 pages: Markets, Coin detail + paper trading, Watchlist, Portfolio) that impresses prospective clients within 30 seconds, with zero login.

**Architecture:** Hybrid browser-direct — the browser opens one multiplexed WebSocket to the source's keyless market-data mirror for live prices/candles, while two cached Next.js route handlers proxy CoinGecko for trending coins, logos, and market caps. Watchlist and a $100k paper-trading portfolio persist in localStorage via Zustand. Geo-blocked visitors degrade automatically to 30s polling.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS v4, Zustand 5, lightweight-charts 5, sonner, Vitest, Playwright. Deploy: Vercel Hobby.

**Spec:** `docs/superpowers/specs/2026-08-02-crypto-trading-demo-design.md`

---

## File structure

```
app/
  layout.tsx                 # shell: header/nav/balance/badge, MarketFeedProvider, Toaster, footer attributions
  globals.css                # Tailwind v4 @theme tokens (dark exchange palette)
  page.tsx                   # Markets (landing)
  coin/[symbol]/page.tsx     # Coin detail + trade
  watchlist/page.tsx
  portfolio/page.tsx
  api/markets/route.ts       # cached CoinGecko proxy (60s)
  api/trending/route.ts      # cached CoinGecko proxy (300s)
components/                  # PriceCell, Sparkline, EmptyState, ConnectionBadge, GeoBanner,
                             # TrendingStrip, MarketsTable, CommandPalette, ResetDialog,
                             # CandleChart, TradePanel, MarketFeedProvider, HeaderBalance
hooks/
  use-market-feed.ts         # wires WS + REST + polling fallback into stores (mounted once)
  use-now.ts                 # interval-based clock for staleness
lib/
  types.ts                   # shared domain types
  format.ts                  # price/percent/compact formatting
  trading.ts                 # pure paper-trading math (fees, avg cost, P&L)
  symbol-map.ts              # CoinGecko symbol → market-data-source pair
  coingecko.ts               # server-side CoinGecko fetchers
  market-data-source/rest.ts            # klines + tradable pairs, host fallback, GeoBlockedError
  market-data-source/ws-manager.ts      # singleton WS: combined streams, reconnect, status
stores/
  market.ts                  # live tickers + metadata + connection status (in-memory)
  watchlist.ts               # persisted starred coin ids
  portfolio.ts               # persisted cash/holdings/trades
e2e/
  smoke.spec.ts              # Playwright smoke flow with mocked network fixtures
```

Boundaries: components read stores and never touch the network; `ws-manager` is the only writer of live tickers; `trading.ts` is pure so all money math is unit-testable without React.

## Task index

| # | Task | # | Task |
|---|---|---|---|
| 1 | Scaffold + config + theme | 13 | PriceCell, Sparkline, EmptyState, useNow |
| 2 | Domain types | 14 | ConnectionBadge, GeoBanner, TrendingStrip |
| 3 | Formatting helpers | 15 | MarketsTable |
| 4 | Paper-trading math | 16 | CommandPalette, ResetDialog |
| 5 | market-data-source REST client | 17 | App shell (layout, header, footer) |
| 6 | Symbol mapping | 18 | Markets page |
| 7 | WebSocket manager | 19 | CandleChart + coin detail page |
| 8 | Watchlist store | 20 | TradePanel |
| 9 | Portfolio store | 21 | Watchlist + Portfolio pages |
| 10 | Market store + feed hook | 22 | Playwright smoke test |
| 11 | CoinGecko lib + markets route | 23 | README + demo-day checklist |
| 12 | Trending route | 24 | Vercel deploy + polish |

---

### Task 1: Project scaffold, tooling, and theme tokens

**Files:**
- Create (via create-next-app, moved into project root): `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/favicon.ico`, `public/*`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Modify: `app/globals.css` (full replacement with Tailwind v4 `@theme` tokens)
- Modify: `package.json` (name + test scripts, via `npm pkg set`)

**Scaffold method (the one concrete method used here):** `create-next-app` refuses to scaffold into a directory containing files outside its conflict allowlist. The project root already contains `CLAUDE.md` and `README.md` — `docs/` is on the allowlist, but `CLAUDE.md` and `README.md` are not, so an in-place scaffold fails with "The directory … contains files that could conflict". Therefore: scaffold into a temporary subdirectory `scaffold-tmp/` inside the project, move the generated files up to the project root, and delete the temp dir (which also discards the generated `README.md`, keeping the project's existing one).

- [ ] **Step 1: Check Node version precondition**

  ```bash
  node -v
  ```

  Expected: `v20.9.0` or newer (Next.js 16 requires Node ≥ 20.9). If older, install a newer Node before continuing.

- [ ] **Step 2: Scaffold Next 16 into a temp subdirectory**

  Run from the project root (`/Users/ngahoang/Documents/Quang/trading_time`):

  ```bash
  npx --yes create-next-app@16 scaffold-tmp --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --skip-install --yes
  ```

  Expected: output ends with `Success! Created scaffold-tmp at /Users/ngahoang/Documents/Quang/trading_time/scaffold-tmp` (no install, no git init). `--yes` accepts defaults for any prompt not covered by a flag.

- [ ] **Step 3: Move scaffold output to project root and remove the temp dir**

  ```bash
  mv scaffold-tmp/app scaffold-tmp/public .
  mv scaffold-tmp/package.json scaffold-tmp/tsconfig.json scaffold-tmp/next.config.ts scaffold-tmp/postcss.config.mjs scaffold-tmp/eslint.config.mjs .
  mv scaffold-tmp/.gitignore .
  if [ -f scaffold-tmp/next-env.d.ts ]; then mv scaffold-tmp/next-env.d.ts .; fi
  rm -rf scaffold-tmp
  ls
  ```

  Expected `ls` output includes: `CLAUDE.md  README.md  app  docs  eslint.config.mjs  next.config.ts  package.json  postcss.config.mjs  public  tsconfig.json` (plus `next-env.d.ts` if the template shipped one — otherwise `next dev` generates it in Step 8). The pre-existing `README.md`, `CLAUDE.md`, and `docs/` are untouched; the scaffold's own `README.md` was deleted with `scaffold-tmp`.

- [ ] **Step 4: Install dependencies**

  ```bash
  npm install
  npm install zustand lightweight-charts sonner
  npm install -D vitest jsdom @playwright/test
  ```

  Expected: each command finishes with `added N packages` and exit code 0. `package.json` now lists `zustand` (^5), `lightweight-charts` (^5), `sonner` under `dependencies` and `vitest`, `jsdom`, `@playwright/test` under `devDependencies`.

- [ ] **Step 5: Set package name and test scripts**

  ```bash
  npm pkg set name="riverflow" scripts.test="vitest run" "scripts.test:watch"="vitest" "scripts.test:e2e"="playwright test"
  npm pkg get scripts
  ```

  Expected `npm pkg get scripts` output includes exactly these three new entries alongside the scaffolded `dev`/`build`/`start`/`lint` scripts (leave those as generated):

  ```json
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
  ```

- [ ] **Step 6: Create `vitest.config.ts`**

  ```ts
  import { fileURLToPath } from 'node:url';
  import { configDefaults, defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      environment: 'jsdom',
      include: ['**/*.test.ts', '**/*.test.tsx'],
      exclude: [...configDefaults.exclude, '.next/**', 'e2e/**'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('.', import.meta.url)),
      },
    },
  });
  ```

  (Alias `@` → project root matches the tsconfig `@/*` path alias; `e2e/**` is excluded so Playwright specs never run under Vitest.)

- [ ] **Step 7: Replace `app/globals.css` with the Riverflow Tailwind v4 theme**

  Overwrite the entire file with:

  ```css
  @import "tailwindcss";

  @theme {
    --color-bg: #0b0e11;
    --color-panel: #161a1e;
    --color-panel2: #1e2329;
    --color-border: #2b3139;
    --color-up: #0ecb81;
    --color-down: #f6465d;
    --color-accent: #f0b90b;
    --color-muted: #848e9c;
    --color-text: #eaecef;
  }

  body {
    background-color: var(--color-bg);
    color: var(--color-text);
  }
  ```

  These tokens generate the utilities used throughout the app: `bg-bg`, `bg-panel`, `bg-panel2`, `border-border`, `text-up`, `text-down`, `text-accent`, `text-muted`, `text-text`.

- [ ] **Step 8: Create `.env.local.example`**

  File content (exactly one line):

  ```
  COINGECKO_API_KEY=
  ```

  (The key is optional — all code must work keyless; server code sends the `x-cg-demo-api-key` header only when the variable is set. Do not create `.env.local` itself unless you have a key.)

- [ ] **Step 9: Verify the dev server boots**

  ```bash
  npm run dev
  ```

  Expected terminal output includes `▲ Next.js 16.` and `- Local: http://localhost:3000` then `✓ Ready in …`. This run also generates `next-env.d.ts` at the project root if it did not exist yet. Open http://localhost:3000 in a browser: the default Next.js starter page renders on the dark `#0b0e11` background (some starter buttons lose their styling because the template's color tokens were replaced — that is expected; the page is rebuilt in Task 17). Stop the server with Ctrl+C.

- [ ] **Step 10: Verify type-checking and lint pass**

  ```bash
  npx tsc --noEmit
  npm run lint
  ```

  Expected: `npx tsc --noEmit` prints nothing and exits 0. `npm run lint` completes with no errors.

### Task 2: Domain types (`lib/types.ts`)

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Create `lib/types.ts`**

  This file is a binding contract — create it with exactly this content:

  ```ts
  export interface CoinMarket {
    id: string;            // CoinGecko id, e.g. "bitcoin"
    symbol: string;        // lowercase ticker, e.g. "btc"
    name: string;
    image: string;         // logo URL
    rank: number;
    price: number;         // USD
    change24h: number;     // percent, 0 if upstream null
    volume24h: number;
    marketCap: number;
    sparkline7d: number[]; // may be empty
  }

  export interface TrendingCoin {
    id: string;
    symbol: string;
    name: string;
    image: string;
    rank: number | null;
    price: number;
    change24h: number;
  }

  export interface LiveTicker {
    pair: string;          // "BTCUSDT"
    price: number;
    open24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;     // quote volume
    updatedAt: number;     // ms epoch
  }

  export interface Holding {
    coinId: string;        // CoinGecko id
    symbol: string;        // lowercase ticker
    qty: number;
    avgCost: number;       // USD per unit, excludes fees
  }

  export interface Trade {
    id: string;            // crypto.randomUUID()
    side: 'buy' | 'sell';
    coinId: string;
    symbol: string;
    qty: number;
    price: number;         // execution price USD
    fee: number;           // USD
    realizedPnl: number | null; // null for buys
    timestamp: number;     // ms epoch
  }

  export type ConnectionStatus = 'connecting' | 'streaming' | 'reconnecting' | 'polling';

  export interface Candle {
    time: number;          // UNIX seconds (lightweight-charts convention)
    open: number;
    high: number;
    low: number;
    close: number;
  }
  ```

- [ ] **Step 2: Verify with the type-checker**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no output, exit code 0.

### Task 3: Formatting helpers (`lib/format.ts`) — TDD

**Files:**
- Create: `lib/format.ts`
- Test: `lib/format.test.ts`

Contract signatures (binding):

```ts
export function formatPrice(n: number): string;    // >=1 → "67,241.50" (2dp); <1 → 4 significant digits "0.6120"
export function formatPercent(n: number): string;  // "+4.20%" / "-1.10%" (sign always, 2dp)
export function formatCompact(n: number): string;  // "28.1B", "6.2M", "981.4K", below 1000 → 2dp
export function formatUsd(n: number): string;      // "$" + formatPrice
```

- [ ] **Step 1: Write the failing test `lib/format.test.ts`**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { formatCompact, formatPercent, formatPrice, formatUsd } from '@/lib/format';

  describe('formatPrice', () => {
    it('formats values >= 1 with thousands separators and exactly 2 decimals', () => {
      expect(formatPrice(67241.5)).toBe('67,241.50');
      expect(formatPrice(1)).toBe('1.00');
      expect(formatPrice(1234567.894)).toBe('1,234,567.89');
    });

    it('formats values < 1 with 4 significant digits', () => {
      expect(formatPrice(0.612)).toBe('0.6120');
      expect(formatPrice(0.5)).toBe('0.5000');
      expect(formatPrice(0.09876)).toBe('0.09876');
    });

    it('formats zero as 0.00', () => {
      expect(formatPrice(0)).toBe('0.00');
    });
  });

  describe('formatPercent', () => {
    it('always shows a sign and 2 decimals', () => {
      expect(formatPercent(4.2)).toBe('+4.20%');
      expect(formatPercent(-1.1)).toBe('-1.10%');
      expect(formatPercent(0)).toBe('+0.00%');
    });
  });

  describe('formatCompact', () => {
    it('abbreviates trillions, billions, millions, and thousands to 1 decimal', () => {
      expect(formatCompact(1_320_000_000_000)).toBe('1.3T');
      expect(formatCompact(28_100_000_000)).toBe('28.1B');
      expect(formatCompact(6_200_000)).toBe('6.2M');
      expect(formatCompact(981_400)).toBe('981.4K');
    });

    it('keeps values below 1000 at 2 decimals', () => {
      expect(formatCompact(999)).toBe('999.00');
      expect(formatCompact(0)).toBe('0.00');
    });
  });

  describe('formatUsd', () => {
    it('prefixes formatPrice with $', () => {
      expect(formatUsd(67241.5)).toBe('$67,241.50');
      expect(formatUsd(0.612)).toBe('$0.6120');
    });
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL (module does not exist yet)**

  ```bash
  npx vitest run lib/format.test.ts
  ```

  Expected FAIL: the suite errors before any test runs with a module-resolution failure for `@/lib/format`, e.g. `Error: Failed to load url /Users/ngahoang/Documents/Quang/trading_time/lib/format (resolved id: …) in lib/format.test.ts. Does the file exist?` and the summary reports 1 failed test file. If instead it says the alias `@` cannot be resolved at all, fix `vitest.config.ts` from Task 1 Step 6 before proceeding.

- [ ] **Step 3: Implement `lib/format.ts`**

  ```ts
  export function formatPrice(n: number): string {
    if (n === 0) return '0.00';
    if (Math.abs(n) >= 1) {
      return n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return n.toLocaleString('en-US', {
      minimumSignificantDigits: 4,
      maximumSignificantDigits: 4,
    });
  }

  export function formatPercent(n: number): string {
    const sign = n < 0 ? '-' : '+';
    return `${sign}${Math.abs(n).toFixed(2)}%`;
  }

  export function formatCompact(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
    return n.toFixed(2);
  }

  export function formatUsd(n: number): string {
    return `$${formatPrice(n)}`;
  }
  ```

- [ ] **Step 4: Run the test — expect PASS**

  ```bash
  npx vitest run lib/format.test.ts
  ```

  Expected PASS output:

  ```
  Test Files  1 passed (1)
       Tests  7 passed (7)
  ```

- [ ] **Step 5: Full verification**

  ```bash
  npm test
  npx tsc --noEmit
  ```

  Expected: `npm test` reports `1 passed (1)` test file, 7 passed tests; `npx tsc --noEmit` prints nothing and exits 0.

### Task 4: Paper-trading math (`lib/trading.ts`)

**Files:**
- Create: `lib/trading.test.ts` (test)
- Create: `lib/trading.ts`

Depends on Task 1 (Vitest configured, `@` alias) and Task 2 (`lib/types.ts` with `Holding`/`Trade`). Pure functions only — no React, no stores, no network — per spec §4.5 and §5 ("all money math is testable without React"). Rules implemented: buy cost = `qty*price*(1+FEE_RATE)` must be ≤ cash else `InsufficientFundsError`; new avgCost = `(oldQty*oldAvg + qty*price)/(oldQty+qty)` with the fee excluded from avgCost; sell requires `qty ≤ held` else `InsufficientHoldingsError`; proceeds = `qty*price*(1-FEE_RATE)`; realizedPnl = `qty*(price - avgCost)`; position removed when remaining qty is within epsilon `1e-9` of zero; `Trade.fee = qty*price*FEE_RATE`. Functions never mutate the input slice (the Zustand store in Task 9 relies on that).

- [ ] **Step 1: Write the failing test suite `lib/trading.test.ts`**

  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    FEE_RATE,
    INITIAL_CASH,
    InsufficientFundsError,
    InsufficientHoldingsError,
    executeBuy,
    executeSell,
    unrealizedPnl,
    portfolioValue,
    type PortfolioSlice,
  } from '@/lib/trading';
  import type { Holding } from '@/lib/types';

  const NOW = 1_754_100_000_000; // fixed ms epoch so timestamps are deterministic

  function slice(cash: number, holdings: Holding[] = []): PortfolioSlice {
    return { cash, holdings };
  }

  describe('constants', () => {
    it('uses a 0.1% taker fee and $100k starting cash', () => {
      expect(FEE_RATE).toBe(0.001);
      expect(INITIAL_CASH).toBe(100_000);
    });
  });

  describe('executeBuy', () => {
    it('opens a new position at the execution price and deducts cost including fee', () => {
      const r = executeBuy(slice(INITIAL_CASH), 'bitcoin', 'btc', 0.5, 60_000, NOW);
      expect(r.holdings).toHaveLength(1);
      expect(r.holdings[0]).toEqual({
        coinId: 'bitcoin',
        symbol: 'btc',
        qty: 0.5,
        avgCost: 60_000,
      });
      // cost = 0.5 * 60_000 * 1.001 = 30_030 → cash 69_970
      expect(r.cash).toBeCloseTo(100_000 - 30_000 * 1.001, 6);
      expect(r.trade.fee).toBeCloseTo(30, 10); // 0.5 * 60_000 * 0.001
    });

    it('averages cost across two buys at different prices', () => {
      const first = executeBuy(slice(INITIAL_CASH), 'ethereum', 'eth', 1, 100, NOW);
      const second = executeBuy(
        { cash: first.cash, holdings: first.holdings },
        'ethereum',
        'eth',
        1,
        200,
        NOW + 1,
      );
      expect(second.holdings).toHaveLength(1);
      expect(second.holdings[0].qty).toBe(2);
      // (1*100 + 1*200) / (1+1) = 150 — fees never enter this formula
      expect(second.holdings[0].avgCost).toBeCloseTo(150, 10);
      expect(second.cash).toBeCloseTo(100_000 - 100.1 - 200.2, 6);
    });

    it('charges the fee to cash but keeps it out of avgCost', () => {
      const r = executeBuy(slice(INITIAL_CASH), 'solana', 'sol', 2, 50, NOW);
      expect(r.holdings[0].avgCost).toBe(50); // exactly the price — no fee baked in
      expect(r.cash).toBeCloseTo(100_000 - 100 - 0.1, 6); // fee $0.10 came out of cash
      expect(r.trade.fee).toBeCloseTo(0.1, 10);
    });

    it('throws InsufficientFundsError when cost exceeds cash', () => {
      // cost = 1 * 100 * 1.001 = 100.1 > 100 cash
      expect(() => executeBuy(slice(100), 'bitcoin', 'btc', 1, 100, NOW)).toThrow(
        InsufficientFundsError,
      );
    });

    it('allows an exactly-affordable buy (boundary) and leaves ~0 cash', () => {
      // Same expression the implementation uses, so the doubles are identical
      const cost = 2 * 100 * (1 + FEE_RATE);
      const r = executeBuy(slice(cost), 'bitcoin', 'btc', 2, 100, NOW);
      expect(r.holdings[0].qty).toBe(2);
      expect(r.cash).toBeCloseTo(0, 10);
    });

    it('returns a well-formed buy Trade', () => {
      const r = executeBuy(slice(INITIAL_CASH), 'bitcoin', 'btc', 0.5, 60_000, NOW);
      expect(typeof r.trade.id).toBe('string');
      expect(r.trade.id.length).toBeGreaterThan(0);
      expect(r.trade).toMatchObject({
        side: 'buy',
        coinId: 'bitcoin',
        symbol: 'btc',
        qty: 0.5,
        price: 60_000,
        realizedPnl: null,
        timestamp: NOW,
      });
    });

    it('does not mutate the input slice', () => {
      const s = slice(INITIAL_CASH, [
        { coinId: 'ethereum', symbol: 'eth', qty: 1, avgCost: 100 },
      ]);
      const r = executeBuy(s, 'ethereum', 'eth', 1, 200, NOW);
      expect(s.cash).toBe(INITIAL_CASH);
      expect(s.holdings[0]).toEqual({
        coinId: 'ethereum',
        symbol: 'eth',
        qty: 1,
        avgCost: 100,
      });
      expect(r.holdings).not.toBe(s.holdings); // fresh array returned
    });
  });

  describe('executeSell', () => {
    const eth: Holding = { coinId: 'ethereum', symbol: 'eth', qty: 4, avgCost: 2_000 };

    it('credits proceeds net of fee and records realizedPnl', () => {
      const r = executeSell(slice(1_000, [eth]), 'ethereum', 3, 2_500, NOW);
      expect(r.cash).toBeCloseTo(1_000 + 3 * 2_500 * 0.999, 6); // 8_492.5
      expect(r.trade.realizedPnl).toBeCloseTo(1_500, 10); // 3 * (2_500 - 2_000)
      expect(r.trade.fee).toBeCloseTo(7.5, 10); // 3 * 2_500 * 0.001
    });

    it('keeps avgCost unchanged on a partial sell', () => {
      const r = executeSell(slice(0, [eth]), 'ethereum', 3, 2_500, NOW);
      expect(r.holdings).toHaveLength(1);
      expect(r.holdings[0].qty).toBeCloseTo(1, 10);
      expect(r.holdings[0].avgCost).toBe(2_000);
    });

    it('removes the position when the full quantity is sold', () => {
      const r = executeSell(slice(0, [eth]), 'ethereum', 4, 2_500, NOW);
      expect(r.holdings).toHaveLength(0);
    });

    it('removes float-dust positions within epsilon of zero', () => {
      // 0.1 + 0.2 === 0.30000000000000004 — selling "0.3" must still close the position
      const b1 = executeBuy(slice(1_000), 'bitcoin', 'btc', 0.1, 100, NOW);
      const b2 = executeBuy(
        { cash: b1.cash, holdings: b1.holdings },
        'bitcoin',
        'btc',
        0.2,
        100,
        NOW,
      );
      expect(b2.holdings[0].qty).not.toBe(0.3); // proves the dust exists
      const r = executeSell(
        { cash: b2.cash, holdings: b2.holdings },
        'bitcoin',
        0.3,
        110,
        NOW,
      );
      expect(r.holdings).toHaveLength(0); // remaining ~4e-17 ≤ 1e-9 → removed
      expect(r.trade.realizedPnl).toBeCloseTo(3, 6); // 0.3 * (110 - 100)
    });

    it('throws InsufficientHoldingsError when qty exceeds the held amount', () => {
      expect(() => executeSell(slice(0, [eth]), 'ethereum', 4.5, 2_500, NOW)).toThrow(
        InsufficientHoldingsError,
      );
    });

    it('throws InsufficientHoldingsError when the coin is not held at all', () => {
      expect(() => executeSell(slice(0, [eth]), 'dogecoin', 1, 0.1, NOW)).toThrow(
        InsufficientHoldingsError,
      );
    });

    it('returns a well-formed sell Trade and does not mutate the input', () => {
      const s = slice(0, [eth]);
      const r = executeSell(s, 'ethereum', 4, 2_500, NOW);
      expect(typeof r.trade.id).toBe('string');
      expect(r.trade).toMatchObject({
        side: 'sell',
        coinId: 'ethereum',
        symbol: 'eth', // symbol looked up from the holding
        qty: 4,
        price: 2_500,
        timestamp: NOW,
      });
      expect(s.holdings).toHaveLength(1); // input untouched
      expect(s.holdings[0].qty).toBe(4);
      expect(s.cash).toBe(0);
    });
  });

  describe('unrealizedPnl', () => {
    const h: Holding = { coinId: 'bitcoin', symbol: 'btc', qty: 2, avgCost: 100 };

    it('is qty * (livePrice - avgCost)', () => {
      expect(unrealizedPnl(h, 120)).toBeCloseTo(40, 10);
      expect(unrealizedPnl(h, 90)).toBeCloseTo(-20, 10);
      expect(unrealizedPnl(h, 100)).toBe(0);
    });
  });

  describe('portfolioValue', () => {
    const holdings: Holding[] = [
      { coinId: 'bitcoin', symbol: 'btc', qty: 1, avgCost: 100 },
      { coinId: 'ethereum', symbol: 'eth', qty: 2, avgCost: 50 },
    ];

    it('sums cash plus holdings at live prices', () => {
      const priceOf = (id: string) => (id === 'bitcoin' ? 150 : 60);
      expect(portfolioValue(500, holdings, priceOf)).toBeCloseTo(500 + 150 + 120, 10);
    });

    it('falls back to avgCost when a live price is missing', () => {
      const priceOf = (id: string) => (id === 'bitcoin' ? 150 : undefined);
      // eth has no live price → valued at avgCost: 2 * 50 = 100
      expect(portfolioValue(500, holdings, priceOf)).toBeCloseTo(500 + 150 + 100, 10);
    });

    it('returns just cash when there are no holdings', () => {
      expect(portfolioValue(1_234.56, [], () => undefined)).toBe(1_234.56);
    });
  });
  ```

- [ ] **Step 2: Run the test and confirm it FAILS (module missing)**

  ```bash
  npx vitest run lib/trading.test.ts
  ```

  Expected FAIL output (import cannot resolve because `lib/trading.ts` does not exist yet):

  ```
  FAIL  lib/trading.test.ts [ lib/trading.test.ts ]
  Error: Failed to resolve import "@/lib/trading" from "lib/trading.test.ts". Does the file exist?
  ...
  Test Files  1 failed (1)
  ```

- [ ] **Step 3: Implement `lib/trading.ts` (full code)**

  ```ts
  import type { Holding, Trade } from '@/lib/types';

  export const FEE_RATE = 0.001;
  export const INITIAL_CASH = 100_000;

  export class InsufficientFundsError extends Error {
    constructor(message = 'Insufficient funds') {
      super(message);
      this.name = 'InsufficientFundsError';
    }
  }

  export class InsufficientHoldingsError extends Error {
    constructor(message = 'Insufficient holdings') {
      super(message);
      this.name = 'InsufficientHoldingsError';
    }
  }

  export interface PortfolioSlice {
    cash: number;
    holdings: Holding[];
  }

  /** Quantities within this distance of zero are treated as a closed position. */
  const EPSILON = 1e-9;

  export function executeBuy(
    s: PortfolioSlice,
    coinId: string,
    symbol: string,
    qty: number,
    price: number,
    now: number,
  ): { cash: number; holdings: Holding[]; trade: Trade } {
    const cost = qty * price * (1 + FEE_RATE);
    if (cost > s.cash) {
      throw new InsufficientFundsError(
        `Buy costs $${cost.toFixed(2)} but only $${s.cash.toFixed(2)} is available`,
      );
    }
    const fee = qty * price * FEE_RATE;

    const existing = s.holdings.find((h) => h.coinId === coinId);
    let holdings: Holding[];
    if (existing) {
      const newQty = existing.qty + qty;
      // Weighted average of what was actually paid per unit; fee excluded.
      const avgCost = (existing.qty * existing.avgCost + qty * price) / newQty;
      holdings = s.holdings.map((h) =>
        h.coinId === coinId ? { ...h, qty: newQty, avgCost } : h,
      );
    } else {
      holdings = [...s.holdings, { coinId, symbol, qty, avgCost: price }];
    }

    const trade: Trade = {
      id: crypto.randomUUID(),
      side: 'buy',
      coinId,
      symbol,
      qty,
      price,
      fee,
      realizedPnl: null,
      timestamp: now,
    };

    return { cash: s.cash - cost, holdings, trade };
  }

  export function executeSell(
    s: PortfolioSlice,
    coinId: string,
    qty: number,
    price: number,
    now: number,
  ): { cash: number; holdings: Holding[]; trade: Trade } {
    const existing = s.holdings.find((h) => h.coinId === coinId);
    if (!existing || qty > existing.qty + EPSILON) {
      throw new InsufficientHoldingsError(
        `Sell of ${qty} exceeds held quantity ${existing?.qty ?? 0}`,
      );
    }

    const fee = qty * price * FEE_RATE;
    const proceeds = qty * price * (1 - FEE_RATE);
    const realizedPnl = qty * (price - existing.avgCost);

    const remaining = existing.qty - qty;
    const holdings =
      remaining <= EPSILON
        ? s.holdings.filter((h) => h.coinId !== coinId)
        : s.holdings.map((h) =>
            h.coinId === coinId ? { ...h, qty: remaining } : h,
          );

    const trade: Trade = {
      id: crypto.randomUUID(),
      side: 'sell',
      coinId,
      symbol: existing.symbol,
      qty,
      price,
      fee,
      realizedPnl,
      timestamp: now,
    };

    return { cash: s.cash + proceeds, holdings, trade };
  }

  export function unrealizedPnl(h: Holding, livePrice: number): number {
    return h.qty * (livePrice - h.avgCost);
  }

  export function portfolioValue(
    cash: number,
    holdings: Holding[],
    priceOf: (coinId: string) => number | undefined,
  ): number {
    return holdings.reduce(
      (total, h) => total + h.qty * (priceOf(h.coinId) ?? h.avgCost),
      cash,
    );
  }
  ```

- [ ] **Step 4: Run the test and confirm it PASSES**

  ```bash
  npx vitest run lib/trading.test.ts
  ```

  Expected PASS output:

  ```
  ✓ lib/trading.test.ts (19 tests)

  Test Files  1 passed (1)
       Tests  19 passed (19)
  ```

- [ ] **Step 5: Type-check the new files**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no output, exit code 0.

### Task 5: market-data-source REST client (`lib/market-data/rest.ts`)

Keyless REST access to market data with host fallback and geo-block detection (spec §4.1, §6). `fetchKlines` seeds the candlestick chart (Task 19); `fetchTradablePairs` feeds the symbol map (Task 6) and the market store (Task 10). Both try `REST_HOSTS` in order, throw `GeoBlockedError` only when **every** host answers HTTP 451, and rethrow the last error otherwise.

**Files:**
- Create: `lib/market-data/rest.ts`
- Test: `lib/market-data/rest.test.ts`

- [ ] **Step 1: Write the failing test file**

  Create `lib/market-data/rest.test.ts` with the following content:

  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import {
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

      expect(fetchMock).toHaveBeenCalledWith(
        'https://data-api.market-data-source-source.vision/api/v3/exchangeInfo',
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

      expect(fetchMock.mock.calls[1][0]).toBe('https://api.market-data-source.com/api/v3/exchangeInfo');
      expect(pairs.has('BTCUSDT')).toBe(true);
      expect(pairs.has('ETHBTC')).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test and confirm it fails**

  ```bash
  npx vitest run lib/market-data/rest.test.ts
  ```

  Expected: FAIL — `Error: Failed to resolve import "@/lib/market-data/rest" from "lib/market-data/rest.test.ts". Does the file exist?` (the module does not exist yet; 0 tests run).

- [ ] **Step 3: Implement `lib/market-data/rest.ts`**

  Create `lib/market-data/rest.ts` with the following content:

  ```ts
  import type { Candle } from '@/lib/types';

  export const REST_HOSTS = [
    'https://data-api.market-data-source-source.vision',
    'https://api.market-data-source.com',
  ] as const;

  export class GeoBlockedError extends Error {}      // thrown on HTTP 451 from all hosts

  /** Raw kline row: [openTime(ms), open, high, low, close, volume, closeTime, ...] */
  type RawKline = [number, string, string, string, string, ...unknown[]];

  interface ExchangeInfoSymbol {
    symbol: string;
    status: string;
    quoteAsset: string;
  }

  /**
   * GET <host><path> trying each REST host in order. Returns parsed JSON from
   * the first host that answers 2xx. If every host returns HTTP 451 the caller
   * is geo-blocked → GeoBlockedError; any other total failure rethrows the
   * last error seen so callers can distinguish outage from geo-block.
   */
  async function fetchJsonFromHosts(path: string): Promise<unknown> {
    let lastError: unknown = new Error(`All market REST hosts failed for ${path}`);
    let count451 = 0;
    for (const host of REST_HOSTS) {
      try {
        const res = await fetch(`${host}${path}`);
        if (res.status === 451) {
          count451 += 1;
          lastError = new Error(`HTTP 451 from ${host}${path}`);
          continue;
        }
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} from ${host}${path}`);
          continue;
        }
        return await res.json();
      } catch (err) {
        lastError = err;
      }
    }
    if (count451 === REST_HOSTS.length) {
      throw new GeoBlockedError('Market data source geo-blocked: HTTP 451 from all hosts');
    }
    throw lastError;
  }

  /**
   * Kline history for a spot pair, mapped to lightweight-charts Candles.
   * Source open times are in milliseconds; Candle.time is UNIX seconds.
   */
  export async function fetchKlines(
    pair: string,
    interval: string,
    limit = 500,
  ): Promise<Candle[]> {
    const path = `/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const rows = (await fetchJsonFromHosts(path)) as RawKline[];
    return rows.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }));
  }

  /**
   * All currently tradable USDT pairs from exchangeInfo,
   * e.g. Set {"BTCUSDT", "ETHUSDT", ...}.
   */
  export async function fetchTradablePairs(): Promise<Set<string>> {
    const info = (await fetchJsonFromHosts('/api/v3/exchangeInfo')) as {
      symbols?: ExchangeInfoSymbol[];
    };
    const pairs = new Set<string>();
    for (const s of info.symbols ?? []) {
      if (s.status === 'TRADING' && s.quoteAsset === 'USDT') {
        pairs.add(s.symbol);
      }
    }
    return pairs;
  }
  ```

- [ ] **Step 4: Run the test and confirm it passes**

  ```bash
  npx vitest run lib/market-data/rest.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 5: Run the full unit suite to confirm nothing regressed**

  ```bash
  npm test
  ```

  Expected: PASS — all test files pass (this task's plus those from Tasks 2–4), exit code 0.

### Task 6: Symbol mapping (`lib/symbol-map.ts`)

The one tricky join (spec §4.3): CoinGecko identifies coins by lowercase ticker symbol (`"btc"`), market-data-source by pair (`"BTCUSDT"`). `pairFor` builds the candidate pair `UPPER(symbol) + "USDT"` and validates it against the tradable-pair set from Task 5's `fetchTradablePairs`. Unmapped coins and USDT itself return `null` — callers render those with CoinGecko data only (no live stream), never a broken row.

**Files:**
- Create: `lib/symbol-map.ts`
- Test: `lib/symbol-map.test.ts`

- [ ] **Step 1: Write the failing test file**

  Create `lib/symbol-map.test.ts` with the following content:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { pairFor } from '@/lib/symbol-map';

  const TRADABLE = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

  describe('pairFor', () => {
    it('maps a lowercase symbol to its USDT pair when tradable', () => {
      expect(pairFor('btc', TRADABLE)).toBe('BTCUSDT');
      expect(pairFor('sol', TRADABLE)).toBe('SOLUSDT');
    });

    it('is case-insensitive on input', () => {
      expect(pairFor('BTC', TRADABLE)).toBe('BTCUSDT');
      expect(pairFor('Eth', TRADABLE)).toBe('ETHUSDT');
    });

    it('returns null for symbols with no tradable USDT pair', () => {
      expect(pairFor('doge', TRADABLE)).toBeNull();
    });

    it('returns null for usdt itself (stablecoin special case)', () => {
      expect(pairFor('usdt', TRADABLE)).toBeNull();
      // Even if the set somehow contained a weird self-pair, USDT stays unmapped.
      expect(pairFor('USDT', new Set(['USDTUSDT']))).toBeNull();
    });

    it('returns null when the tradable set is empty', () => {
      expect(pairFor('btc', new Set<string>())).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run the test and confirm it fails**

  ```bash
  npx vitest run lib/symbol-map.test.ts
  ```

  Expected: FAIL — `Error: Failed to resolve import "@/lib/symbol-map" from "lib/symbol-map.test.ts". Does the file exist?` (the module does not exist yet; 0 tests run).

- [ ] **Step 3: Implement `lib/symbol-map.ts`**

  Create `lib/symbol-map.ts` with the following content:

  ```ts
  /**
   * Maps a CoinGecko ticker symbol (e.g. "btc") to its USDT pair
   * (e.g. "BTCUSDT") when that pair is in the tradable set from
   * fetchTradablePairs(). Returns null when no tradable pair exists, and
   * always null for USDT itself — it is the quote asset, so no "USDTUSDT"
   * pair exists; the UI shows a flat $1 price with no live stream (spec §4.3).
   */
  export function pairFor(symbol: string, tradable: Set<string>): string | null {
    const upper = symbol.toUpperCase();
    if (upper === 'USDT') return null;
    const candidate = `${upper}USDT`;
    return tradable.has(candidate) ? candidate : null;
  }
  ```

- [ ] **Step 4: Run the test and confirm it passes**

  ```bash
  npx vitest run lib/symbol-map.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 5: Run the full unit suite to confirm nothing regressed**

  ```bash
  npm test
  ```

  Expected: PASS — all test files pass (Tasks 2–6), exit code 0.

### Task 7: market-data-source WebSocket manager (`lib/market-data/ws-manager.ts`)

The shared client-side WebSocket singleton (spec §4.1, §6): one combined-stream connection, subscribe/unsubscribe by stream name, auto-reconnect with exponential backoff (1s → 30s cap), host rotation between the two market-data-source endpoints, and a transition to `'polling'` after 4 consecutive failures — while polling, a low-frequency 30s retry timer keeps attempting fresh connect cycles so the stream recovers on its own. Fully unit-tested against a `MockWebSocket` injected through the constructor's socket factory — no real network anywhere.

Behavior decisions (local to this module, consistent with the contracts):

- Initial status is `'connecting'` (before `connect()` is ever called). `onStatus` only fires on *changes*, so a listener registered before `connect()` sees `'streaming'` as its first event.
- Streams subscribed before/at connect time go into the combined-stream URL (`<host>/stream?streams=a/b/c`). Streams added while the socket is already OPEN are attached live via a `{"method":"SUBSCRIBE","params":[...],"id":n}` message (market-data-source supports this on combined streams); streams added while the socket is still CONNECTING are sent as SUBSCRIBE messages on open. When the last listener of a stream unsubscribes on an open socket, an UNSUBSCRIBE message is sent.
- Every non-manual close counts as one consecutive failure and rotates to the other host; a successful open resets the failure count (so backoff restarts at 1s after any good connection). The 4th consecutive failure sets status `'polling'`, but the manager does NOT give up permanently: it schedules a low-frequency retry every 30s that attempts a fresh connect cycle. Status stays `'polling'` during those attempts (no status churn); a successful open returns status to `'streaming'` and normal operation resumes. Each failed 30s attempt keeps rotating hosts and schedules the next 30s retry. `connect()` while polling cancels the pending 30s retry and starts over immediately at host 0.
- `disconnect()` detaches all handlers before closing, clears any pending retry timer (both the backoff timer and the 30s polling retry timer), and leaves the status value untouched (no reconnect is ever triggered by a manual close).
- `backoffDelay(failure)` is exported so the 30s cap is directly unit-testable (only 3 backoff waits ever happen before polling kicks in, so the cap can't be reached through the state machine alone).

**Files:**

- Test: `lib/market-data/ws-manager.test.ts` (create)
- Create: `lib/market-data/ws-manager.ts`

**Steps:**

- [ ] **Step 1: Create the test file with the `MockWebSocket` helper, test harness, and the backoff + connection-lifecycle tests.** Write `lib/market-data/ws-manager.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import type { ConnectionStatus } from '@/lib/types';
  import { WsManager, wsManager, WS_HOSTS, backoffDelay } from '@/lib/market-data/ws-manager';

  // ---------------------------------------------------------------------------
  // MockWebSocket — test stand-in for the browser WebSocket. The manager only
  // touches: url, readyState, send(), close(), and the on* handler properties.
  // Tests play the server side via the simulate* helpers.
  // ---------------------------------------------------------------------------
  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState: number = MockWebSocket.CONNECTING;
    /** Raw payloads passed to send(), in order. */
    sent: string[] = [];

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    constructor(public readonly url: string) {}

    send(data: string): void {
      this.sent.push(data);
    }

    close(): void {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.(new CloseEvent('close'));
    }

    /** Server accepted the connection. */
    simulateOpen(): void {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }

    /** Server pushed a combined-stream frame (object is JSON-stringified). */
    simulateMessage(frame: unknown): void {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
    }

    /** Server pushed a raw (possibly invalid) text payload. */
    simulateRaw(data: string): void {
      this.onmessage?.(new MessageEvent('message', { data }));
    }

    /** Connection failed or dropped (browsers fire close either way). */
    simulateFailure(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.(new CloseEvent('close'));
    }
  }

  /** Fresh manager wired to a recording socket factory. */
  function makeHarness() {
    const sockets: MockWebSocket[] = [];
    const factory = vi.fn((url: string): WebSocket => {
      const s = new MockWebSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    });
    const manager = new WsManager(factory);
    return { sockets, factory, manager };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('backoffDelay', () => {
    it('doubles from 1s and caps at 30s', () => {
      expect(backoffDelay(1)).toBe(1_000);
      expect(backoffDelay(2)).toBe(2_000);
      expect(backoffDelay(3)).toBe(4_000);
      expect(backoffDelay(4)).toBe(8_000);
      expect(backoffDelay(5)).toBe(16_000);
      expect(backoffDelay(6)).toBe(30_000);
      expect(backoffDelay(10)).toBe(30_000);
    });
  });

  describe('connection lifecycle', () => {
    it('starts with status "connecting"', () => {
      const { manager } = makeHarness();
      expect(manager.status).toBe('connecting');
    });

    it('connect() opens a combined-stream URL on the primary host with all subscribed streams', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.subscribe('!miniTicker@arr', () => {});
      manager.subscribe('btcusdt@kline_1m', () => {});
      manager.connect();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(sockets[0].url).toBe(
        'wss://data-stream.market-data-source.vision/stream?streams=!miniTicker@arr/btcusdt@kline_1m',
      );
      expect(sockets[0].url.startsWith(WS_HOSTS[0])).toBe(true);
    });

    it('connect() is idempotent while a socket is connecting or open', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.connect();
      manager.connect(); // still CONNECTING → no second socket
      expect(factory).toHaveBeenCalledTimes(1);
      sockets[0].simulateOpen();
      manager.connect(); // OPEN → no second socket
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('transitions connecting → streaming on open and notifies onStatus listeners', () => {
      const { manager, sockets } = makeHarness();
      const seen: ConnectionStatus[] = [];
      manager.onStatus((s) => seen.push(s));
      manager.connect();
      expect(manager.status).toBe('connecting');
      sockets[0].simulateOpen();
      expect(manager.status).toBe('streaming');
      expect(seen).toEqual(['streaming']); // fires on change only
    });

    it('onStatus() returns an unsubscribe that stops notifications', () => {
      const { manager, sockets } = makeHarness();
      const seen: ConnectionStatus[] = [];
      const off = manager.onStatus((s) => seen.push(s));
      manager.connect();
      off();
      sockets[0].simulateOpen();
      expect(seen).toEqual([]);
      expect(manager.status).toBe('streaming');
    });
  });
  ```

- [ ] **Step 2: Append the frame-dispatch and subscribe/unsubscribe test suites.** Add to the end of `lib/market-data/ws-manager.test.ts`:

  ```ts
  describe('frame dispatch', () => {
    it('dispatches {stream, data} frames to the matching stream listeners only', () => {
      const { manager, sockets } = makeHarness();
      const mini = vi.fn();
      const kline = vi.fn();
      manager.subscribe('!miniTicker@arr', mini);
      manager.subscribe('btcusdt@kline_1m', kline);
      manager.connect();
      sockets[0].simulateOpen();

      sockets[0].simulateMessage({
        stream: '!miniTicker@arr',
        data: [{ s: 'BTCUSDT', c: '67241.50' }],
      });

      expect(mini).toHaveBeenCalledTimes(1);
      expect(mini).toHaveBeenCalledWith([{ s: 'BTCUSDT', c: '67241.50' }]);
      expect(kline).not.toHaveBeenCalled();
    });

    it('ignores malformed JSON frames without throwing', () => {
      const { manager, sockets } = makeHarness();
      const cb = vi.fn();
      manager.subscribe('!miniTicker@arr', cb);
      manager.connect();
      sockets[0].simulateOpen();

      expect(() => sockets[0].simulateRaw('{"stream": "!miniTicker@arr", "data"')).not.toThrow();
      expect(cb).not.toHaveBeenCalled();
    });

    it('ignores frames without a stream field (e.g. SUBSCRIBE acks)', () => {
      const { manager, sockets } = makeHarness();
      const cb = vi.fn();
      manager.subscribe('!miniTicker@arr', cb);
      manager.connect();
      sockets[0].simulateOpen();

      sockets[0].simulateMessage({ result: null, id: 1 }); // the ack shape
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('subscribing a new stream on an open socket sends a SUBSCRIBE message', () => {
      const { manager, sockets } = makeHarness();
      manager.subscribe('!miniTicker@arr', () => {});
      manager.connect();
      sockets[0].simulateOpen();
      expect(sockets[0].sent).toHaveLength(0); // URL already carried the stream

      manager.subscribe('ethusdt@kline_1m', () => {});
      expect(sockets[0].sent).toHaveLength(1);
      expect(JSON.parse(sockets[0].sent[0])).toEqual({
        method: 'SUBSCRIBE',
        params: ['ethusdt@kline_1m'],
        id: 1,
      });
    });

    it('a stream subscribed while the socket is still connecting is SUBSCRIBEd on open', () => {
      const { manager, sockets } = makeHarness();
      manager.connect(); // no streams yet → empty streams param
      manager.subscribe('btcusdt@kline_1m', () => {});
      expect(sockets[0].sent).toHaveLength(0); // cannot send while CONNECTING

      sockets[0].simulateOpen();
      expect(sockets[0].sent).toHaveLength(1);
      expect(JSON.parse(sockets[0].sent[0])).toEqual({
        method: 'SUBSCRIBE',
        params: ['btcusdt@kline_1m'],
        id: 1,
      });
    });

    it('unsubscribe stops delivery and sends UNSUBSCRIBE when the last listener leaves', () => {
      const { manager, sockets } = makeHarness();
      const cb = vi.fn();
      const off = manager.subscribe('btcusdt@kline_1m', cb);
      manager.connect();
      sockets[0].simulateOpen();

      off();
      sockets[0].simulateMessage({ stream: 'btcusdt@kline_1m', data: { k: {} } });
      expect(cb).not.toHaveBeenCalled();

      const last = JSON.parse(sockets[0].sent.at(-1)!);
      expect(last.method).toBe('UNSUBSCRIBE');
      expect(last.params).toEqual(['btcusdt@kline_1m']);
    });

    it('unsubscribing one listener keeps other listeners of the same stream working', () => {
      const { manager, sockets } = makeHarness();
      const a = vi.fn();
      const b = vi.fn();
      const offA = manager.subscribe('btcusdt@kline_1m', a);
      manager.subscribe('btcusdt@kline_1m', b);
      manager.connect();
      sockets[0].simulateOpen();

      offA();
      expect(sockets[0].sent).toHaveLength(0); // b still listening → no UNSUBSCRIBE

      sockets[0].simulateMessage({ stream: 'btcusdt@kline_1m', data: 42 });
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledWith(42);
    });

    it('calling the same unsubscribe twice is harmless', () => {
      const { manager, sockets } = makeHarness();
      const off = manager.subscribe('btcusdt@kline_1m', vi.fn());
      manager.connect();
      sockets[0].simulateOpen();

      off();
      expect(() => off()).not.toThrow();
      const unsubs = sockets[0].sent.filter((m) => JSON.parse(m).method === 'UNSUBSCRIBE');
      expect(unsubs).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 3: Append the reconnect/backoff/host-rotation, disconnect, and singleton test suites.** Add to the end of `lib/market-data/ws-manager.test.ts`:

  ```ts
  /** Fail the initial attempt and the 3 backoff retries → status 'polling' (30s low-frequency retry pending). */
  function driveToPolling(manager: WsManager, sockets: MockWebSocket[]): void {
    manager.connect();
    sockets[0].simulateFailure(); // failure 1 → retry in 1s
    vi.advanceTimersByTime(1_000);
    sockets[1].simulateFailure(); // failure 2 → retry in 2s
    vi.advanceTimersByTime(2_000);
    sockets[2].simulateFailure(); // failure 3 → retry in 4s
    vi.advanceTimersByTime(4_000);
    sockets[3].simulateFailure(); // failure 4 → 'polling' + 30s retry timer
  }

  describe('reconnect, backoff, host rotation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('on failure: status "reconnecting", retry on the other host after exactly 1s', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.subscribe('!miniTicker@arr', () => {});
      manager.connect();

      sockets[0].simulateFailure();
      expect(manager.status).toBe('reconnecting');

      vi.advanceTimersByTime(999);
      expect(factory).toHaveBeenCalledTimes(1); // not yet

      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(sockets[1].url.startsWith(WS_HOSTS[1])).toBe(true); // rotated
    });

    it('backoff doubles per consecutive failure (1s, 2s, 4s) while alternating hosts', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.connect();

      sockets[0].simulateFailure(); // host 0 failed
      vi.advanceTimersByTime(1_000);
      expect(sockets[1].url.startsWith(WS_HOSTS[1])).toBe(true);

      sockets[1].simulateFailure(); // host 1 failed
      vi.advanceTimersByTime(1_999);
      expect(factory).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1); // 2s elapsed
      expect(sockets[2].url.startsWith(WS_HOSTS[0])).toBe(true);

      sockets[2].simulateFailure(); // host 0 failed again
      vi.advanceTimersByTime(3_999);
      expect(factory).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(1); // 4s elapsed
      expect(sockets[3].url.startsWith(WS_HOSTS[1])).toBe(true);
    });

    it('reconnect URL re-includes every subscribed stream and delivery resumes', () => {
      const { manager, sockets } = makeHarness();
      manager.subscribe('!miniTicker@arr', () => {});
      manager.connect();
      sockets[0].simulateOpen();

      const cb = vi.fn();
      manager.subscribe('ethusdt@kline_1m', cb); // added live via SUBSCRIBE message

      sockets[0].simulateFailure();
      vi.advanceTimersByTime(1_000);
      expect(sockets[1].url).toBe(
        'wss://stream.market-data-source.com:443/stream?streams=!miniTicker@arr/ethusdt@kline_1m',
      );

      sockets[1].simulateOpen();
      expect(sockets[1].sent).toHaveLength(0); // URL carried everything — no re-SUBSCRIBE spam
      sockets[1].simulateMessage({ stream: 'ethusdt@kline_1m', data: { e: 'kline' } });
      expect(cb).toHaveBeenCalledWith({ e: 'kline' });
    });

    it('a successful open resets the backoff to 1s and the failure count', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.connect();
      sockets[0].simulateFailure(); // failure 1
      vi.advanceTimersByTime(1_000);

      sockets[1].simulateOpen(); // recovered → counters reset
      expect(manager.status).toBe('streaming');

      sockets[1].simulateFailure(); // drop of a live connection = failure 1 again
      expect(manager.status).toBe('reconnecting');
      vi.advanceTimersByTime(999);
      expect(factory).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1); // 1s again, not 2s
      expect(factory).toHaveBeenCalledTimes(3);
      expect(sockets[2].url.startsWith(WS_HOSTS[0])).toBe(true); // rotated away from host 1
    });

    it('after 4 consecutive failures across both hosts: status "polling", then a low-frequency retry every 30s', () => {
      const { manager, sockets, factory } = makeHarness();
      const statuses: ConnectionStatus[] = [];
      manager.onStatus((s) => statuses.push(s));

      driveToPolling(manager, sockets);

      expect(manager.status).toBe('polling');
      // hosts were alternated: 0, 1, 0, 1
      expect(sockets.map((s) => s.url.startsWith(WS_HOSTS[0]))).toEqual([true, false, true, false]);

      vi.advanceTimersByTime(29_999);
      expect(factory).toHaveBeenCalledTimes(4); // not yet — low-frequency retry is 30s
      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(5); // retry attempt fired
      expect(manager.status).toBe('polling'); // status only changes on a successful open
      expect(statuses).toEqual(['reconnecting', 'polling']); // change events only — no churn

      sockets[4].simulateFailure(); // the 30s attempt failed → next retry in another 30s
      expect(manager.status).toBe('polling');
      vi.advanceTimersByTime(30_000);
      expect(factory).toHaveBeenCalledTimes(6);
    });

    it('a successful 30s polling retry restores status "streaming" and clears the retry timer', () => {
      const { manager, sockets, factory } = makeHarness();
      const statuses: ConnectionStatus[] = [];
      manager.onStatus((s) => statuses.push(s));

      driveToPolling(manager, sockets);
      expect(manager.status).toBe('polling');

      vi.advanceTimersByTime(30_000);
      expect(factory).toHaveBeenCalledTimes(5); // low-frequency retry attempt

      sockets[4].simulateOpen();
      expect(manager.status).toBe('streaming');
      expect(statuses).toEqual(['reconnecting', 'polling', 'streaming']);

      vi.advanceTimersByTime(600_000);
      expect(factory).toHaveBeenCalledTimes(5); // recovered — no stray retries left
    });

    it('connect() after polling cancels the pending 30s retry and starts over from the primary host', () => {
      const { manager, sockets, factory } = makeHarness();
      driveToPolling(manager, sockets);
      expect(manager.status).toBe('polling');

      manager.connect();
      expect(manager.status).toBe('connecting');
      expect(factory).toHaveBeenCalledTimes(5);
      expect(sockets[4].url.startsWith(WS_HOSTS[0])).toBe(true);

      sockets[4].simulateOpen();
      expect(manager.status).toBe('streaming');

      vi.advanceTimersByTime(600_000);
      expect(factory).toHaveBeenCalledTimes(5); // the pending 30s polling retry was cancelled
    });
  });

  describe('disconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('disconnect() closes the socket and never reconnects', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.subscribe('!miniTicker@arr', () => {});
      manager.connect();
      sockets[0].simulateOpen();

      manager.disconnect();
      expect(sockets[0].readyState).toBe(MockWebSocket.CLOSED);

      vi.advanceTimersByTime(600_000);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('disconnect() during backoff cancels the pending retry', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.connect();
      sockets[0].simulateFailure();
      expect(manager.status).toBe('reconnecting');

      manager.disconnect();
      vi.advanceTimersByTime(600_000);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('disconnect() while polling cancels the pending 30s retry', () => {
      const { manager, sockets, factory } = makeHarness();
      driveToPolling(manager, sockets);
      expect(manager.status).toBe('polling');

      manager.disconnect();
      vi.advanceTimersByTime(600_000);
      expect(factory).toHaveBeenCalledTimes(4); // no 30s attempt after a manual close
    });

    it('connect() works again after disconnect()', () => {
      const { manager, sockets, factory } = makeHarness();
      manager.connect();
      sockets[0].simulateOpen();
      manager.disconnect();

      manager.connect();
      expect(factory).toHaveBeenCalledTimes(2);
      sockets[1].simulateOpen();
      expect(manager.status).toBe('streaming');
    });
  });

  describe('singleton', () => {
    it('wsManager is a shared WsManager instance that has not connected', () => {
      expect(wsManager).toBeInstanceOf(WsManager);
      expect(wsManager.status).toBe('connecting');
    });
  });
  ```

- [ ] **Step 4: Run the test file and confirm it fails because the module does not exist.**

  ```bash
  npx vitest run lib/market-data/ws-manager.test.ts
  ```

  Expected: FAIL —

  ```
  FAIL  lib/market-data/ws-manager.test.ts [ lib/market-data/ws-manager.test.ts ]
  Error: Failed to resolve import "@/lib/market-data/ws-manager" from "lib/market-data/ws-manager.test.ts". Does the file exist?
  ```

- [ ] **Step 5: Implement the manager.** Create `lib/market-data/ws-manager.ts`:

  ```ts
  import type { ConnectionStatus } from '@/lib/types';

  export const WS_HOSTS = [
    'wss://data-stream.market-data-source.vision',
    'wss://stream.market-data-source.com:443',
  ] as const;

  export type WsListener = (data: unknown) => void;

  // WebSocket readyState values, inlined so the module can be imported on the
  // server (where the global WebSocket may not exist) without touching it.
  const CONNECTING = 0;
  const OPEN = 1;

  const BACKOFF_BASE_MS = 1_000;
  const BACKOFF_CAP_MS = 30_000;
  const MAX_CONSECUTIVE_FAILURES = 4;
  const POLLING_RETRY_MS = 30_000; // low-frequency retry cadence while status is 'polling'

  /** Delay before retry number `failure` (1-based): 1s, 2s, 4s, … capped at 30s. */
  export function backoffDelay(failure: number): number {
    return Math.min(BACKOFF_BASE_MS * 2 ** (failure - 1), BACKOFF_CAP_MS);
  }

  type SocketFactory = (url: string) => WebSocket;

  /**
   * One shared combined-stream connection (spec §4.1).
   *
   * - URL: `<host>/stream?streams=a/b/c`; frames arrive as `{stream, data}`.
   * - Streams added while OPEN use live SUBSCRIBE messages; on every (re)connect
   *   the URL carries all currently subscribed streams, so reconnects resubscribe
   *   automatically.
   * - Reconnect: exponential backoff 1s→30s cap, rotating hosts each failure.
   *   After 4 consecutive failures across both hosts, status becomes 'polling'
   *   (spec §6) — but retries continue at a low 30s frequency (status stays
   *   'polling' during those attempts); a successful open restores 'streaming'.
   *   connect() and disconnect() both cancel a pending 30s retry.
   */
  export class WsManager {
    private readonly makeSocket: SocketFactory;
    private socket: WebSocket | null = null;
    private readonly listeners = new Map<string, Set<WsListener>>();
    private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
    private _status: ConnectionStatus = 'connecting';
    private failures = 0; // consecutive non-manual closes
    private hostIndex = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pollingRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private msgId = 0;

    constructor(makeSocket: SocketFactory = (url) => new WebSocket(url)) {
      this.makeSocket = makeSocket;
    }

    get status(): ConnectionStatus {
      return this._status;
    }

    onStatus(cb: (s: ConnectionStatus) => void): () => void {
      this.statusListeners.add(cb);
      return () => {
        this.statusListeners.delete(cb);
      };
    }

    /**
     * Start (or restart after 'polling' / disconnect()). Idempotent: no-op while
     * a socket is connecting/open or a backoff retry is already scheduled. A
     * pending 30s polling retry is cancelled and replaced by an immediate fresh
     * cycle from the primary host.
     */
    connect(): void {
      if (
        this.socket &&
        (this.socket.readyState === CONNECTING || this.socket.readyState === OPEN)
      ) {
        return;
      }
      if (this.pollingRetryTimer !== null) {
        // Caller wants a fresh cycle right now — skip the low-frequency wait.
        clearTimeout(this.pollingRetryTimer);
        this.pollingRetryTimer = null;
      }
      if (this.reconnectTimer !== null) return;
      this.failures = 0;
      this.hostIndex = 0;
      this.setStatus('connecting');
      this.open();
    }

    /** Close cleanly: cancel any pending retry (backoff or 30s polling) and never auto-reconnect. */
    disconnect(): void {
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.pollingRetryTimer !== null) {
        clearTimeout(this.pollingRetryTimer);
        this.pollingRetryTimer = null;
      }
      const sock = this.socket;
      this.socket = null;
      if (sock) {
        // Detach first so the close event cannot re-enter the retry logic.
        sock.onopen = null;
        sock.onmessage = null;
        sock.onclose = null;
        sock.onerror = null;
        sock.close();
      }
    }

    /** Register a listener for a stream (e.g. "!miniTicker@arr"). Returns unsubscribe. */
    subscribe(stream: string, cb: WsListener): () => void {
      let subs = this.listeners.get(stream);
      const isNewStream = subs === undefined;
      if (subs === undefined) {
        subs = new Set();
        this.listeners.set(stream, subs);
      }
      subs.add(cb);
      if (isNewStream && this.socket?.readyState === OPEN) {
        this.sendJson({ method: 'SUBSCRIBE', params: [stream], id: ++this.msgId });
      }

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const set = this.listeners.get(stream);
        if (!set) return;
        set.delete(cb);
        if (set.size === 0) {
          this.listeners.delete(stream);
          if (this.socket?.readyState === OPEN) {
            this.sendJson({ method: 'UNSUBSCRIBE', params: [stream], id: ++this.msgId });
          }
        }
      };
    }

    private setStatus(s: ConnectionStatus): void {
      if (s === this._status) return;
      this._status = s;
      for (const cb of [...this.statusListeners]) cb(s);
    }

    private sendJson(msg: object): void {
      this.socket?.send(JSON.stringify(msg));
    }

    private open(): void {
      const host = WS_HOSTS[this.hostIndex];
      const streamsAtOpen = [...this.listeners.keys()];
      const url = `${host}/stream?streams=${streamsAtOpen.join('/')}`;
      const sock = this.makeSocket(url);
      this.socket = sock;

      sock.onopen = () => {
        if (sock !== this.socket) return;
        this.failures = 0;
        this.setStatus('streaming');
        // Streams subscribed while this socket was still connecting are not in
        // the URL — attach them now.
        const inUrl = new Set(streamsAtOpen);
        for (const stream of this.listeners.keys()) {
          if (!inUrl.has(stream)) {
            this.sendJson({ method: 'SUBSCRIBE', params: [stream], id: ++this.msgId });
          }
        }
      };

      sock.onmessage = (ev: MessageEvent) => {
        if (sock !== this.socket) return;
        if (typeof ev.data !== 'string') return;
        let frame: unknown;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return; // malformed frame — ignore
        }
        if (typeof frame !== 'object' || frame === null) return;
        const { stream, data } = frame as { stream?: unknown; data?: unknown };
        if (typeof stream !== 'string') return; // e.g. SUBSCRIBE acks {result,id}
        const subs = this.listeners.get(stream);
        if (!subs) return;
        for (const cb of [...subs]) cb(data); // copy: a cb may unsubscribe mid-dispatch
      };

      sock.onerror = () => {
        // Browsers always follow error with close; all retry logic lives in onclose.
      };

      sock.onclose = () => {
        if (sock !== this.socket) return; // superseded socket or manual disconnect
        this.socket = null;
        this.failures += 1;
        this.hostIndex = (this.hostIndex + 1) % WS_HOSTS.length; // rotate hosts
        if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
          // Polled data drives the UI now, but keep trying at a low 30s cadence
          // so the stream recovers on its own. Status stays 'polling' during
          // these attempts; a successful open flips it back to 'streaming'.
          this.setStatus('polling');
          this.pollingRetryTimer = setTimeout(() => {
            this.pollingRetryTimer = null;
            this.open();
          }, POLLING_RETRY_MS);
          return;
        }
        this.setStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.open();
        }, backoffDelay(this.failures));
      };
    }
  }

  /** Module singleton — the whole app shares one connection. */
  export const wsManager = new WsManager();
  ```

- [ ] **Step 6: Run the test file and confirm all tests pass.**

  ```bash
  npx vitest run lib/market-data/ws-manager.test.ts
  ```

  Expected: PASS —

  ```
  ✓ lib/market-data/ws-manager.test.ts (26 tests)

  Test Files  1 passed (1)
       Tests  26 passed (26)
  ```

- [ ] **Step 7: Verify types and the whole suite still pass.**

  ```bash
  npx tsc --noEmit
  npm run test
  ```

  Expected: `tsc` exits silently with code 0; `npm run test` reports every test file passing (all files green, 0 failed), including `lib/market-data/ws-manager.test.ts` with 26 tests.

### Task 8: Watchlist store (persisted)

**Files:**
- Create: `stores/watchlist.ts`
- Test: `stores/watchlist.test.ts`

- [ ] **Step 1: Write the failing test.** Create `stores/watchlist.test.ts`. Persistence is tested by asserting the raw `localStorage` content and by creating a *fresh* store instance via `vi.resetModules()` + dynamic import (a fresh module registry re-runs `create(persist(...))`, which hydrates synchronously from `localStorage` because the storage is synchronous):

```ts
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

  it('writes state to localStorage under "riverflow-watchlist"', async () => {
    const useWatchlist = await freshStore();
    useWatchlist.getState().toggle('solana');
    const raw = localStorage.getItem('riverflow-watchlist');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state.ids).toEqual(['solana']);
  });

  it('a fresh store hydrates ids from localStorage', async () => {
    localStorage.setItem(
      'riverflow-watchlist',
      JSON.stringify({ state: { ids: ['cardano', 'dogecoin'] }, version: 0 }),
    );
    const useWatchlist = await freshStore();
    expect(useWatchlist.getState().ids).toEqual(['cardano', 'dogecoin']);
    expect(useWatchlist.getState().has('cardano')).toBe(true);
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    localStorage.setItem('riverflow-watchlist', '{"state": {{{ not json');
    const useWatchlist = await freshStore();
    expect(useWatchlist.getState().ids).toEqual([]);
    useWatchlist.getState().toggle('bitcoin');
    expect(useWatchlist.getState().ids).toEqual(['bitcoin']);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

```sh
npx vitest run stores/watchlist.test.ts
```

Expected output (module does not exist yet):

```
FAIL  stores/watchlist.test.ts [ stores/watchlist.test.ts ]
Error: Failed to resolve import "@/stores/watchlist" from "stores/watchlist.test.ts". Does the file exist?
 Test Files  1 failed (1)
```

- [ ] **Step 3: Implement the store.** Create `stores/watchlist.ts` per the contract interface (`persist` middleware, storage key `riverflow-watchlist`, `createJSONStorage(() => localStorage)`; zustand's persist swallows a JSON-parse error during hydration and keeps the defaults, which is exactly the corrupt-storage fallback the spec requires):

```ts
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
      name: 'riverflow-watchlist',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
```

- [ ] **Step 4: Run the test — expect PASS.**

```sh
npx vitest run stores/watchlist.test.ts
```

Expected output:

```
 ✓ stores/watchlist.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: Verify types compile.**

```sh
npx tsc --noEmit
```

Expected: no output, exit code 0.

### Task 9: Portfolio store (persisted, delegates to lib/trading.ts)

**Files:**
- Create: `stores/portfolio.ts`
- Test: `stores/portfolio.test.ts`

- [ ] **Step 1: Write the failing test.** Create `stores/portfolio.test.ts`. Note the `fresh()` helper imports the store **and** `@/lib/trading` in the same fresh module registry — after `vi.resetModules()` the store binds to a *new* instance of the trading module, so `toThrow(SomeErrorClass)` must use the error classes from that same registry (class identity), not a top-level static import:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Holding } from '@/lib/types';

async function fresh() {
  vi.resetModules();
  const [storeMod, trading] = await Promise.all([
    import('@/stores/portfolio'),
    import('@/lib/trading'),
  ]);
  return { usePortfolio: storeMod.usePortfolio, trading };
}

describe('usePortfolio', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with INITIAL_CASH, no holdings, no trades', async () => {
    const { usePortfolio, trading } = await fresh();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('buy debits cash including fee, adds a holding, and records the trade', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    const s = usePortfolio.getState();
    expect(s.cash).toBeCloseTo(49_950, 6); // 100000 - 50000*1.001
    expect(s.holdings).toEqual([
      { coinId: 'bitcoin', symbol: 'btc', qty: 1, avgCost: 50_000 },
    ]);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0]).toMatchObject({
      side: 'buy',
      coinId: 'bitcoin',
      symbol: 'btc',
      qty: 1,
      price: 50_000,
      realizedPnl: null,
    });
    expect(s.trades[0].fee).toBeCloseTo(50, 6);
    expect(typeof s.trades[0].timestamp).toBe('number');
  });

  it('buy beyond cash throws InsufficientFundsError and leaves state unchanged', async () => {
    const { usePortfolio, trading } = await fresh();
    expect(() => usePortfolio.getState().buy('bitcoin', 'btc', 3, 50_000)).toThrow(
      trading.InsufficientFundsError,
    );
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('sell credits proceeds minus fee, removes the emptied holding, records realized P&L', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    usePortfolio.getState().sell('bitcoin', 1, 60_000);
    const s = usePortfolio.getState();
    expect(s.cash).toBeCloseTo(109_890, 6); // 49950 + 60000*0.999
    expect(s.holdings).toEqual([]);
    expect(s.trades).toHaveLength(2);
    expect(s.trades[0]).toMatchObject({ side: 'sell', coinId: 'bitcoin', qty: 1, price: 60_000 }); // newest first
    expect(s.trades[0].realizedPnl).toBeCloseTo(10_000, 6);
  });

  it('sell beyond holdings throws InsufficientHoldingsError and leaves state unchanged', async () => {
    const { usePortfolio, trading } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 1, 50_000);
    expect(() => usePortfolio.getState().sell('bitcoin', 2, 60_000)).toThrow(
      trading.InsufficientHoldingsError,
    );
    const s = usePortfolio.getState();
    expect(s.holdings).toHaveLength(1);
    expect(s.holdings[0].qty).toBe(1);
    expect(s.trades).toHaveLength(1);
  });

  it('reset restores INITIAL_CASH and clears holdings and trades', async () => {
    const { usePortfolio, trading } = await fresh();
    usePortfolio.getState().buy('bitcoin', 'btc', 0.5, 40_000);
    usePortfolio.getState().reset();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(trading.INITIAL_CASH);
    expect(s.holdings).toEqual([]);
    expect(s.trades).toEqual([]);
  });

  it('persists under the "riverflow-portfolio" key', async () => {
    const { usePortfolio } = await fresh();
    usePortfolio.getState().buy('ethereum', 'eth', 2, 3_000);
    const raw = localStorage.getItem('riverflow-portfolio');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.cash).toBeCloseTo(93_994, 6); // 100000 - 2*3000*1.001
    expect(persisted.holdings).toEqual([
      { coinId: 'ethereum', symbol: 'eth', qty: 2, avgCost: 3_000 },
    ]);
    expect(persisted.trades).toHaveLength(1);
  });

  it('a fresh store hydrates persisted cash/holdings/trades', async () => {
    const holdings: Holding[] = [{ coinId: 'bitcoin', symbol: 'btc', qty: 0.25, avgCost: 48_000 }];
    localStorage.setItem(
      'riverflow-portfolio',
      JSON.stringify({ state: { cash: 1_234.56, holdings, trades: [] }, version: 0 }),
    );
    const { usePortfolio } = await fresh();
    const s = usePortfolio.getState();
    expect(s.cash).toBe(1_234.56);
    expect(s.holdings).toEqual(holdings);
    expect(s.trades).toEqual([]);
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    localStorage.setItem('riverflow-portfolio', 'not-json{{{');
    const { usePortfolio, trading } = await fresh();
    expect(usePortfolio.getState().cash).toBe(trading.INITIAL_CASH);
    expect(usePortfolio.getState().holdings).toEqual([]);
    expect(usePortfolio.getState().trades).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

```sh
npx vitest run stores/portfolio.test.ts
```

Expected output:

```
FAIL  stores/portfolio.test.ts [ stores/portfolio.test.ts ]
Error: Failed to resolve import "@/stores/portfolio" from "stores/portfolio.test.ts". Does the file exist?
 Test Files  1 failed (1)
```

- [ ] **Step 3: Implement the store.** Create `stores/portfolio.ts`. All money math lives in `lib/trading.ts` (Task 4); the store only threads state through `executeBuy`/`executeSell` and records the trade. Because `set` is only called *after* the pure function returns, a thrown `InsufficientFundsError`/`InsufficientHoldingsError` propagates to the caller with state untouched. Trades are stored newest-first (`trades[0]` is the latest), matching the spec's "newest first" history display:

```ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { executeBuy, executeSell, INITIAL_CASH } from '@/lib/trading';
import type { Holding, Trade } from '@/lib/types';

interface PortfolioState {
  cash: number;
  holdings: Holding[];
  trades: Trade[];
  buy(coinId: string, symbol: string, qty: number, price: number): void;
  sell(coinId: string, qty: number, price: number): void;
  reset(): void;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      cash: INITIAL_CASH,
      holdings: [],
      trades: [],
      buy: (coinId, symbol, qty, price) => {
        const { cash, holdings, trades } = get();
        const next = executeBuy({ cash, holdings }, coinId, symbol, qty, price, Date.now());
        set({ cash: next.cash, holdings: next.holdings, trades: [next.trade, ...trades] });
      },
      sell: (coinId, qty, price) => {
        const { cash, holdings, trades } = get();
        const next = executeSell({ cash, holdings }, coinId, qty, price, Date.now());
        set({ cash: next.cash, holdings: next.holdings, trades: [next.trade, ...trades] });
      },
      reset: () => set({ cash: INITIAL_CASH, holdings: [], trades: [] }),
    }),
    {
      name: 'riverflow-portfolio',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
```

- [ ] **Step 4: Run the test — expect PASS.**

```sh
npx vitest run stores/portfolio.test.ts
```

Expected output:

```
 ✓ stores/portfolio.test.ts (9 tests)
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Verify types compile.**

```sh
npx tsc --noEmit
```

Expected: no output, exit code 0.

### Task 10: Market store + market feed hook + provider

**Files:**
- Create: `stores/market.ts`
- Test: `stores/market.test.ts`
- Create: `hooks/use-market-feed.ts`
- Test: `hooks/use-market-feed.test.ts`
- Create: `components/MarketFeedProvider.tsx`

- [ ] **Step 1: Write the failing market-store test.** Create `stores/market.test.ts`. The market store is a non-persisted singleton, so tests reset it with `setState` in `beforeEach` (no module reset needed):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { CoinMarket, LiveTicker } from '@/lib/types';
import { useMarket } from '@/stores/market';

function makeCoin(over: Pick<CoinMarket, 'id' | 'symbol' | 'price'> & Partial<CoinMarket>): CoinMarket {
  return {
    name: over.id,
    image: 'https://example.com/logo.png',
    rank: 1,
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    sparkline7d: [],
    ...over,
  };
}

function makeTicker(pair: string, price: number): LiveTicker {
  return {
    pair,
    price,
    open24h: price * 0.98,
    high24h: price * 1.02,
    low24h: price * 0.95,
    volume24h: 1_000_000,
    updatedAt: 1_722_600_000_000,
  };
}

describe('useMarket', () => {
  beforeEach(() => {
    useMarket.setState({
      coins: [],
      trending: [],
      tickers: {},
      pairs: new Set<string>(),
      status: 'connecting',
      lastMessageAt: 0,
      marketsError: false,
    });
  });

  it('applyTickers merges tickers by pair and overwrites existing entries', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000), makeTicker('ETHUSDT', 3_000)]);
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 51_000)]);
    const { tickers } = useMarket.getState();
    expect(Object.keys(tickers).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(tickers.BTCUSDT.price).toBe(51_000);
    expect(tickers.ETHUSDT.price).toBe(3_000);
  });

  it('applyTickers stamps lastMessageAt with the current time', () => {
    expect(useMarket.getState().lastMessageAt).toBe(0);
    const before = Date.now();
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000)]);
    expect(useMarket.getState().lastMessageAt).toBeGreaterThanOrEqual(before);
  });

  it('setStatus updates status', () => {
    useMarket.getState().setStatus('streaming');
    expect(useMarket.getState().status).toBe('streaming');
    useMarket.getState().setStatus('polling');
    expect(useMarket.getState().status).toBe('polling');
  });

  it('setStatus("polling") clears the tickers map so polled prices drive the display', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000), makeTicker('ETHUSDT', 3_000)]);
    expect(Object.keys(useMarket.getState().tickers)).toHaveLength(2);
    useMarket.getState().setStatus('polling');
    expect(useMarket.getState().status).toBe('polling');
    expect(useMarket.getState().tickers).toEqual({});
  });

  it('setStatus("streaming") preserves already-applied tickers', () => {
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 50_000)]);
    useMarket.getState().setStatus('reconnecting');
    useMarket.getState().setStatus('streaming');
    expect(useMarket.getState().tickers.BTCUSDT.price).toBe(50_000);
  });

  it('marketsError defaults to false and setMarketsError toggles it', () => {
    expect(useMarket.getState().marketsError).toBe(false);
    useMarket.getState().setMarketsError(true);
    expect(useMarket.getState().marketsError).toBe(true);
    useMarket.getState().setMarketsError(false);
    expect(useMarket.getState().marketsError).toBe(false);
  });

  it('pairForCoin maps a coin with a tradable USDT pair', () => {
    useMarket.setState({
      coins: [makeCoin({ id: 'bitcoin', symbol: 'btc', price: 50_000 })],
      pairs: new Set(['BTCUSDT', 'ETHUSDT']),
    });
    expect(useMarket.getState().pairForCoin('bitcoin')).toBe('BTCUSDT');
  });

  it('pairForCoin returns null for the usdt stablecoin and for coins without a pair', () => {
    useMarket.setState({
      coins: [
        makeCoin({ id: 'tether', symbol: 'usdt', price: 1 }),
        makeCoin({ id: 'obscurecoin', symbol: 'obsc', price: 0.01 }),
      ],
      pairs: new Set(['BTCUSDT', 'USDTUSDT']),
    });
    expect(useMarket.getState().pairForCoin('tether')).toBeNull();
    expect(useMarket.getState().pairForCoin('obscurecoin')).toBeNull();
  });

  it('pairForCoin returns null for an unknown coin id', () => {
    expect(useMarket.getState().pairForCoin('nope')).toBeNull();
  });

  it('priceFor prefers the live ticker for a mapped coin', () => {
    useMarket.setState({
      coins: [makeCoin({ id: 'bitcoin', symbol: 'btc', price: 50_000 })],
      pairs: new Set(['BTCUSDT']),
    });
    useMarket.getState().applyTickers([makeTicker('BTCUSDT', 51_234)]);
    expect(useMarket.getState().priceFor('bitcoin')).toBe(51_234);
  });

  it('priceFor falls back to CoinMarket.price when there is no ticker yet or no pair', () => {
    useMarket.setState({
      coins: [
        makeCoin({ id: 'bitcoin', symbol: 'btc', price: 50_000 }), // mapped, no ticker received yet
        makeCoin({ id: 'tether', symbol: 'usdt', price: 1 }),      // unmapped by the stablecoin rule
      ],
      pairs: new Set(['BTCUSDT']),
    });
    expect(useMarket.getState().priceFor('bitcoin')).toBe(50_000);
    expect(useMarket.getState().priceFor('tether')).toBe(1);
  });

  it('priceFor returns undefined for an unknown coin', () => {
    expect(useMarket.getState().priceFor('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

```sh
npx vitest run stores/market.test.ts
```

Expected output:

```
FAIL  stores/market.test.ts [ stores/market.test.ts ]
Error: Failed to resolve import "@/stores/market" from "stores/market.test.ts". Does the file exist?
 Test Files  1 failed (1)
```

- [ ] **Step 3: Implement the market store.** Create `stores/market.ts` (NOT persisted; initial status `'connecting'`; `pairForCoin` joins `coins` with `pairFor` from Task 6; `priceFor` = live ticker price if mapped and present, else `CoinMarket.price`, else `undefined` for unknown coins). Two details beyond the plain setters: `setStatus('polling')` also **empties the tickers map** — in polling mode the 30s `/api/markets` refresh is the only source of truth (spec §4.4), and a stale WS ticker would otherwise shadow the freshly polled price forever; and `marketsError` (initially `false`) records that `/api/markets` failed while `coins` is still empty, which Task 15's `MarketsTable` uses to switch to its market-data-source-only fallback instead of an endless skeleton:

```ts
import { create } from 'zustand';
import { pairFor } from '@/lib/symbol-map';
import type { CoinMarket, ConnectionStatus, LiveTicker, TrendingCoin } from '@/lib/types';

interface MarketState {
  coins: CoinMarket[];
  trending: TrendingCoin[];
  tickers: Record<string, LiveTicker>;
  pairs: Set<string>;
  status: ConnectionStatus;
  lastMessageAt: number;
  marketsError: boolean;
  setCoins(c: CoinMarket[]): void;
  setTrending(t: TrendingCoin[]): void;
  setPairs(p: Set<string>): void;
  setStatus(s: ConnectionStatus): void;
  setMarketsError(v: boolean): void;
  applyTickers(list: LiveTicker[]): void;
  pairForCoin(coinId: string): string | null;
  priceFor(coinId: string): number | undefined;
}

export const useMarket = create<MarketState>()((set, get) => ({
  coins: [],
  trending: [],
  tickers: {},
  pairs: new Set<string>(),
  status: 'connecting',
  lastMessageAt: 0,
  marketsError: false,
  setCoins: (coins) => set({ coins }),
  setTrending: (trending) => set({ trending }),
  setPairs: (pairs) => set({ pairs }),
  // Entering polling mode drops live tickers: polled /api/markets prices become the
  // single source of truth, and a frozen WS ticker must not shadow them.
  setStatus: (status) =>
    set((state) => ({ status, tickers: status === 'polling' ? {} : state.tickers })),
  setMarketsError: (marketsError) => set({ marketsError }),
  applyTickers: (list) =>
    set((s) => {
      const tickers = { ...s.tickers };
      for (const t of list) tickers[t.pair] = t;
      return { tickers, lastMessageAt: Date.now() };
    }),
  pairForCoin: (coinId) => {
    const coin = get().coins.find((c) => c.id === coinId);
    if (!coin) return null;
    return pairFor(coin.symbol, get().pairs);
  },
  priceFor: (coinId) => {
    const state = get();
    const coin = state.coins.find((c) => c.id === coinId);
    if (!coin) return undefined;
    const pair = state.pairForCoin(coinId);
    const live = pair ? state.tickers[pair] : undefined;
    return live ? live.price : coin.price;
  },
}));
```

- [ ] **Step 4: Run the test — expect PASS.**

```sh
npx vitest run stores/market.test.ts
```

Expected output:

```
 ✓ stores/market.test.ts (12 tests)
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

- [ ] **Step 5: Write the failing mapper test.** Create `hooks/use-market-feed.test.ts`. Only the pure mapper `mapMiniTickers` is unit-tested; the effect wiring gets a manual verification (Step 12, executed inside Task 17's visual check). Raw market-data-source miniTicker fields: `s` pair, `c` close, `o` open, `h` high, `l` low, `q` quote volume, `E` event time ms — numeric fields arrive as strings:

```ts
import { describe, expect, it } from 'vitest';
import { mapMiniTickers } from '@/hooks/use-market-feed';

describe('mapMiniTickers', () => {
  it('maps raw market-data-source miniTicker fields (s,c,o,h,l,q,E) to LiveTicker', () => {
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
```

- [ ] **Step 6: Run the test — expect FAIL.**

```sh
npx vitest run hooks/use-market-feed.test.ts
```

Expected output:

```
FAIL  hooks/use-market-feed.test.ts [ hooks/use-market-feed.test.ts ]
Error: Failed to resolve import "@/hooks/use-market-feed" from "hooks/use-market-feed.test.ts". Does the file exist?
 Test Files  1 failed (1)
```

- [ ] **Step 7: Implement the feed hook.** Create `hooks/use-market-feed.ts`. Behavior per contract: on mount fetch `/api/markets` + `/api/trending` into the store; `fetchTradablePairs()` → `setPairs` (a `GeoBlockedError` forces `setStatus('polling')`); `?polling=1` in the URL skips the WebSocket entirely; otherwise connect the singleton `wsManager`, mirror its status into the store, subscribe `'!miniTicker@arr'` and map frames through `mapMiniTickers` → `applyTickers`. Four points that the code below makes explicit:

  1. **`refreshMarkets()` is a module-level export taking no arguments** — `MarketsTable`'s Retry button (Task 15) imports and calls it directly. It writes only to the global store, so a response that lands after unmount is harmless: no cancellation flag is needed (the store call is idempotent — the last write wins and no React component state is touched).
  2. **Error policy:** a failed `/api/markets` sets `marketsError` **only when `coins` is still empty**; when we already hold good data the failure is swallowed and the last snapshot stays on screen. A successful fetch always clears the flag. `/api/trending` failures never touch `marketsError` — an empty trending strip is not an outage.
  3. **Two refresh timers.** An unconditional 60s interval re-fetches `/api/markets` regardless of connection status, so unmapped coins (no market-data-source pair) track CoinGecko's own 60s cache instead of freezing at their first value (spec §3.2 / §4.3 / §4.5). On top of that, the 30s interval runs *only* while `status === 'polling'`, where CoinGecko is the sole price source. Both are cleared on unmount.
  4. **Zombie-socket replacement on `visibilitychange`.** After laptop sleep a socket can stay `OPEN` while delivering nothing, and `connect()` is idempotent — it would see an open socket and do nothing. So when the tab becomes visible with `status === 'streaming'` but no frame for over 60s, `disconnect()` runs first, then `connect()`. Visibility restore also triggers `refreshMarkets()`.

  Every effect returns a cleanup so React Strict Mode double-invocation is safe (`wsManager.connect()` is idempotent, subscriptions return unsubscribers):

```ts
'use client';

import { useEffect } from 'react';
import { fetchTradablePairs, GeoBlockedError } from '@/lib/market-data/rest';
import { wsManager } from '@/lib/market-data/ws-manager';
import type { CoinMarket, LiveTicker, TrendingCoin } from '@/lib/types';
import { useMarket } from '@/stores/market';

/** Polling mode only: CoinGecko is the sole price source, refresh twice per cache window. */
const POLL_INTERVAL_MS = 30_000;
/** Always on: matches /api/markets' 60s cache so unmapped coins keep moving. */
const BASELINE_REFRESH_MS = 60_000;
/** A 'streaming' socket silent for this long after a tab wake is treated as dead. */
const ZOMBIE_SOCKET_MS = 60_000;

/** Pure mapper: raw `!miniTicker@arr` payload → LiveTicker[]. Malformed entries are skipped. */
export function mapMiniTickers(raw: unknown[]): LiveTicker[] {
  const out: LiveTicker[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.s !== 'string') continue;
    const price = Number(t.c);
    const open24h = Number(t.o);
    const high24h = Number(t.h);
    const low24h = Number(t.l);
    const volume24h = Number(t.q);
    const updatedAt = Number(t.E);
    if (![price, open24h, high24h, low24h, volume24h, updatedAt].every(Number.isFinite)) continue;
    out.push({ pair: t.s, price, open24h, high24h, low24h, volume24h, updatedAt });
  }
  return out;
}

function pollingForced(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('polling') === '1';
}

/**
 * Re-fetch `/api/markets` into the store. Module-level and no-arg so any component can
 * call it (Task 15's Retry button imports this). Writes go straight to the global store,
 * so a late response after unmount is a harmless idempotent write — no cancel flag needed.
 * `marketsError` is only raised when there is nothing to show; otherwise the last good
 * snapshot stays on screen and the failure is silent.
 */
export async function refreshMarkets(): Promise<void> {
  try {
    const res = await fetch('/api/markets');
    if (!res.ok) throw new Error(`markets responded ${res.status}`);
    const coins = (await res.json()) as CoinMarket[];
    useMarket.getState().setCoins(coins);
    useMarket.getState().setMarketsError(false);
  } catch {
    if (useMarket.getState().coins.length === 0) useMarket.getState().setMarketsError(true);
  }
}

export function useMarketFeed(): void {
  const status = useMarket((s) => s.status);

  // 1) Initial data: markets + trending + tradable pairs.
  useEffect(() => {
    let cancelled = false;
    void refreshMarkets();
    (async () => {
      try {
        const res = await fetch('/api/trending');
        if (!res.ok) return;
        const trending = (await res.json()) as TrendingCoin[];
        if (!cancelled) useMarket.getState().setTrending(trending);
      } catch {
        // trending strip simply stays empty — never counts as a markets outage
      }
    })();
    (async () => {
      try {
        const pairs = await fetchTradablePairs();
        if (!cancelled) useMarket.getState().setPairs(pairs);
      } catch (e) {
        if (!cancelled && e instanceof GeoBlockedError) useMarket.getState().setStatus('polling');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) WebSocket: connect, mirror status into the store, subscribe all-market mini tickers.
  useEffect(() => {
    if (pollingForced()) {
      useMarket.getState().setStatus('polling');
      return;
    }
    const offStatus = wsManager.onStatus((s) => useMarket.getState().setStatus(s));
    useMarket.getState().setStatus(wsManager.status);
    wsManager.connect();
    const offTickers = wsManager.subscribe('!miniTicker@arr', (data) => {
      if (Array.isArray(data)) useMarket.getState().applyTickers(mapMiniTickers(data));
    });
    return () => {
      offTickers();
      offStatus();
    };
  }, []);

  // 3) Baseline refresh: every 60s in EVERY mode, matching /api/markets' cache window.
  //    Coins without a market-data-source pair have no WS ticks, so this is their only price update.
  useEffect(() => {
    const id = setInterval(() => void refreshMarkets(), BASELINE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // 4) Polling loop: while streaming is unavailable, tighten the cadence to 30s
  //    (on top of the baseline above) since CoinGecko is then the only price source.
  useEffect(() => {
    if (status !== 'polling') return;
    const id = setInterval(() => void refreshMarkets(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  // 5) Tab becomes visible again (24h WS cap, laptop sleep): refresh prices, and replace
  //    the socket if it is nominally OPEN but has gone silent — connect() alone would
  //    see an open socket and no-op, leaving a dead stream in place.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshMarkets();
      if (pollingForced()) return;
      if (
        useMarket.getState().status === 'streaming' &&
        Date.now() - useMarket.getState().lastMessageAt > ZOMBIE_SOCKET_MS
      ) {
        wsManager.disconnect();
      }
      wsManager.connect();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
```

- [ ] **Step 8: Run the test — expect PASS.**

```sh
npx vitest run hooks/use-market-feed.test.ts
```

Expected output:

```
 ✓ hooks/use-market-feed.test.ts (3 tests)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 9: Implement the provider.** Create `components/MarketFeedProvider.tsx` — a `'use client'` component that mounts the hook once and renders nothing (Task 17 places it in `app/layout.tsx` so the feed runs exactly once app-wide):

```tsx
'use client';

import { useMarketFeed } from '@/hooks/use-market-feed';

export function MarketFeedProvider() {
  useMarketFeed();
  return null;
}

export default MarketFeedProvider;
```

- [ ] **Step 10: Verify types compile and lint passes.**

```sh
npx tsc --noEmit && npm run lint
```

Expected: tsc prints nothing; lint reports no errors.

- [ ] **Step 11: Run the full unit suite.**

```sh
npm test
```

Expected: all test files pass, including `stores/watchlist.test.ts`, `stores/portfolio.test.ts`, `stores/market.test.ts`, `hooks/use-market-feed.test.ts` and the earlier lib tests. `Test Files  N passed`, 0 failed.

- [ ] **Step 12: Runtime feed verification is deferred.** Nothing mounts this hook yet (`<MarketFeedProvider/>` reaches `app/layout.tsx` in Task 17, and `/api/markets` + `/api/trending` arrive in Tasks 11–12), so the three runtime feed checks for this hook are executed in **Task 17 Step 4**.


### Task 11: CoinGecko client (`lib/coingecko.ts`) + `/api/markets` route

**Files:**
- Create: `lib/coingecko.ts`
- Create: `lib/coingecko.test.ts`
- Create: `app/api/markets/route.ts`
- Create: `app/api/markets/route.test.ts`

- [ ] **Step 1: Write the failing unit test for the CoinGecko client.** Create `lib/coingecko.test.ts` with the full contents below. It mocks global `fetch` (never hits the network), covers the request shape (top 50, `sparkline=true`, `price_change_percentage=24h`), field mapping including upstream nulls → `0` / `[]`, the `x-cg-demo-api-key` header being sent **only** when `COINGECKO_API_KEY` is set, and error throwing on non-2xx responses. Note that in the trending fixture the coin numbers are nested under `item.data` — that is the real CoinGecko `/search/trending` payload shape.

  ```ts
  // lib/coingecko.test.ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { fetchMarkets, fetchTrending } from '@/lib/coingecko';

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const fullMarketRow = {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    market_cap_rank: 1,
    current_price: 67241.5,
    price_change_percentage_24h: 4.2,
    total_volume: 28_100_000_000,
    market_cap: 1_320_000_000_000,
    sparkline_in_7d: { price: [66000, 66500, 67241.5] },
  };

  // A newly listed coin: CoinGecko returns nulls for most numeric fields.
  const nullMarketRow = {
    id: 'mysterycoin',
    symbol: 'MYS',
    name: 'Mystery',
    image: null,
    market_cap_rank: null,
    current_price: null,
    price_change_percentage_24h: null,
    total_volume: null,
    market_cap: null,
    sparkline_in_7d: null,
  };

  describe('fetchMarkets', () => {
    it('requests top-50 USD markets with sparkline and 24h change', async () => {
      const mock = vi.fn().mockResolvedValue(jsonResponse([fullMarketRow]));
      vi.stubGlobal('fetch', mock);

      await fetchMarkets();

      const url = mock.mock.calls[0][0] as string;
      expect(url.startsWith('https://api.coingecko.com/api/v3/coins/markets?')).toBe(true);
      expect(url).toContain('vs_currency=usd');
      expect(url).toContain('per_page=50');
      expect(url).toContain('sparkline=true');
      expect(url).toContain('price_change_percentage=24h');
    });

    it('maps upstream fields onto CoinMarket', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([fullMarketRow])));

      const [coin] = await fetchMarkets();

      expect(coin).toEqual({
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
        rank: 1,
        price: 67241.5,
        change24h: 4.2,
        volume24h: 28_100_000_000,
        marketCap: 1_320_000_000_000,
        sparkline7d: [66000, 66500, 67241.5],
      });
    });

    it('maps null numerics to 0, null sparkline to [], and lowercases the symbol', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([nullMarketRow])));

      const [coin] = await fetchMarkets();

      expect(coin).toEqual({
        id: 'mysterycoin',
        symbol: 'mys',
        name: 'Mystery',
        image: '',
        rank: 0,
        price: 0,
        change24h: 0,
        volume24h: 0,
        marketCap: 0,
        sparkline7d: [],
      });
    });

    it('omits the demo key header when COINGECKO_API_KEY is unset', async () => {
      vi.stubEnv('COINGECKO_API_KEY', ''); // deterministic even if the dev machine exports a real key
      const mock = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal('fetch', mock);

      await fetchMarkets();

      const headers = mock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-cg-demo-api-key']).toBeUndefined();
    });

    it('sends x-cg-demo-api-key when COINGECKO_API_KEY is set', async () => {
      vi.stubEnv('COINGECKO_API_KEY', 'CG-test-key');
      const mock = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal('fetch', mock);

      await fetchMarkets();

      const headers = mock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-cg-demo-api-key']).toBe('CG-test-key');
    });

    it('throws when upstream responds non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limit' }, 429)),
      );

      await expect(fetchMarkets()).rejects.toThrow('429');
    });
  });

  // Real /search/trending shape: each coin sits under coins[i].item, and the
  // market numbers one level deeper under item.data.
  const trendingPayload = {
    coins: [
      {
        item: {
          id: 'pepe',
          coin_id: 24478,
          name: 'Pepe',
          symbol: 'PEPE',
          market_cap_rank: 42,
          thumb: 'https://assets.coingecko.com/coins/images/24478/thumb/pepe.png',
          small: 'https://assets.coingecko.com/coins/images/24478/small/pepe.png',
          data: {
            price: 0.0000112,
            price_change_percentage_24h: { usd: 12.34, btc: 11.9 },
          },
        },
      },
      {
        item: {
          id: 'newcoin',
          name: 'New Coin',
          symbol: 'NEW',
          market_cap_rank: null,
          thumb: 'https://assets.coingecko.com/coins/images/999/thumb/new.png',
          // no `small`, no `data` block at all — must not crash
        },
      },
    ],
  };

  describe('fetchTrending', () => {
    it('flattens the nested item.data payload onto TrendingCoin', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(trendingPayload)));

      const coins = await fetchTrending();

      expect(coins).toEqual([
        {
          id: 'pepe',
          symbol: 'pepe',
          name: 'Pepe',
          image: 'https://assets.coingecko.com/coins/images/24478/small/pepe.png',
          rank: 42,
          price: 0.0000112,
          change24h: 12.34,
        },
        {
          id: 'newcoin',
          symbol: 'new',
          name: 'New Coin',
          image: 'https://assets.coingecko.com/coins/images/999/thumb/new.png',
          rank: null,
          price: 0,
          change24h: 0,
        },
      ]);
    });

    it('throws when upstream responds non-2xx', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

      await expect(fetchTrending()).rejects.toThrow('500');
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**

  ```bash
  npx vitest run lib/coingecko.test.ts
  ```

  Expected: FAIL — the suite errors before running any test with `Failed to resolve import "@/lib/coingecko"` (the module does not exist yet).

- [ ] **Step 3: Implement `lib/coingecko.ts`.** Full contents below. Null-safety decisions (all per contract "missing → 0 / []"): `CoinMarket.rank` is non-nullable so a null `market_cap_rank` becomes `0`; `TrendingCoin.rank` is `number | null` so null passes through; trending image prefers `item.small` and falls back to `item.thumb`; symbols are lowercased in both mappers to match the `CoinMarket.symbol` convention and the `/coin/[symbol]` route param. Trending numbers are read from the nested `item.data` block (`data.price`, `data.price_change_percentage_24h.usd`) with optional chaining because CoinGecko omits `data` for some coins. The demo API key is read from `process.env.COINGECKO_API_KEY` at call time and the `x-cg-demo-api-key` header is attached only when the key is truthy, so the code works keyless.

  ```ts
  // lib/coingecko.ts
  import type { CoinMarket, TrendingCoin } from '@/lib/types';

  const BASE = 'https://api.coingecko.com/api/v3';

  function cgHeaders(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const key = process.env.COINGECKO_API_KEY;
    if (key) headers['x-cg-demo-api-key'] = key;
    return headers;
  }

  async function cgFetch(path: string): Promise<unknown> {
    const res = await fetch(`${BASE}${path}`, { headers: cgHeaders() });
    if (!res.ok) throw new Error(`CoinGecko ${path.split('?')[0]} responded ${res.status}`);
    return res.json();
  }

  interface RawMarket {
    id?: string | null;
    symbol?: string | null;
    name?: string | null;
    image?: string | null;
    market_cap_rank?: number | null;
    current_price?: number | null;
    price_change_percentage_24h?: number | null;
    total_volume?: number | null;
    market_cap?: number | null;
    sparkline_in_7d?: { price?: number[] | null } | null;
  }

  export async function fetchMarkets(): Promise<CoinMarket[]> {
    const rows = (await cgFetch(
      '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=24h',
    )) as RawMarket[];
    return rows.map((r) => ({
      id: r.id ?? '',
      symbol: (r.symbol ?? '').toLowerCase(),
      name: r.name ?? '',
      image: r.image ?? '',
      rank: r.market_cap_rank ?? 0,
      price: r.current_price ?? 0,
      change24h: r.price_change_percentage_24h ?? 0,
      volume24h: r.total_volume ?? 0,
      marketCap: r.market_cap ?? 0,
      sparkline7d: r.sparkline_in_7d?.price ?? [],
    }));
  }

  interface RawTrendingEntry {
    item?: {
      id?: string | null;
      symbol?: string | null;
      name?: string | null;
      thumb?: string | null;
      small?: string | null;
      market_cap_rank?: number | null;
      data?: {
        price?: number | null;
        price_change_percentage_24h?: { usd?: number | null } | null;
      } | null;
    } | null;
  }

  export async function fetchTrending(): Promise<TrendingCoin[]> {
    const body = (await cgFetch('/search/trending')) as {
      coins?: RawTrendingEntry[] | null;
    };
    return (body.coins ?? []).map((entry) => {
      const item = entry?.item;
      return {
        id: item?.id ?? '',
        symbol: (item?.symbol ?? '').toLowerCase(),
        name: item?.name ?? '',
        image: item?.small ?? item?.thumb ?? '',
        rank: item?.market_cap_rank ?? null,
        price: item?.data?.price ?? 0,
        change24h: item?.data?.price_change_percentage_24h?.usd ?? 0,
      };
    });
  }
  ```

- [ ] **Step 4: Run the test again and watch it pass.**

  ```bash
  npx vitest run lib/coingecko.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 5: Write the failing test for the `/api/markets` route handler.** Create `app/api/markets/route.test.ts` with the full contents below. It mocks the `@/lib/coingecko` module (the client itself is already unit-tested) and asserts the ISR window, the success JSON body, and the exact `502 {error:'upstream'}` failure contract.

  ```ts
  // app/api/markets/route.test.ts
  import { beforeEach, describe, expect, it, vi } from 'vitest';
  import type { CoinMarket } from '@/lib/types';

  vi.mock('@/lib/coingecko', () => ({
    fetchMarkets: vi.fn(),
    fetchTrending: vi.fn(),
  }));

  import { fetchMarkets } from '@/lib/coingecko';
  import { GET, revalidate } from './route';

  const sample: CoinMarket[] = [
    {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
      rank: 1,
      price: 67241.5,
      change24h: 4.2,
      volume24h: 28_100_000_000,
      marketCap: 1_320_000_000_000,
      sparkline7d: [66000, 66500, 67241.5],
    },
  ];

  beforeEach(() => {
    vi.mocked(fetchMarkets).mockReset();
  });

  describe('GET /api/markets', () => {
    it('revalidates every 60 seconds', () => {
      expect(revalidate).toBe(60);
    });

    it('returns CoinMarket[] as JSON on success', async () => {
      vi.mocked(fetchMarkets).mockResolvedValue(sample);

      const res = await GET();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(sample);
    });

    it('returns 502 {error:"upstream"} when CoinGecko fails', async () => {
      vi.mocked(fetchMarkets).mockRejectedValue(
        new Error('CoinGecko /coins/markets responded 429'),
      );

      const res = await GET();

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'upstream' });
    });
  });
  ```

- [ ] **Step 6: Run the route test and watch it fail.**

  ```bash
  npx vitest run app/api/markets/route.test.ts
  ```

  Expected: FAIL — suite errors with `Failed to resolve import "./route"` (the route file does not exist yet).

- [ ] **Step 7: Implement `app/api/markets/route.ts`.** Full contents below. The catch is deliberately bare: any upstream failure (non-2xx, network error, bad JSON) maps to the single `502 {error:'upstream'}` shape; the client keeps its last good data.

  ```ts
  // app/api/markets/route.ts
  import { fetchMarkets } from '@/lib/coingecko';

  export const revalidate = 60;

  export async function GET(): Promise<Response> {
    try {
      return Response.json(await fetchMarkets());
    } catch {
      return Response.json({ error: 'upstream' }, { status: 502 });
    }
  }
  ```

- [ ] **Step 8: Run the route test again and watch it pass.**

  ```bash
  npx vitest run app/api/markets/route.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 9: Verify types and the full suite.**

  ```bash
  npx tsc --noEmit && npx vitest run
  ```

  Expected: `tsc` prints nothing; vitest reports all test files passed (every suite from Tasks 1–11 green, 0 failures).

- [ ] **Step 10: Optional live smoke check (requires internet; skip if offline).** Start the dev server and hit the route once, then stop the server:

  ```bash
  npm run dev
  # in a second terminal:
  curl -s http://localhost:3000/api/markets | head -c 300
  ```

  Expected: a JSON array beginning `[{"id":"bitcoin","symbol":"btc","name":"Bitcoin",...` with `rank`, `price`, `change24h`, `volume24h`, `marketCap`, `sparkline7d` fields. Stop the dev server (Ctrl+C) afterwards.

### Task 12: `/api/trending` route

**Files:**
- Create: `app/api/trending/route.ts`
- Create: `app/api/trending/route.test.ts`

- [ ] **Step 1: Write the failing test for the `/api/trending` route handler.** Create `app/api/trending/route.test.ts` with the full contents below. Unlike the markets route test, this one stubs global `fetch` with a realistic upstream fixture and lets the real `fetchTrending` run, because the CoinGecko trending payload nests each coin's numbers under `item.data` (`data.price`, `data.price_change_percentage_24h.usd`) and the test must prove the route returns the explicitly flattened `TrendingCoin[]` — never the raw nested payload.

  ```ts
  // app/api/trending/route.test.ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { GET, revalidate } from './route';

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Real /search/trending shape: coin numbers are nested under item.data.
  const upstream = {
    coins: [
      {
        item: {
          id: 'pepe',
          coin_id: 24478,
          name: 'Pepe',
          symbol: 'PEPE',
          market_cap_rank: 42,
          thumb: 'https://assets.coingecko.com/coins/images/24478/thumb/pepe.png',
          small: 'https://assets.coingecko.com/coins/images/24478/small/pepe.png',
          data: {
            price: 0.0000112,
            price_change_percentage_24h: { usd: 12.34, btc: 11.9 },
          },
        },
      },
    ],
  };

  describe('GET /api/trending', () => {
    it('revalidates every 300 seconds', () => {
      expect(revalidate).toBe(300);
    });

    it('returns TrendingCoin[] flattened from the nested item.data payload', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(upstream)));

      const res = await GET();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        {
          id: 'pepe',
          symbol: 'pepe',
          name: 'Pepe',
          image: 'https://assets.coingecko.com/coins/images/24478/small/pepe.png',
          rank: 42,
          price: 0.0000112,
          change24h: 12.34,
        },
      ]);
    });

    it('returns 502 {error:"upstream"} when CoinGecko fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      const res = await GET();

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'upstream' });
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**

  ```bash
  npx vitest run app/api/trending/route.test.ts
  ```

  Expected: FAIL — suite errors with `Failed to resolve import "./route"` (the route file does not exist yet).

- [ ] **Step 3: Implement `app/api/trending/route.ts`.** Full contents below. The `item.data` flattening itself lives in `fetchTrending` (Task 11, `lib/coingecko.ts`); the route's job is the 300s ISR window and the shared `502 {error:'upstream'}` failure shape.

  ```ts
  // app/api/trending/route.ts
  import { fetchTrending } from '@/lib/coingecko';

  export const revalidate = 300;

  export async function GET(): Promise<Response> {
    try {
      return Response.json(await fetchTrending());
    } catch {
      return Response.json({ error: 'upstream' }, { status: 502 });
    }
  }
  ```

- [ ] **Step 4: Run the test again and watch it pass.**

  ```bash
  npx vitest run app/api/trending/route.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 5: Verify types and the full suite.**

  ```bash
  npx tsc --noEmit && npx vitest run
  ```

  Expected: `tsc` prints nothing; vitest reports all test files passed (every suite from Tasks 1–12 green, 0 failures).

- [ ] **Step 6: Optional live smoke check (requires internet; skip if offline).** Start the dev server and hit the route once, then stop the server:

  ```bash
  npm run dev
  # in a second terminal:
  curl -s http://localhost:3000/api/trending | head -c 300
  ```

  Expected: a JSON array of objects each with exactly `id`, `symbol` (lowercase), `name`, `image`, `rank`, `price`, `change24h` — e.g. `[{"id":"...","symbol":"...","name":"...","image":"https://...","rank":...,"price":...,"change24h":...}` — and no nested `item`/`data` keys. Stop the dev server (Ctrl+C) afterwards.

### Task 13: PriceCell (flash animation), Sparkline, EmptyState, useNow hook

**Files:**
- Modify: `app/globals.css` (append flash keyframes)
- Create: `hooks/use-now.ts`
- Create: `components/PriceCell.tsx`
- Create: `components/Sparkline.tsx`
- Create: `components/EmptyState.tsx`
- Create: `app/dev-preview/page.tsx` (temporary visual harness — deleted at the end of Task 16)

- [ ] **Step 1: Append the flash keyframes to `app/globals.css`**

  Add the following block to the **end** of `app/globals.css` (below the `@theme` block and base styles created in Task 1). Do not change anything already in the file:

  ```css
  /* Price flash animation (used by components/PriceCell.tsx) */
  @keyframes flash-up {
    from {
      color: var(--color-up);
      background-color: rgba(14, 203, 129, 0.16);
    }
    to {
      color: var(--color-text);
      background-color: transparent;
    }
  }

  @keyframes flash-down {
    from {
      color: var(--color-down);
      background-color: rgba(246, 70, 93, 0.16);
    }
    to {
      color: var(--color-text);
      background-color: transparent;
    }
  }

  .animate-flash-up {
    animation: flash-up 0.7s ease-out;
  }

  .animate-flash-down {
    animation: flash-down 0.7s ease-out;
  }
  ```

- [ ] **Step 2: Create `hooks/use-now.ts`**

  ```ts
  'use client';

  import { useEffect, useState } from 'react';

  /** Returns Date.now(), re-rendering the caller every `intervalMs` milliseconds. */
  export function useNow(intervalMs: number): number {
    const [now, setNow] = useState<number>(() => Date.now());

    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), intervalMs);
      return () => clearInterval(id);
    }, [intervalMs]);

    return now;
  }
  ```

- [ ] **Step 3: Create `components/PriceCell.tsx`**

  Flash direction: compares `value` against `prev` when given, otherwise against the previously rendered `value` (tracked in a ref). The `key` bump forces a remount of the `<span>` so the CSS animation restarts even when two consecutive ticks move the same direction.

  ```tsx
  'use client';

  import { useEffect, useRef, useState } from 'react';
  import { formatPrice } from '@/lib/format';

  export function PriceCell({
    value,
    prev,
    stale,
  }: {
    value: number;
    prev?: number;
    stale?: boolean;
  }) {
    const lastValue = useRef(value);
    const [flash, setFlash] = useState<{ dir: 'up' | 'down'; key: number } | null>(null);

    useEffect(() => {
      const reference = prev !== undefined ? prev : lastValue.current;
      if (value > reference) {
        setFlash((f) => ({ dir: 'up', key: (f?.key ?? 0) + 1 }));
      } else if (value < reference) {
        setFlash((f) => ({ dir: 'down', key: (f?.key ?? 0) + 1 }));
      }
      lastValue.current = value;
    }, [value, prev]);

    return (
      <span
        key={flash?.key ?? 0}
        className={[
          'rounded-sm px-1 tabular-nums',
          flash?.dir === 'up' ? 'animate-flash-up' : '',
          flash?.dir === 'down' ? 'animate-flash-down' : '',
          stale ? 'opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {formatPrice(value)}
      </span>
    );
  }
  ```

- [ ] **Step 4: Create `components/Sparkline.tsx`**

  ```tsx
  const W = 120;
  const H = 36;
  const PAD = 2;

  export function Sparkline({ data, className }: { data: number[]; className?: string }) {
    if (data.length < 2) {
      // keep layout height stable for coins without sparkline data
      return <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true" />;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data
      .map((v, i) => {
        const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
        const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    const up = data[data.length - 1] >= data[0];

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
        <polyline
          points={points}
          fill="none"
          stroke={up ? 'var(--color-up)' : 'var(--color-down)'}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  ```

- [ ] **Step 5: Create `components/EmptyState.tsx`**

  ```tsx
  import Link from 'next/link';

  export function EmptyState({
    title,
    body,
    href,
    linkText,
  }: {
    title: string;
    body: string;
    href: string;
    linkText: string;
  }) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-panel px-6 py-16 text-center">
        <p className="text-lg font-semibold text-text">{title}</p>
        <p className="max-w-md text-sm text-muted">{body}</p>
        <Link
          href={href}
          className="mt-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
        >
          {linkText}
        </Link>
      </div>
    );
  }
  ```

- [ ] **Step 6: Type-check and lint**

  Run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  Run:
  ```bash
  npm run lint
  ```
  Expected: completes with exit code 0 and reports no errors.

- [ ] **Step 7: Create the temporary preview harness `app/dev-preview/page.tsx`**

  This page exists only so Tasks 13–16 can be verified visually before the real pages exist (Tasks 17–21). It is rewritten by Tasks 14–16 and deleted at the end of Task 16.

  ```tsx
  'use client';

  import { useEffect, useState } from 'react';
  import { PriceCell } from '@/components/PriceCell';
  import { Sparkline } from '@/components/Sparkline';
  import { EmptyState } from '@/components/EmptyState';
  import { useNow } from '@/hooks/use-now';

  export default function DevPreview() {
    const [price, setPrice] = useState(67241.5);
    const now = useNow(1000);

    useEffect(() => {
      const id = setInterval(() => {
        setPrice((p) => p * (1 + (Math.random() - 0.5) * 0.004));
      }, 1000);
      return () => clearInterval(id);
    }, []);

    return (
      <main className="min-h-screen space-y-8 bg-bg p-8 text-text">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            PriceCell (left: live, right: stale)
          </h2>
          <div className="flex gap-8 text-lg">
            <PriceCell value={price} />
            <PriceCell value={price} stale />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Sparkline (up / down)
          </h2>
          <div className="flex gap-8">
            <Sparkline data={[1, 3, 2, 5, 4, 8]} className="h-9 w-[120px]" />
            <Sparkline data={[8, 5, 6, 3, 4, 1]} className="h-9 w-[120px]" />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            useNow (ticks every second)
          </h2>
          <p className="tabular-nums text-sm text-muted">{new Date(now).toLocaleTimeString()}</p>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            EmptyState
          </h2>
          <EmptyState
            title="No coins yet"
            body="Star coins on the Markets page to build your watchlist."
            href="/"
            linkText="Browse markets"
          />
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 8: Visual check**

  Run `npm run dev` and open `http://localhost:3000/dev-preview`. You should see, on the dark `#0b0e11` background:
  - The left price flashes green or red roughly **every second** (brief colored text + tinted background that fades over ~0.7s), rendered in tabular figures like `67,241.50`. The right copy does the same but at 50% opacity (stale).
  - Two sparklines: the first stroked green (ends higher than it starts), the second red.
  - A clock line updating every second (proves `useNow` re-renders).
  - An EmptyState card: panel background, title, muted body text, and a yellow "Browse markets" button that navigates to `/` when clicked.

  Stop the dev server when done.

### Task 14: ConnectionBadge, GeoBanner, TrendingStrip

**Files:**
- Create: `components/ConnectionBadge.tsx`
- Create: `components/GeoBanner.tsx`
- Create: `components/TrendingStrip.tsx`
- Modify: `app/dev-preview/page.tsx` (temporary harness)

- [ ] **Step 1: Create `components/ConnectionBadge.tsx`**

  ```tsx
  'use client';

  import { useMarket } from '@/stores/market';
  import type { ConnectionStatus } from '@/lib/types';

  const CONFIG: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
    connecting: { label: 'Connecting', dot: 'bg-muted animate-pulse', text: 'text-muted' },
    streaming: { label: '⚡ Live', dot: 'bg-up', text: 'text-up' },
    reconnecting: { label: 'Reconnecting', dot: 'bg-accent animate-pulse', text: 'text-accent' },
    polling: { label: 'Polling', dot: 'bg-muted', text: 'text-muted' },
  };

  export function ConnectionBadge() {
    const status = useMarket((s) => s.status);
    const { label, dot, text } = CONFIG[status];

    return (
      <span
        title={`Connection status: ${status}`}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-medium ${text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    );
  }
  ```

- [ ] **Step 2: Create `components/GeoBanner.tsx`**

  Self-conditional: renders `null` unless the store status is `'polling'`, so it can be mounted unconditionally. Note: the banner is mounted **globally** in `app/layout.tsx` (Task 17, just below the header) so it shows on every page during polling — individual pages do not mount it themselves. The dev-preview harness below mounts it directly only because the layout does not exist yet.

  ```tsx
  'use client';

  import { useMarket } from '@/stores/market';

  export function GeoBanner() {
    const status = useMarket((s) => s.status);
    if (status !== 'polling') return null;

    return (
      <div
        role="status"
        className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"
      >
        Live streaming unavailable — prices refresh every 30s
      </div>
    );
  }
  ```

- [ ] **Step 3: Create `components/TrendingStrip.tsx`**

  Hides itself entirely when trending data is unavailable (spec §6: strip hides on hard failure). Cards navigate to the coin page; symbols are lowercased for the route.

  ```tsx
  'use client';

  import { useRouter } from 'next/navigation';
  import { useMarket } from '@/stores/market';
  import { formatPercent, formatUsd } from '@/lib/format';

  export function TrendingStrip() {
    const trending = useMarket((s) => s.trending);
    const router = useRouter();

    if (trending.length === 0) return null;

    return (
      <section aria-label="Trending coins">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          🔥 Trending
        </h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {trending.map((coin) => (
            <button
              key={coin.id}
              type="button"
              onClick={() => router.push(`/coin/${coin.symbol.toLowerCase()}`)}
              className="flex min-w-[150px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-panel px-3 py-2 text-left hover:bg-panel2"
            >
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coin.image}
                  alt=""
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] rounded-full"
                />
                <span className="text-sm font-semibold uppercase text-text">{coin.symbol}</span>
                {coin.rank !== null && (
                  <span className="text-[10px] text-muted">#{coin.rank}</span>
                )}
              </span>
              <span className="text-sm tabular-nums text-text">{formatUsd(coin.price)}</span>
              <span
                className={`text-xs tabular-nums ${
                  coin.change24h >= 0 ? 'text-up' : 'text-down'
                }`}
              >
                {formatPercent(coin.change24h)}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 4: Type-check and lint**

  Run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  Run:
  ```bash
  npm run lint
  ```
  Expected: completes with exit code 0 and reports no errors.

- [ ] **Step 5: Rewrite `app/dev-preview/page.tsx` to exercise these components**

  Replace the entire file with:

  ```tsx
  'use client';

  import { MarketFeedProvider } from '@/components/MarketFeedProvider';
  import { ConnectionBadge } from '@/components/ConnectionBadge';
  import { GeoBanner } from '@/components/GeoBanner';
  import { TrendingStrip } from '@/components/TrendingStrip';

  export default function DevPreview() {
    return (
      <main className="min-h-screen space-y-6 bg-bg p-8 text-text">
        <MarketFeedProvider />
        <section className="flex items-center gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            ConnectionBadge
          </h2>
          <ConnectionBadge />
        </section>
        <GeoBanner />
        <TrendingStrip />
      </main>
    );
  }
  ```

- [ ] **Step 6: Visual check**

  Run `npm run dev` and open `http://localhost:3000/dev-preview`. You should see:
  - The badge shows **"Connecting"** briefly, then **"⚡ Live"** with a green dot within a few seconds (WebSocket open). No GeoBanner visible.
  - The 🔥 Trending strip renders up to 15 compact cards (logo, SYMBOL, rank, price, signed colored 24h %) that scroll horizontally (drag/shift-scroll on desktop). Clicking a card changes the URL to `/coin/<symbol>` — a 404 page is **expected** until Task 19 builds that route; press Back to return.

  Then open `http://localhost:3000/dev-preview?polling=1`. You should see:
  - The badge shows **"Polling"** with a gray dot.
  - The slim amber GeoBanner appears: "Live streaming unavailable — prices refresh every 30s".

  Stop the dev server when done.

### Task 15: MarketsTable

**Files:**
- Create: `components/MarketsTable.tsx`
- Modify: `app/dev-preview/page.tsx` (temporary harness)

- [ ] **Step 1: Create `components/MarketsTable.tsx`**

  Joins `useMarket` coins + tickers + pairs: each coin resolves its market-data-source pair via `pairFor(coin.symbol, pairs)`; when a live ticker exists it overrides price / 24h % / volume, otherwise CoinGecko values render (unmapped coins are first-class). Staleness: prices gray at 50% opacity when the last WS message is older than 60s **and** status is not `'polling'` (polling data is refreshed on its own 30s cadence and must not gray). Row click navigates; the star button stops propagation so it never navigates. The `hydrated` flag defers starred-state rendering until after mount to avoid a hydration mismatch with the persisted watchlist store.

  CoinGecko-outage fallback: when `marketsError` is true and `coins` is still empty, the table synthesizes market-data-source-only rows from the live `tickers` map — USDT-quoted pairs that exist in `pairs`, sorted by `volume24h` descending, top 50, symbol = pair with the `USDT` suffix stripped then lowercased, name = symbol uppercased, no logo/rank/sparkline — plus a slim notice ("Coin metadata unavailable — showing live market-data-source data only") and a Retry button that calls `refreshMarkets()` from `@/hooks/use-market-feed` to re-trigger the markets fetch.

  ```tsx
  'use client';

  import { useEffect, useState } from 'react';
  import { useRouter } from 'next/navigation';
  import { useMarket } from '@/stores/market';
  import { useWatchlist } from '@/stores/watchlist';
  import { refreshMarkets } from '@/hooks/use-market-feed';
  import { useNow } from '@/hooks/use-now';
  import { pairFor } from '@/lib/symbol-map';
  import { PriceCell } from '@/components/PriceCell';
  import { Sparkline } from '@/components/Sparkline';
  import { formatCompact, formatPercent } from '@/lib/format';

  export function MarketsTable() {
    const coins = useMarket((s) => s.coins);
    const tickers = useMarket((s) => s.tickers);
    const pairs = useMarket((s) => s.pairs);
    const status = useMarket((s) => s.status);
    const lastMessageAt = useMarket((s) => s.lastMessageAt);
    const marketsError = useMarket((s) => s.marketsError);
    const ids = useWatchlist((s) => s.ids);
    const toggle = useWatchlist((s) => s.toggle);
    const router = useRouter();
    const now = useNow(5000);

    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);

    const stale =
      status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;

    if (coins.length === 0) {
      if (!marketsError) {
        return (
          <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-muted">
            Loading markets…
          </div>
        );
      }

      // CoinGecko outage → synthesize market-data-source-only rows from the live tickers map.
      const fallbackRows = Object.values(tickers)
        .filter((t) => t.pair.endsWith('USDT') && pairs.has(t.pair))
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 50)
        .map((t) => {
          const symbol = t.pair.slice(0, -4).toLowerCase(); // strip "USDT"
          return { ...t, symbol, name: symbol.toUpperCase() };
        });

      return (
        <div className="space-y-3">
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"
          >
            <span>Coin metadata unavailable — showing live market-data-source data only</span>
            <button
              type="button"
              onClick={() => void refreshMarkets()}
              className="shrink-0 cursor-pointer rounded border border-accent/40 px-2 py-1 font-medium transition-colors hover:bg-accent/20"
            >
              Retry
            </button>
          </div>
          {fallbackRows.length === 0 ? (
            <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-muted">
              Waiting for live market-data-source data…
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-panel">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    <th className="px-2 py-2 text-right">24h %</th>
                    <th className="px-2 py-2 text-right">24h Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {fallbackRows.map((row) => {
                    const change =
                      row.open24h > 0
                        ? ((row.price - row.open24h) / row.open24h) * 100
                        : 0;
                    return (
                      <tr
                        key={row.pair}
                        className="border-b border-border/50 last:border-b-0"
                      >
                        <td className="px-2 py-2">
                          <span className="font-medium text-text">{row.name}</span>{' '}
                          <span className="text-xs uppercase text-muted">
                            {row.symbol}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <PriceCell value={row.price} stale={stale} />
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${
                            change >= 0 ? 'text-up' : 'text-down'
                          } ${stale ? 'opacity-50' : ''}`}
                        >
                          {formatPercent(change)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted">
                          {formatCompact(row.volume24h)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
              <th className="w-8 px-2 py-2" aria-label="Watchlist" />
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">24h %</th>
              <th className="px-2 py-2 text-right">24h Volume</th>
              <th className="px-2 py-2 text-right">Market Cap</th>
              <th className="px-2 py-2 text-right">7d</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((coin) => {
              const pair = pairFor(coin.symbol, pairs);
              const ticker = pair ? tickers[pair] : undefined;
              const price = ticker?.price ?? coin.price;
              const change =
                ticker && ticker.open24h > 0
                  ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
                  : coin.change24h;
              const volume = ticker?.volume24h ?? coin.volume24h;
              const starred = hydrated && ids.includes(coin.id);

              return (
                <tr
                  key={coin.id}
                  onClick={() => router.push(`/coin/${coin.symbol}`)}
                  className="cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-panel2"
                >
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={
                        starred
                          ? `Remove ${coin.name} from watchlist`
                          : `Add ${coin.name} to watchlist`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(coin.id);
                      }}
                      className={`cursor-pointer text-base leading-none ${
                        starred ? 'text-accent' : 'text-muted hover:text-accent'
                      }`}
                    >
                      {starred ? '★' : '☆'}
                    </button>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-muted">{coin.rank}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={coin.image}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 rounded-full"
                      />
                      <span className="font-medium text-text">{coin.name}</span>
                      <span className="text-xs uppercase text-muted">{coin.symbol}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <PriceCell value={price} stale={stale} />
                  </td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums ${
                      change >= 0 ? 'text-up' : 'text-down'
                    } ${stale ? 'opacity-50' : ''}`}
                  >
                    {formatPercent(change)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {formatCompact(volume)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {formatCompact(coin.marketCap)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end">
                      <Sparkline data={coin.sparkline7d} className="h-9 w-[120px]" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  ```

- [ ] **Step 2: Type-check and lint**

  Run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  Run:
  ```bash
  npm run lint
  ```
  Expected: completes with exit code 0 and reports no errors.

- [ ] **Step 3: Rewrite `app/dev-preview/page.tsx` to exercise the table**

  Replace the entire file with:

  ```tsx
  'use client';

  import { MarketFeedProvider } from '@/components/MarketFeedProvider';
  import { ConnectionBadge } from '@/components/ConnectionBadge';
  import { GeoBanner } from '@/components/GeoBanner';
  import { MarketsTable } from '@/components/MarketsTable';

  export default function DevPreview() {
    return (
      <main className="min-h-screen space-y-4 bg-bg p-8 text-text">
        <MarketFeedProvider />
        <div className="flex justify-end">
          <ConnectionBadge />
        </div>
        <GeoBanner />
        <MarketsTable />
      </main>
    );
  }
  ```

- [ ] **Step 4: Visual check**

  Run `npm run dev` and open `http://localhost:3000/dev-preview`. You should see:
  - A dense, market-style dark table with 50 rows: star, rank, logo + name + SYMBOL, price, colored 24h %, compact volume ("28.1B"), compact market cap, and a green/red 7-day sparkline per row. All numbers in tabular figures, right-aligned.
  - Once the badge reads "⚡ Live", **price cells flash green/red within a few seconds** as ticks arrive (BTC/ETH rows flash almost continuously).
  - Clicking a star turns it yellow-filled (★) **without navigating**; clicking it again empties it. Reload the page — starred rows persist (localStorage).
  - Clicking anywhere else on a row changes the URL to `/coin/<symbol>` (e.g. `/coin/btc`) — a 404 is **expected** until Task 19; press Back.
  - Staleness spot-check (optional): in DevTools → Network, set throttling to "Offline" and wait ~60–70 seconds. The badge shows "Reconnecting" and all price and 24h % cells dim to 50% opacity. Restore "No throttling" — prices resume flashing and the dimming clears.
  - CoinGecko-outage fallback spot-check (optional): in DevTools → Network, add a request-blocking rule for `*/api/markets*` and reload. The amber notice "Coin metadata unavailable — showing live market-data-source data only" appears above a slim market-data-source-only table (SYMBOL name, live flashing price, 24h %, volume — no logos, ranks, or sparklines), sorted by volume with BTC/ETH near the top. Remove the blocking rule and click **Retry** — the full 50-row table with logos returns.

  Stop the dev server when done.

### Task 16: CommandPalette (⌘K) and ResetDialog

**Files:**
- Create: `components/CommandPalette.tsx`
- Create: `components/ResetDialog.tsx`
- Modify: `app/dev-preview/page.tsx` (temporary harness)
- Delete: `app/dev-preview/` (final step — harness no longer needed)

- [ ] **Step 1: Create `components/CommandPalette.tsx`**

  Global ⌘K (macOS) / Ctrl+K (Windows/Linux) keydown listener toggles the palette; Escape closes it. Filters `useMarket().coins` by name or symbol substring; ArrowUp/ArrowDown move the highlight; Enter (or click) does `router.push('/coin/<symbol>')` and closes.

  ```tsx
  'use client';

  import { useEffect, useMemo, useRef, useState } from 'react';
  import { useRouter } from 'next/navigation';
  import { useMarket } from '@/stores/market';
  import { formatPercent, formatUsd } from '@/lib/format';

  export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const coins = useMarket((s) => s.coins);
    const router = useRouter();

    useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setOpen((o) => !o);
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      }
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
      if (open) {
        setQuery('');
        setActive(0);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [open]);

    const results = useMemo(() => {
      const q = query.trim().toLowerCase();
      const list = q
        ? coins.filter(
            (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q),
          )
        : coins;
      return list.slice(0, 8);
    }, [coins, query]);

    function select(index: number) {
      const coin = results[index];
      if (!coin) return;
      setOpen(false);
      router.push(`/coin/${coin.symbol}`);
    }

    function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        select(active);
      }
    }

    if (!open) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
        onClick={() => setOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search coins"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search coins by name or symbol…"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-muted"
          />
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">No coins match “{query}”</li>
            )}
            {results.map((coin, i) => (
              <li key={coin.id}>
                <button
                  type="button"
                  onClick={() => select(i)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm ${
                    i === active ? 'bg-panel2' : ''
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coin.image}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 rounded-full"
                  />
                  <span className="font-medium text-text">{coin.name}</span>
                  <span className="text-xs uppercase text-muted">{coin.symbol}</span>
                  <span className="ml-auto tabular-nums text-muted">
                    {formatUsd(coin.price)}
                  </span>
                  <span
                    className={`w-16 text-right text-xs tabular-nums ${
                      coin.change24h >= 0 ? 'text-up' : 'text-down'
                    }`}
                  >
                    {formatPercent(coin.change24h)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-4 py-2 text-[10px] text-muted">
            ↑↓ navigate · Enter open · Esc close
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Create `components/ResetDialog.tsx`**

  Controlled confirm dialog; the caller (portfolio page, Task 21) wires `onConfirm` to `usePortfolio().reset()`. Overlay click and Escape both call `onClose`.

  ```tsx
  'use client';

  import { useEffect } from 'react';

  export function ResetDialog({
    open,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }) {
    useEffect(() => {
      if (!open) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reset-dialog-title"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-lg border border-border bg-panel p-6"
        >
          <h2 id="reset-dialog-title" className="text-base font-semibold text-text">
            Reset demo portfolio?
          </h2>
          <p className="mt-2 text-sm text-muted">
            This restores your $100,000 demo balance and clears all holdings and trade
            history. Your watchlist is not affected.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded border border-border px-4 py-2 text-sm text-text hover:bg-panel2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="cursor-pointer rounded bg-down px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Reset demo
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3: Type-check and lint**

  Run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  Run:
  ```bash
  npm run lint
  ```
  Expected: completes with exit code 0 and reports no errors.

- [ ] **Step 4: Rewrite `app/dev-preview/page.tsx` to exercise both components**

  Replace the entire file with:

  ```tsx
  'use client';

  import { useState } from 'react';
  import { MarketFeedProvider } from '@/components/MarketFeedProvider';
  import { CommandPalette } from '@/components/CommandPalette';
  import { ResetDialog } from '@/components/ResetDialog';
  import { usePortfolio } from '@/stores/portfolio';
  import { formatUsd } from '@/lib/format';

  export default function DevPreview() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const cash = usePortfolio((s) => s.cash);
    const reset = usePortfolio((s) => s.reset);

    return (
      <main className="min-h-screen space-y-8 bg-bg p-8 text-text">
        <MarketFeedProvider />
        <CommandPalette />

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            CommandPalette
          </h2>
          <p className="text-sm text-muted">
            Press ⌘K (macOS) or Ctrl+K (Windows/Linux) to open the search palette.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            ResetDialog
          </h2>
          <p className="mb-2 text-sm tabular-nums">Cash: {formatUsd(cash)}</p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="cursor-pointer rounded border border-border bg-panel px-4 py-2 text-sm hover:bg-panel2"
          >
            Open reset dialog
          </button>
          <ResetDialog
            open={dialogOpen}
            onConfirm={() => {
              reset();
              setDialogOpen(false);
            }}
            onClose={() => setDialogOpen(false)}
          />
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 5: Visual check**

  Run `npm run dev` and open `http://localhost:3000/dev-preview`. You should see:
  - Press **⌘K** (or **Ctrl+K**): a centered dark palette opens over a dimmed backdrop with the search input focused, listing the top 8 coins with logo, name, symbol, price, and colored 24h %. Type `sol` → the list narrows to Solana (and any other match). Press ↓/↑ — the highlight moves. Press **Enter** — the palette closes and the URL changes to `/coin/sol` (404 **expected** until Task 19; press Back). Press ⌘K/Ctrl+K again then **Esc** — it closes. Clicking the backdrop also closes it.
  - Click "Open reset dialog": a modal appears with the $100,000 reset copy. "Cancel", Escape, and the backdrop each close it without changes. "Reset demo" (red) closes it and the Cash line shows `$100,000.00`.

  Stop the dev server when done.

- [ ] **Step 6: Delete the temporary harness and re-verify**

  Run:
  ```bash
  rm -rf app/dev-preview
  ```

  Then run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output, exit code 0 (nothing references the harness).

  Run:
  ```bash
  npm run lint
  ```
  Expected: completes with exit code 0 and reports no errors.

### Task 17: App shell — `app/layout.tsx` + `HeaderBalance`

**Files:**
- Create: `components/HeaderBalance.tsx`
- Modify: `app/layout.tsx` (replace the create-next-app scaffold entirely)

- [ ] **Step 1: Create `components/HeaderBalance.tsx`** — client chip showing demo cash from the persisted portfolio store. It renders a placeholder until after mount so SSR markup never disagrees with rehydrated localStorage state.

  ```tsx
  'use client';

  import { useEffect, useState } from 'react';
  import { formatUsd } from '@/lib/format';
  import { usePortfolio } from '@/stores/portfolio';

  export function HeaderBalance() {
    const cash = usePortfolio((s) => s.cash);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    return (
      <span
        title="Demo cash balance"
        className="rounded-full border border-border bg-panel px-3 py-1 font-mono text-xs text-accent"
      >
        {mounted ? formatUsd(cash) : '—'}
      </span>
    );
  }
  ```

- [ ] **Step 2: Replace `app/layout.tsx`** — dark shell: sticky header (◆ RIVERFLOW logo, nav, ⌘K hint, `ConnectionBadge`, `HeaderBalance`), globally mounted `MarketFeedProvider` + `CommandPalette`, a globally mounted `GeoBanner` just below the header (self-hides unless status is `'polling'`, so the polling notice shows on **every** page), sonner `Toaster` (dark), footer with CoinGecko link, lightweight-charts attribution note, and the spec §8 disclaimer.

  ```tsx
  import type { Metadata } from 'next';
  import { Geist, Geist_Mono } from 'next/font/google';
  import Link from 'next/link';
  import { Toaster } from 'sonner';
  import { CommandPalette } from '@/components/CommandPalette';
  import { ConnectionBadge } from '@/components/ConnectionBadge';
  import { GeoBanner } from '@/components/GeoBanner';
  import { HeaderBalance } from '@/components/HeaderBalance';
  import { MarketFeedProvider } from '@/components/MarketFeedProvider';
  import './globals.css';

  const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
  const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

  export const metadata: Metadata = {
    title: 'Riverflow — Live Crypto Paper Trading',
    description:
      'Realtime crypto markets with a $100,000 paper-trading balance. Demo application — not financial advice.',
  };

  export default function RootLayout({
    children,
  }: Readonly<{ children: React.ReactNode }>) {
    return (
      <html lang="en" className="dark">
        <body
          className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-bg text-text antialiased`}
        >
          <MarketFeedProvider />
          <CommandPalette />
          <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
              <Link
                href="/"
                className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-widest"
              >
                <span className="text-accent">◆</span> RIVERFLOW
              </Link>
              <nav className="flex items-center gap-4 text-sm text-muted">
                <Link href="/" className="transition-colors hover:text-text">
                  Markets
                </Link>
                <Link href="/watchlist" className="transition-colors hover:text-text">
                  Watchlist
                </Link>
                <Link href="/portfolio" className="transition-colors hover:text-text">
                  Portfolio
                </Link>
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted sm:flex">
                  Search
                  <kbd className="rounded bg-panel2 px-1 font-mono">⌘K</kbd>
                </span>
                <ConnectionBadge />
                <HeaderBalance />
              </div>
            </div>
          </header>
          <main className="flex-1">
            <div className="mx-auto max-w-7xl px-4 pt-4 empty:hidden">
              <GeoBanner />
            </div>
            {children}
          </main>
          <footer className="border-t border-border py-6 text-center text-xs text-muted">
            <div className="mx-auto max-w-7xl space-y-2 px-4">
              <p>
                <a
                  href="https://www.coingecko.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline transition-colors hover:text-text"
                >
                  Powered by CoinGecko
                </a>
                {' · '}
                Charts by{' '}
                <a
                  href="https://www.lightweight-charts.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline transition-colors hover:text-text"
                >
                  lightweight-charts
                </a>{' '}
                lightweight-charts
              </p>
              <p>
                Demo application. Simulated trading with fictional funds — not
                financial advice.
              </p>
            </div>
          </footer>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1e2329',
                border: '1px solid #2b3139',
                color: '#eaecef',
              },
            }}
          />
        </body>
      </html>
    );
  }
  ```

- [ ] **Step 3: Type-check and lint**

  Run: `npx tsc --noEmit && npm run lint`
  Expected: both exit 0 — no type errors, no lint errors.

- [ ] **Step 4: Visual check**

  Run `npm run dev`, open `http://localhost:3000`:
  - Dark page (`#0b0e11` background), sticky header with "◆ RIVERFLOW" (◆ in gold), nav Markets · Watchlist · Portfolio.
  - Cash chip on the right reads `$100,000.00` (brief `—` flash on first paint is expected).
  - Connection badge appears and reaches the streaming state within a few seconds.
  - Press ⌘K (Ctrl+K on Windows/Linux) — the command palette opens on any page.
  - Footer shows the CoinGecko link, the lightweight-charts note, and the disclaimer sentence exactly as in spec §8.
  - Open `http://localhost:3000/?polling=1` — the slim amber GeoBanner ("Live streaming unavailable — prices refresh every 30s") appears just below the header, and it stays visible when you navigate to `/watchlist` and `/portfolio` (the banner is mounted globally in the layout).

  Feed wiring checks (deferred from Task 10 Step 12 — the provider is only now mounted):
  - The header badge reads "⚡ Live" (streaming), prices tick within ~3s of load, and DevTools → Network → WS shows one connection to `data-stream.market-data-source.vision` receiving `!miniTicker@arr` frames.
  - Load `http://localhost:3000/?polling=1` — no WebSocket opens (Network → WS is empty), and the Network tab shows `/api/markets` re-fetched every 30 seconds (the polling timer; the always-on 60s baseline refresh coincides with every second one, so an occasional doubled request is expected).
  - Stay on `http://localhost:3000` in streaming mode for two minutes without touching the tab — the Network tab still shows one `/api/markets` request per minute (the baseline refresh that keeps unmapped coins moving).
  - Switch to another tab for over a minute, then return — the badge cycles reconnecting → streaming without a reload (visibilitychange reconnect: a silent-but-open socket is dropped and replaced), and one `/api/markets` request fires immediately on return.

### Task 18: Markets page — `app/page.tsx`

**Files:**
- Modify: `app/page.tsx` (replace the create-next-app scaffold entirely)

- [ ] **Step 1: Replace `app/page.tsx`** — client page composing `TrendingStrip` + `MarketsTable`, with pulse skeletons while `useMarket().coins` is still empty (first paint before `/api/markets` resolves). The skeleton gate is `coins.length === 0 && !marketsError`: once `marketsError` flips true the wait is over — `/api/markets` failed with nothing cached — so the real components mount and `MarketsTable` renders its market-data-source-only fallback (notice + Retry, Task 15) instead of the page pulsing forever. `TrendingStrip` hides itself (renders `null`) when trending data never arrived, so no empty shell is left behind. The polling `GeoBanner` is NOT mounted here — Task 17's layout mounts it globally below the header so it shows on every page.

  ```tsx
  'use client';

  import { MarketsTable } from '@/components/MarketsTable';
  import { TrendingStrip } from '@/components/TrendingStrip';
  import { useMarket } from '@/stores/market';

  function TrendingSkeleton() {
    return (
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-20 w-40 shrink-0 animate-pulse rounded-lg bg-panel"
          />
        ))}
      </div>
    );
  }

  function TableSkeleton() {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse border-b border-border bg-panel last:border-0"
          />
        ))}
      </div>
    );
  }

  export default function MarketsPage() {
    const coins = useMarket((s) => s.coins);
    const marketsError = useMarket((s) => s.marketsError);
    // Skeletons only while we are still legitimately waiting. Once /api/markets has
    // failed with nothing cached, hand over to MarketsTable's market-data-source-only fallback.
    const loading = coins.length === 0 && !marketsError;

    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {loading ? (
          <>
            <TrendingSkeleton />
            <TableSkeleton />
          </>
        ) : (
          <>
            <TrendingStrip />
            <MarketsTable />
          </>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Type-check and lint**

  Run: `npx tsc --noEmit && npm run lint`
  Expected: both exit 0.

- [ ] **Step 3: Visual check**

  With `npm run dev` running, open `http://localhost:3000`:
  - Skeleton cards + rows flash briefly, then the trending strip (horizontal scroll) and the top-50 table render with logos, sparklines, and star buttons.
  - Price cells flash green/red as live ticks arrive (within ~3 s of load).
  - Open `http://localhost:3000/?polling=1` — the slim GeoBanner ("prices refresh every 30s", mounted globally by Task 17's layout) appears below the header, and the strip and table still render.
  - CoinGecko-outage check: in DevTools → Network add a request-blocking rule for `*/api/markets*` and reload. The skeletons must give way (not pulse forever) to `MarketsTable`'s amber "Coin metadata unavailable — showing live market-data-source data only" notice above the market-data-source-only rows; the trending strip is simply absent. Remove the rule, click **Retry** — the full table with logos and sparklines appears.

### Task 19: `CandleChart` + coin detail page

**Files:**
- Create: `components/CandleChart.tsx`
- Create: `app/coin/[symbol]/page.tsx`

- [ ] **Step 1: Create `components/CandleChart.tsx`** — lightweight-charts v5 candlestick chart: seeded from `fetchKlines`, grown live from the `<pair>@kline_<interval>` stream, timeframe buttons, ResizeObserver, lightweight-charts attribution logo, full cleanup (unsubscribe + `chart.remove()`), error state with Retry, and a Sparkline fallback when `pair === null`.

  ```tsx
  'use client';

  import { useEffect, useRef, useState } from 'react';
  import {
    CandlestickSeries,
    createChart,
    type UTCTimestamp,
  } from 'lightweight-charts';
  import { Sparkline } from '@/components/Sparkline';
  import { fetchKlines } from '@/lib/market-data/rest';
  import { wsManager } from '@/lib/market-data/ws-manager';
  import { useMarket } from '@/stores/market';

  const TIMEFRAMES = [
    { label: '1m', interval: '1m' },
    { label: '15m', interval: '15m' },
    { label: '1H', interval: '1h' },
    { label: '4H', interval: '4h' },
    { label: '1D', interval: '1d' },
  ] as const;

  type Interval = (typeof TIMEFRAMES)[number]['interval'];

  interface KlinePayload {
    k: { t: number; o: string; h: string; l: string; c: string };
  }

  export function CandleChart({
    pair,
    coinId,
  }: {
    pair: string | null;
    coinId: string;
  }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [tf, setTf] = useState<Interval>('1m');
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [retryKey, setRetryKey] = useState(0);
    const coin = useMarket((s) => s.coins.find((c) => c.id === coinId));

    useEffect(() => {
      const el = containerRef.current;
      if (!pair || !el) return;

      setStatus('loading');
      let disposed = false;
      let unsubscribe: (() => void) | null = null;

      const chart = createChart(el, {
        width: el.clientWidth,
        height: 420,
        layout: {
          background: { color: '#161a1e' },
          textColor: '#848e9c',
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: '#1e2329' },
          horzLines: { color: '#1e2329' },
        },
        rightPriceScale: { borderColor: '#2b3139' },
        timeScale: {
          borderColor: '#2b3139',
          timeVisible: true,
          secondsVisible: false,
        },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#0ecb81',
        downColor: '#f6465d',
        borderUpColor: '#0ecb81',
        borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81',
        wickDownColor: '#f6465d',
      });

      const resize = new ResizeObserver(() => {
        chart.applyOptions({ width: el.clientWidth });
      });
      resize.observe(el);

      fetchKlines(pair, tf, 500)
        .then((candles) => {
          if (disposed) return;
          series.setData(
            candles.map((c) => ({
              time: c.time as UTCTimestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            })),
          );
          chart.timeScale().fitContent();
          unsubscribe = wsManager.subscribe(
            `${pair.toLowerCase()}@kline_${tf}`,
            (data) => {
              const k = (data as KlinePayload).k;
              if (!k) return;
              series.update({
                time: (k.t / 1000) as UTCTimestamp,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
              });
            },
          );
          setStatus('ready');
        })
        .catch(() => {
          if (!disposed) setStatus('error');
        });

      return () => {
        disposed = true;
        unsubscribe?.();
        resize.disconnect();
        chart.remove();
      };
    }, [pair, tf, retryKey]);

    if (pair === null) {
      return (
        <div className="rounded-lg border border-border bg-panel p-6">
          <div className="flex h-[420px] flex-col items-center justify-center gap-4">
            {coin && coin.sparkline7d.length > 0 && (
              <Sparkline data={coin.sparkline7d} className="h-32 w-full max-w-xl" />
            )}
            <p className="text-sm text-muted">
              live chart unavailable for this coin
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-border bg-panel p-3">
        <div className="mb-3 flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.interval}
              onClick={() => setTf(t.interval)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                tf === t.interval
                  ? 'bg-panel2 text-text'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <div ref={containerRef} className="h-[420px] w-full" />
          {status === 'loading' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/70">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel/90">
              <p className="text-sm text-muted">Failed to load chart data</p>
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                className="rounded bg-panel2 px-4 py-1.5 text-sm text-text transition-colors hover:bg-border"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Create `app/coin/[symbol]/page.tsx`** — client page: resolves the coin from `useMarket` by the lowercase `symbol` route param, stats header (live price, 24h change/high/low/volume from the ticker with `CoinMarket` fallback, dimmed to 50% opacity when the last WS message is older than 60s and status is not `'polling'` — mirrors MarketsTable's staleness rule via `useNow`), `CandleChart`, plus loading, metadata-outage, and unknown-coin states. Ordering matters in the three empty-`coins` branches: this page is entirely metadata-driven (there is no market-data-source-only fallback for it), so when `marketsError` is true **and** `coins` is empty it renders "Coin metadata unavailable — try again" with a Retry button calling `refreshMarkets()` from `@/hooks/use-market-feed`; only a genuine still-loading state (no error yet) shows the pulse skeleton. The right-hand column is an **empty placeholder `<aside>`** — Task 20 builds `TradePanel` and replaces it; do NOT import `TradePanel` here (it does not exist yet, and this task must type-check standalone).

  ```tsx
  'use client';

  import { useParams } from 'next/navigation';
  import { CandleChart } from '@/components/CandleChart';
  import { EmptyState } from '@/components/EmptyState';
  import { refreshMarkets } from '@/hooks/use-market-feed';
  import { useNow } from '@/hooks/use-now';
  import { formatCompact, formatPercent, formatUsd } from '@/lib/format';
  import { pairFor } from '@/lib/symbol-map';
  import { useMarket } from '@/stores/market';

  function Stat({
    label,
    value,
    tone,
    dim,
  }: {
    label: string;
    value: string;
    tone?: 'up' | 'down';
    dim?: boolean;
  }) {
    return (
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p
          className={`font-mono text-sm ${
            tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
          } ${dim ? 'opacity-50' : ''}`}
        >
          {value}
        </p>
      </div>
    );
  }

  export default function CoinPage() {
    const params = useParams<{ symbol: string }>();
    const symbol = (params?.symbol ?? '').toLowerCase();
    const coins = useMarket((s) => s.coins);
    const pairs = useMarket((s) => s.pairs);
    const tickers = useMarket((s) => s.tickers);
    const status = useMarket((s) => s.status);
    const lastMessageAt = useMarket((s) => s.lastMessageAt);
    const marketsError = useMarket((s) => s.marketsError);
    const now = useNow(5000);

    // /api/markets failed with nothing cached: this page is metadata-driven, so there is
    // nothing to fall back to — say so and offer a retry rather than pulsing forever.
    if (coins.length === 0 && marketsError) {
      return (
        <div className="mx-auto max-w-7xl px-4 py-16">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-panel px-6 py-10 text-center">
            <p className="text-sm text-text">Coin metadata unavailable — try again</p>
            <p className="text-xs text-muted">
              Market data could not be loaded, so “{symbol.toUpperCase()}” cannot be resolved.
            </p>
            <button
              type="button"
              onClick={() => void refreshMarkets()}
              className="cursor-pointer rounded border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (coins.length === 0) {
      return (
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
          <div className="h-16 animate-pulse rounded-lg bg-panel" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
            <div className="h-[480px] animate-pulse rounded-lg bg-panel" />
          </div>
        </div>
      );
    }

    const coin = coins.find((c) => c.symbol === symbol);
    if (!coin) {
      return (
        <div className="mx-auto max-w-7xl px-4 py-16">
          <EmptyState
            title="Coin not found"
            body={`No coin with symbol "${symbol}" in the top 50.`}
            href="/"
            linkText="Back to Markets"
          />
        </div>
      );
    }

    const pair = pairFor(coin.symbol, pairs);
    const ticker = pair ? tickers[pair] : undefined;
    const price = ticker?.price ?? coin.price;
    const change =
      ticker && ticker.open24h > 0
        ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
        : coin.change24h;
    const high = ticker?.high24h;
    const low = ticker?.low24h;
    const volume = ticker?.volume24h ?? coin.volume24h;
    const stale =
      status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;

    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <header className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-panel px-4 py-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coin.image} alt="" className="h-8 w-8 rounded-full" />
            <div>
              <h1 className="font-semibold leading-tight">{coin.name}</h1>
              <p className="text-xs uppercase text-muted">
                {coin.symbol}/{pair ? 'USDT' : 'USD'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted">Price</p>
            <p
              className={`font-mono text-lg leading-tight ${
                change >= 0 ? 'text-up' : 'text-down'
              } ${stale ? 'opacity-50' : ''}`}
            >
              {formatUsd(price)}
            </p>
          </div>
          <Stat
            label="24h Change"
            value={formatPercent(change)}
            tone={change >= 0 ? 'up' : 'down'}
            dim={stale}
          />
          <Stat
            label="24h High"
            value={high !== undefined ? formatUsd(high) : '—'}
            dim={stale}
          />
          <Stat
            label="24h Low"
            value={low !== undefined ? formatUsd(low) : '—'}
            dim={stale}
          />
          <Stat label="24h Volume" value={`$${formatCompact(volume)}`} dim={stale} />
        </header>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <CandleChart pair={pair} coinId={coin.id} />
          {/* Placeholder — Task 20 replaces this with <TradePanel /> */}
          <aside className="h-fit min-h-[200px] rounded-lg border border-border bg-panel p-4" />
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3: Type-check and lint**

  Run: `npx tsc --noEmit && npm run lint`
  Expected: both exit 0 — this task is standalone (the coin page imports nothing from Task 20).

- [ ] **Step 4: Visual check**

  With `npm run dev` running:
  - `http://localhost:3000/coin/btc` — stats header shows live price/24h change/high/low/volume; candlestick chart renders ~500 green/red candles; the lightweight-charts attribution logo is visible in the chart's bottom-left corner; the last candle updates in place every second or two. The right-hand column is an empty bordered panel — `TradePanel` fills it in Task 20.
  - Click `15m`, `1H`, `4H`, `1D` — each reloads the chart at that timeframe (brief spinner, then candles).
  - Resize the window — the chart follows its container width.
  - Staleness spot-check (optional): DevTools → Network → "Offline" for ~60–70s — the header price and all four stats dim to 50% opacity (badge shows "Reconnecting"); restore "No throttling" and the dimming clears.
  - `http://localhost:3000/coin/usdt` — no candle chart; sparkline fallback with "live chart unavailable for this coin".
  - `http://localhost:3000/coin/zzz` — "Coin not found" empty state with a link back to Markets.
  - Metadata-outage check: in DevTools → Network add a request-blocking rule for `*/api/markets*` and reload `/coin/btc` — instead of an endless skeleton the page shows "Coin metadata unavailable — try again" with a Retry button. Remove the rule, click **Retry** — the full coin page renders.
  - In DevTools → Network, block `data-api.market-data-source-source.vision` and `api.market-data-source.com`, reload `/coin/btc` — error overlay with a working Retry button appears; the rest of the page still works.

### Task 20: `TradePanel`

**Files:**
- Create: `components/TradePanel.tsx`
- Modify: `app/coin/[symbol]/page.tsx` (replace Task 19's placeholder `<aside>` with `TradePanel`)

- [ ] **Step 1: Create `components/TradePanel.tsx`** — Buy/Sell tabs, amount in coin units, 25/50/75/100% quick buttons (buys sized from cash with fee headroom: `cash·pct / (price·(1+FEE_RATE))`; sells from held qty), USD preview with fee line, single action button (green BUY / red SELL) that shows the disable reason as its label when invalid, executes `usePortfolio.buy/sell` at `priceFor(coinId)`, sonner success/error toasts.

  ```tsx
  'use client';

  import { useState } from 'react';
  import { toast } from 'sonner';
  import { formatUsd } from '@/lib/format';
  import {
    FEE_RATE,
    InsufficientFundsError,
    InsufficientHoldingsError,
  } from '@/lib/trading';
  import { useMarket } from '@/stores/market';
  import { usePortfolio } from '@/stores/portfolio';

  const PERCENTS = [25, 50, 75, 100] as const;

  function trimQty(q: number): string {
    const floored = Math.floor(q * 1e8) / 1e8; // floor so rounding never exceeds funds
    return floored > 0 ? String(floored) : '';
  }

  export function TradePanel({
    coinId,
    symbol,
    name,
  }: {
    coinId: string;
    symbol: string;
    name: string;
  }) {
    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [amount, setAmount] = useState('');
    const cash = usePortfolio((s) => s.cash);
    const holdings = usePortfolio((s) => s.holdings);
    const buy = usePortfolio((s) => s.buy);
    const sell = usePortfolio((s) => s.sell);
    const priceFor = useMarket((s) => s.priceFor);
    useMarket((s) => s.tickers); // subscribe so the preview follows live ticks
    useMarket((s) => s.coins); //  and polling-mode price refreshes

    const ticker = symbol.toUpperCase();
    const price = priceFor(coinId);
    const heldQty = holdings.find((h) => h.coinId === coinId)?.qty ?? 0;
    const qty = Number.parseFloat(amount);
    const validQty = Number.isFinite(qty) && qty > 0;
    const notional = validQty && price !== undefined ? qty * price : 0;
    const fee = notional * FEE_RATE;
    const total = side === 'buy' ? notional + fee : notional - fee;

    let reason: string | null = null;
    if (price === undefined) reason = 'Price unavailable';
    else if (!validQty) reason = 'Enter an amount';
    else if (side === 'buy' && notional + fee > cash) reason = 'Insufficient cash';
    else if (side === 'sell' && qty > heldQty)
      reason = `Insufficient ${ticker} balance`;

    const setPercent = (pct: number) => {
      if (price === undefined || price <= 0) return;
      const q =
        side === 'buy'
          ? (cash * (pct / 100)) / (price * (1 + FEE_RATE))
          : heldQty * (pct / 100);
      setAmount(trimQty(q));
    };

    const submit = () => {
      if (reason !== null || price === undefined) return;
      try {
        if (side === 'buy') buy(coinId, symbol, qty, price);
        else sell(coinId, qty, price);
        toast.success(
          `Order filled — ${side === 'buy' ? 'bought' : 'sold'} ${amount} ${ticker} @ ${formatUsd(price)}`,
        );
        setAmount('');
      } catch (err) {
        if (err instanceof InsufficientFundsError)
          toast.error('Order rejected — insufficient cash');
        else if (err instanceof InsufficientHoldingsError)
          toast.error(`Order rejected — insufficient ${ticker} balance`);
        else toast.error('Order rejected');
      }
    };

    return (
      <aside className="h-fit rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold">Trade {name}</h2>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded bg-panel2 p-1 text-sm">
          <button
            onClick={() => setSide('buy')}
            className={`rounded py-1.5 font-medium transition-colors ${
              side === 'buy' ? 'bg-up text-black' : 'text-muted hover:text-text'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`rounded py-1.5 font-medium transition-colors ${
              side === 'sell' ? 'bg-down text-black' : 'text-muted hover:text-text'
            }`}
          >
            Sell
          </button>
        </div>
        <label className="mb-1 block text-xs text-muted" htmlFor="trade-amount">
          Amount ({ticker})
        </label>
        <input
          id="trade-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mb-2 w-full rounded border border-border bg-panel2 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <div className="mb-3 grid grid-cols-4 gap-1">
          {PERCENTS.map((p) => (
            <button
              key={p}
              onClick={() => setPercent(p)}
              className="rounded bg-panel2 py-1 text-xs text-muted transition-colors hover:text-text"
            >
              {p}%
            </button>
          ))}
        </div>
        <dl className="mb-3 space-y-1 text-xs text-muted">
          <div className="flex justify-between">
            <dt>{side === 'buy' ? 'Cost' : 'Value'}</dt>
            <dd className="font-mono text-text">≈ {formatUsd(notional)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Fee (0.1%)</dt>
            <dd className="font-mono text-text">{formatUsd(fee)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{side === 'buy' ? 'Total' : 'You receive'}</dt>
            <dd className="font-mono text-text">≈ {formatUsd(total)}</dd>
          </div>
        </dl>
        <button
          onClick={submit}
          disabled={reason !== null}
          className={`w-full rounded py-2.5 text-sm font-semibold text-black transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            side === 'buy'
              ? 'bg-up hover:brightness-110'
              : 'bg-down hover:brightness-110'
          }`}
        >
          {reason ?? `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}`}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted">
          {side === 'buy'
            ? `Available: ${formatUsd(cash)}`
            : `Available: ${heldQty.toLocaleString('en-US', {
                maximumFractionDigits: 8,
              })} ${ticker}`}
        </p>
      </aside>
    );
  }
  ```

- [ ] **Step 2: Wire `TradePanel` into the coin page** — edit `app/coin/[symbol]/page.tsx` (created in Task 19) to replace the placeholder.

  Add the import alongside the other component imports (alphabetical — after `EmptyState`):

  ```tsx
  import { TradePanel } from '@/components/TradePanel';
  ```

  Then replace exactly this placeholder block:

  ```tsx
          {/* Placeholder — Task 20 replaces this with <TradePanel /> */}
          <aside className="h-fit min-h-[200px] rounded-lg border border-border bg-panel p-4" />
  ```

  with:

  ```tsx
          <TradePanel coinId={coin.id} symbol={coin.symbol} name={coin.name} />
  ```

- [ ] **Step 3: Type-check and lint**

  Run: `npx tsc --noEmit && npm run lint`
  Expected: both exit 0.

- [ ] **Step 4: Visual check**

  With `npm run dev` running, open `http://localhost:3000/coin/btc` — the Trade panel now fills the right-hand column where Task 19's empty placeholder was:
  - With an empty amount, the action button is disabled and reads "Enter an amount".
  - Type `0.05` — Cost/Fee/Total preview lines populate and drift with live ticks; button reads "Buy BTC".
  - Click "Buy BTC" — green toast like `Order filled — bought 0.05 BTC @ $67,241.50`; header cash chip drops immediately.
  - Click `100%` on Buy, then bump the amount up slightly by typing — button becomes disabled "Insufficient cash".
  - Switch to Sell: `100%` fills the exact held qty; selling more than held disables with "Insufficient BTC balance"; a valid sell fires an "Order filled — sold …" toast and cash rises.
  - Sell side shows "Available: &lt;qty&gt; BTC"; Buy side shows "Available: $&lt;cash&gt;".

### Task 21: Watchlist + Portfolio pages

**Files:**
- Create: `app/watchlist/page.tsx`
- Create: `app/portfolio/page.tsx`

- [ ] **Step 1: Create `app/watchlist/page.tsx`** — starred coins as rows (logo, name/symbol, live `PriceCell` with flash + 60 s staleness graying via `useNow`, 24h %, 7-day `Sparkline`, ✕ remove that doesn't navigate), mounted-gate for localStorage hydration, spec empty state. Skeleton rows are shown only while metadata is genuinely still in flight: if there are starred ids, `coins` is empty **and** `marketsError` is true, the page renders a "Coin metadata unavailable — try again" row with a Retry button calling `refreshMarkets()` from `@/hooks/use-market-feed` (these rows are metadata-driven, so unlike the markets table there is no market-data-source-only fallback to show).

  ```tsx
  'use client';

  import { useEffect, useRef, useState } from 'react';
  import Link from 'next/link';
  import { EmptyState } from '@/components/EmptyState';
  import { PriceCell } from '@/components/PriceCell';
  import { Sparkline } from '@/components/Sparkline';
  import { refreshMarkets } from '@/hooks/use-market-feed';
  import { useNow } from '@/hooks/use-now';
  import { formatPercent } from '@/lib/format';
  import { pairFor } from '@/lib/symbol-map';
  import type { CoinMarket, LiveTicker } from '@/lib/types';
  import { useMarket } from '@/stores/market';
  import { useWatchlist } from '@/stores/watchlist';

  function usePrevious(value: number): number | undefined {
    const ref = useRef<number | undefined>(undefined);
    useEffect(() => {
      ref.current = value;
    }, [value]);
    return ref.current;
  }

  function WatchRow({
    coin,
    ticker,
    onRemove,
  }: {
    coin: CoinMarket;
    ticker: LiveTicker | undefined;
    onRemove: () => void;
  }) {
    const now = useNow(10_000);
    const price = ticker?.price ?? coin.price;
    const prev = usePrevious(price);
    const stale = ticker ? now - ticker.updatedAt > 60_000 : false;
    const change =
      ticker && ticker.open24h > 0
        ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
        : coin.change24h;

    return (
      <Link
        href={`/coin/${coin.symbol}`}
        className="grid grid-cols-[minmax(0,1fr)_auto_5rem_auto_auto] items-center gap-4 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-panel2"
      >
        <span className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coin.image} alt="" className="h-6 w-6 rounded-full" />
          <span className="truncate font-medium">{coin.name}</span>
          <span className="text-xs uppercase text-muted">{coin.symbol}</span>
        </span>
        <PriceCell value={price} prev={prev} stale={stale} />
        <span
          className={`text-right font-mono text-sm ${
            change >= 0 ? 'text-up' : 'text-down'
          }`}
        >
          {formatPercent(change)}
        </span>
        <Sparkline data={coin.sparkline7d} className="h-8 w-24" />
        <button
          aria-label={`Remove ${coin.name} from watchlist`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="rounded px-2 py-1 text-muted transition-colors hover:bg-panel hover:text-down"
        >
          ✕
        </button>
      </Link>
    );
  }

  export default function WatchlistPage() {
    const ids = useWatchlist((s) => s.ids);
    const toggle = useWatchlist((s) => s.toggle);
    const coins = useMarket((s) => s.coins);
    const tickers = useMarket((s) => s.tickers);
    const pairs = useMarket((s) => s.pairs);
    const marketsError = useMarket((s) => s.marketsError);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Starred rows need CoinGecko metadata (logo, name, sparkline). If /api/markets failed
    // with nothing cached there is nothing to wait for — offer a retry, not a forever pulse.
    if (mounted && ids.length > 0 && coins.length === 0 && marketsError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="mb-4 text-lg font-semibold">Watchlist</h1>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-4">
            <span className="text-sm text-text">Coin metadata unavailable — try again</span>
            <button
              type="button"
              onClick={() => void refreshMarkets()}
              className="cursor-pointer rounded border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!mounted || (ids.length > 0 && coins.length === 0)) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="mb-4 text-lg font-semibold">Watchlist</h1>
          <div className="overflow-hidden rounded-lg border border-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse border-b border-border bg-panel last:border-0"
              />
            ))}
          </div>
        </div>
      );
    }

    if (ids.length === 0) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-16">
          <EmptyState
            title="No coins yet"
            body="⭐ Star coins on the Markets page to track them here."
            href="/"
            linkText="Browse Markets"
          />
        </div>
      );
    }

    const rows = ids
      .map((id) => coins.find((c) => c.id === id))
      .filter((c): c is CoinMarket => c !== undefined);

    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold">Watchlist</h1>
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          {rows.map((coin) => {
            const pair = pairFor(coin.symbol, pairs);
            return (
              <WatchRow
                key={coin.id}
                coin={coin}
                ticker={pair ? tickers[pair] : undefined}
                onRemove={() => toggle(coin.id)}
              />
            );
          })}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Create `app/portfolio/page.tsx`** — summary bar (total value via `portfolioValue`, live P&L vs `INITIAL_CASH` baseline with sign coloring, cash), holdings table with live `unrealizedPnl`, trade history newest-first with formatted timestamps, `ResetDialog` wiring, spec empty state. Staleness: the holdings **Price** and **Unrealized P&L** cells dim to 50% opacity when the last WS message is older than 60s and status is not `'polling'` — the same rule as MarketsTable, via `useNow` + `lastMessageAt`.

  ```tsx
  'use client';

  import { useEffect, useState } from 'react';
  import { toast } from 'sonner';
  import { EmptyState } from '@/components/EmptyState';
  import { ResetDialog } from '@/components/ResetDialog';
  import { useNow } from '@/hooks/use-now';
  import { formatPercent, formatUsd } from '@/lib/format';
  import { INITIAL_CASH, portfolioValue, unrealizedPnl } from '@/lib/trading';
  import { useMarket } from '@/stores/market';
  import { usePortfolio } from '@/stores/portfolio';

  function formatQty(q: number): string {
    return q.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function signedUsd(n: number): string {
    return `${n >= 0 ? '+' : '-'}${formatUsd(Math.abs(n))}`;
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  export default function PortfolioPage() {
    const cash = usePortfolio((s) => s.cash);
    const holdings = usePortfolio((s) => s.holdings);
    const trades = usePortfolio((s) => s.trades);
    const reset = usePortfolio((s) => s.reset);
    const priceFor = useMarket((s) => s.priceFor);
    useMarket((s) => s.tickers); // subscribe: live ticks re-render P&L
    useMarket((s) => s.coins); //  subscribe: polling-mode refreshes too
    const status = useMarket((s) => s.status);
    const lastMessageAt = useMarket((s) => s.lastMessageAt);
    const now = useNow(5000);
    const [resetOpen, setResetOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) {
      return (
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
          <div className="h-24 animate-pulse rounded-lg bg-panel" />
          <div className="h-48 animate-pulse rounded-lg bg-panel" />
        </div>
      );
    }

    const totalValue = portfolioValue(cash, holdings, priceFor);
    const pnl = totalValue - INITIAL_CASH;
    const pnlPct = (pnl / INITIAL_CASH) * 100;
    const pnlTone = pnl >= 0 ? 'text-up' : 'text-down';
    const history = [...trades].sort((a, b) => b.timestamp - a.timestamp);
    const isEmpty = holdings.length === 0 && trades.length === 0;
    const stale =
      status !== 'polling' && lastMessageAt > 0 && now - lastMessageAt > 60_000;

    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Portfolio</h1>
          <button
            onClick={() => setResetOpen(true)}
            className="rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-down hover:text-down"
          >
            Reset demo
          </button>
        </div>

        <section className="grid gap-4 rounded-lg border border-border bg-panel p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Total Value</p>
            <p className="font-mono text-2xl">{formatUsd(totalValue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Total P&amp;L</p>
            <p className={`font-mono text-2xl ${pnlTone}`}>
              {signedUsd(pnl)} ({formatPercent(pnlPct)})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Cash</p>
            <p className="font-mono text-2xl">{formatUsd(cash)}</p>
          </div>
        </section>

        {isEmpty ? (
          <EmptyState
            title="You have $100,000 waiting"
            body="Make your first trade — fictional funds, live prices."
            href="/"
            linkText="Go to Markets"
          />
        ) : (
          <>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted">Holdings</h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-panel">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Avg Cost</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Unrealized P&amp;L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center text-muted"
                        >
                          No open positions
                        </td>
                      </tr>
                    ) : (
                      holdings.map((h) => {
                        const live = priceFor(h.coinId) ?? h.avgCost;
                        const pnlH = unrealizedPnl(h, live);
                        const cost = h.qty * h.avgCost;
                        const pnlHPct = cost > 0 ? (pnlH / cost) * 100 : 0;
                        return (
                          <tr
                            key={h.coinId}
                            className="border-b border-border last:border-0"
                          >
                            <td className="px-4 py-2 font-medium uppercase">
                              {h.symbol}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatQty(h.qty)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatUsd(h.avgCost)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-mono ${
                                stale ? 'opacity-50' : ''
                              }`}
                            >
                              {formatUsd(live)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatUsd(h.qty * live)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-mono ${
                                pnlH >= 0 ? 'text-up' : 'text-down'
                              } ${stale ? 'opacity-50' : ''}`}
                            >
                              {signedUsd(pnlH)} ({formatPercent(pnlHPct)})
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted">
                Trade History
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-panel">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Side</th>
                      <th className="px-4 py-2 font-medium">Coin</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2 text-right font-medium">Fee</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Realized P&amp;L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 text-muted">
                          {formatTime(t.timestamp)}
                        </td>
                        <td
                          className={`px-4 py-2 font-semibold uppercase ${
                            t.side === 'buy' ? 'text-up' : 'text-down'
                          }`}
                        >
                          {t.side}
                        </td>
                        <td className="px-4 py-2 uppercase">{t.symbol}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatQty(t.qty)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatUsd(t.price)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatUsd(t.fee)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono ${
                            t.realizedPnl === null
                              ? 'text-muted'
                              : t.realizedPnl >= 0
                                ? 'text-up'
                                : 'text-down'
                          }`}
                        >
                          {t.realizedPnl === null ? '—' : signedUsd(t.realizedPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <ResetDialog
          open={resetOpen}
          onConfirm={() => {
            reset();
            setResetOpen(false);
            toast.success('Demo reset — balance restored to $100,000');
          }}
          onClose={() => setResetOpen(false)}
        />
      </div>
    );
  }
  ```

- [ ] **Step 3: Type-check and lint**

  Run: `npx tsc --noEmit && npm run lint`
  Expected: both exit 0.

- [ ] **Step 4: Visual check**

  With `npm run dev` running:
  - Watchlist empty state: open `http://localhost:3000/watchlist` in a fresh profile/incognito window — "No coins yet" with the ⭐ hint and a "Browse Markets" link.
  - On Markets, star BTC and ETH, revisit `/watchlist` — two rows with logo, name, live-flashing price, colored 24h %, sparkline. Row click navigates to the coin page; ✕ removes the row without navigating. Reload — stars persist.
  - Watchlist metadata-outage check: with BTC and ETH starred, add a DevTools → Network request-blocking rule for `*/api/markets*` and reload `/watchlist` — the skeleton rows are replaced by "Coin metadata unavailable — try again" with a Retry button (no endless pulse). Remove the rule, click **Retry** — the starred rows come back.
  - Portfolio empty state: `/portfolio` before any trade — summary bar shows Total Value `$100,000.00`, P&L `+$0.00 (+0.00%)`, Cash `$100,000.00`, plus "You have $100,000 waiting" with a Markets link.
  - Buy 0.05 BTC on `/coin/btc`, return to `/portfolio` — holdings row (qty, avg cost, live price, value, unrealized P&L ticking green/red) and one BUY row in Trade History with a formatted timestamp and fee; summary P&L moves with the live price.
  - Sell part of the position — a SELL row appears at the TOP of history (newest first) with a colored Realized P&L value.
  - Staleness spot-check (optional): with a holding open on `/portfolio`, DevTools → Network → "Offline" for ~60–70s — the holdings Price and Unrealized P&L cells dim to 50% opacity (badge shows "Reconnecting"); restore "No throttling" and the dimming clears.
  - Click "Reset demo" → dialog opens → Cancel closes it unchanged → confirm resets cash to `$100,000.00`, clears holdings and history (watchlist rows remain), and shows the reset toast.

### Task 22: Playwright smoke test (fully mocked network)

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/smoke.spec.ts`

One end-to-end flow per spec §7: land on Markets → see prices → star a coin → open detail → buy → verify Portfolio and Watchlist. All network is mocked: `page.route` serves inline fixtures for `/api/markets` and `/api/trending` (the Next.js route handlers never execute, so CoinGecko is never called), both market-data-source REST hosts return an empty `exchangeInfo` (every coin is "unmapped" → no kline fetches, sparkline chart fallback, trades execute at the fixture price), and `?polling=1` forces polling mode so no WebSocket ever opens. This assumes the markup from earlier tasks: MarketsTable (Task 15) is a semantic `<table>` whose per-row star toggle is the row's only `<button>`, and TradePanel (Task 20) uses a `type="number"` amount input (ARIA role `spinbutton`) and a submit button whose accessible name is exactly "Buy BTC" once a valid amount is entered (the Buy/Sell **side tabs** are also buttons, so submit-button locators must use an exact-name match like `/^buy btc$/i`, never a loose `/buy/i`; the "Portfolio" and "Watchlist" link locators are unambiguous because those names appear only in the header nav). If a selector fails, debug with `npx playwright test --debug` and align the selector with the actual markup — the flow itself must not change.

- [ ] **Step 1: Create `playwright.config.ts`** — `webServer` boots `npm run dev` automatically; `testDir` is `e2e` so Vitest (include: `**/*.test.ts`) never picks these specs up:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Install the Chromium browser binary**

```bash
npx playwright install chromium
```

Expected: download progress lines ending in `Chromium <version> downloaded to …` (or no output at all if the binary is already cached — both are fine).

- [ ] **Step 3: Write `e2e/smoke.spec.ts`** — fixtures are defined inline in the test file; trending coins are deliberately disjoint from the markets coins so a text assertion on "Bitcoin" matches exactly one element on the Markets page:

```ts
import { test, expect } from '@playwright/test';
import type { CoinMarket, TrendingCoin } from '@/lib/types';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const marketsFixture: CoinMarket[] = [
  {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'https://example.com/btc.png',
    rank: 1,
    price: 100000,
    change24h: 2.5,
    volume24h: 30_000_000_000,
    marketCap: 2_000_000_000_000,
    sparkline7d: [95000, 96500, 97200, 98100, 99000, 99500, 100000],
  },
  {
    id: 'ethereum',
    symbol: 'eth',
    name: 'Ethereum',
    image: 'https://example.com/eth.png',
    rank: 2,
    price: 4000,
    change24h: -1.2,
    volume24h: 15_000_000_000,
    marketCap: 480_000_000_000,
    sparkline7d: [4100, 4080, 4050, 4020, 4010, 4005, 4000],
  },
  {
    id: 'solana',
    symbol: 'sol',
    name: 'Solana',
    image: 'https://example.com/sol.png',
    rank: 3,
    price: 200,
    change24h: 5.1,
    volume24h: 4_000_000_000,
    marketCap: 95_000_000_000,
    sparkline7d: [185, 188, 190, 193, 196, 198, 200],
  },
];

// Disjoint from marketsFixture so "Bitcoin" appears exactly once on the Markets page.
const trendingFixture: TrendingCoin[] = [
  { id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: 'https://example.com/doge.png', rank: 8, price: 0.32, change24h: 12.5 },
  { id: 'chainlink', symbol: 'link', name: 'Chainlink', image: 'https://example.com/link.png', rank: 12, price: 24.5, change24h: 3.1 },
  { id: 'pepe', symbol: 'pepe', name: 'Pepe', image: 'https://example.com/pepe.png', rank: 30, price: 0.000012, change24h: -4.2 },
];

test.beforeEach(async ({ page }) => {
  // App API proxies → inline fixtures. Intercepted in the browser, so the
  // Next.js route handlers (and therefore CoinGecko) are never hit.
  await page.route('**/api/markets', (route) => route.fulfill({ json: marketsFixture }));
  await page.route('**/api/trending', (route) => route.fulfill({ json: trendingFixture }));

  // market-data-source REST on both hosts → empty exchangeInfo: every coin is unmapped,
  // so no kline requests happen, the chart falls back to the sparkline, and
  // trades execute at the CoinGecko fixture price. ?polling=1 skips the WS.
  const emptyExchangeInfo = { symbols: [] };
  await page.route('https://data-api.market-data-source-source.vision/**', (route) => route.fulfill({ json: emptyExchangeInfo }));
  await page.route('https://api.market-data-source.com/**', (route) => route.fulfill({ json: emptyExchangeInfo }));

  // Fixture logo URLs → 1×1 transparent PNG, so nothing leaves localhost.
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
  );
});

test('smoke: markets → star → coin detail → buy → portfolio → watchlist', async ({ page }) => {
  // 1. Land on Markets in forced polling mode (no real WebSocket).
  await page.goto('/?polling=1');
  await expect(page.getByText(/prices refresh every 30s/i).first()).toBeVisible();

  // 2. BTC row renders with the fixture price.
  const btcRow = page.getByRole('row', { name: /bitcoin/i });
  await expect(btcRow).toBeVisible();
  await expect(btcRow).toContainText('100,000.00');

  // 3. Star BTC — the star is the row's only <button>; stopPropagation means no navigation.
  await btcRow.getByRole('button').first().click();
  await expect(page).toHaveURL(/polling=1/); // still on Markets

  // 4. Open the coin detail page by clicking the row's name cell
  //    (client-side nav keeps polling mode in the market store).
  await btcRow.getByText('Bitcoin').click();
  await expect(page).toHaveURL(/\/coin\/btc/);
  await expect(page.getByText('Bitcoin').first()).toBeVisible();

  // 5. Buy 0.1 BTC at the fixture price: notional 10,000 + 0.1% fee = 10,010.00.
  //    The Buy/Sell side tabs are also <button>s whose names would match /buy/i,
  //    so target the submit button by its exact accessible name "Buy BTC"
  //    (once the amount is valid, its label is `Buy ${ticker}` per Task 20).
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
```

Notes on determinism: with pairs empty and polling forced, `priceFor('bitcoin')` always returns the fixture price `100000`, so the post-trade cash is exactly `$89,990.00` (buy cost = 0.1 × 100000 × 1.001). `.first()` is used wherever the same text can legitimately appear twice (e.g. header cash chip + portfolio summary) to avoid Playwright strict-mode violations. Each test gets a fresh browser context, so localStorage (watchlist/portfolio persistence) starts clean.

- [ ] **Step 4: Run the smoke test**

```bash
npx playwright test
```

(`npm run test:e2e` is equivalent.) The webServer block starts `npm run dev` itself — the first run includes Next.js dev compilation, so allow ~1–2 minutes. Expected output:

```
Running 1 test using 1 worker
  ✓  1 [chromium] › e2e/smoke.spec.ts:… › smoke: markets → star → coin detail → buy → portfolio → watchlist (…s)

  1 passed (…s)
```

If a locator times out, re-run with `npx playwright test --debug` to step through, and align the failing selector with the real markup from Task 15 (star button) or Task 20 (amount input) — do not weaken the assertions.

- [ ] **Step 5: Confirm nothing else regressed**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc` exits silently (0 errors — `@playwright/test` supplies the types for the config and spec), and the full Vitest suite still passes (`Test Files … passed`) — Vitest's `**/*.test.ts` include ignores `e2e/smoke.spec.ts`.

### Task 23: README rewrite + demo-day checklist

**Files:**
- Modify: `README.md` (full rewrite of the create-next-app boilerplate)

- [ ] **Step 1: Replace the entire contents of `README.md`** with:

````markdown
# Riverflow — Realtime Crypto Paper-Trading Demo

A market-grade trading terminal in the browser: live streaming prices, realtime
candlestick charts, and **$100,000 of simulated cash** to trade with. No signup,
no backend persistence, no real money.

> Demo application. Simulated trading with fictional funds — not financial advice.

## Features

- Top-50 markets table with live prices streamed from the market-data-source `!miniTicker@arr`
  WebSocket — price cells flash green/red on every tick
- CoinGecko trending strip and coin metadata (server-proxied, cached)
- Realtime candlestick charts (lightweight-charts `lightweight-charts`, 1m/15m/1H/4H/1D)
- Paper trading: market orders with a simulated 0.1% taker fee, average-cost
  tracking, realized and live unrealized P&L
- Watchlist (⭐) and portfolio persisted in `localStorage` — survives revisits
- Graceful degradation: if market-data-source is unreachable or geo-blocked, the app drops
  to a 30-second polling mode with a banner; append `?polling=1` to force it

## Quickstart

```bash
npm install
npm run dev     # → http://localhost:3000
```

Optional: a free CoinGecko demo API key raises the rate-limit headroom of the
server-side proxy. The app works fully keyless — only add this if you have one:

```bash
# .env.local
COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxx
```

## Tests

```bash
npm test            # Vitest unit tests (trading math, stores, ws-manager, API routes)
npm run test:watch  # Vitest watch mode
npm run test:e2e    # Playwright smoke flow — fully mocked network, safe for CI
```

## Architecture

```
Browser ────────────────► wss://data-stream.market-data-source.vision    live tickers + klines (keyless)
   │                      https://data-api.market-data-source-source.vision     kline history, exchangeInfo
   │
   └──► Next.js route handlers ────► api.coingecko.com        metadata + trending
         /api/markets  (60s cache)                            (API key stays server-side)
         /api/trending (300s cache)
```

- **State (Zustand):** `market` (in-memory live prices), `watchlist` (persisted),
  `portfolio` (persisted, starts at $100k). Corrupt storage silently resets.
- **Money math:** `lib/trading.ts` — pure functions, fully unit-tested.
- **The tricky join:** `lib/symbol-map.ts` maps ticker symbols to USDT pairs
  via `exchangeInfo` (`stores/market.ts` joins CoinGecko ids to symbols). Every coin
  — mapped or not — is refreshed from `/api/markets` on a 60s client timer; coins
  with a market-data-source pair additionally get live WebSocket ticks between refreshes. So
  unmapped coins are first-class: they simply move at the 60s CoinGecko cadence.
- **Pages:** `/` Markets · `/coin/[symbol]` chart + trade · `/watchlist` · `/portfolio`.
- Components read stores and never touch the network; the WebSocket manager writes
  only to the `market` store.

## Demo-day checklist

- [ ] Open the deployed site on a real phone — layout holds, prices tick, a full trade works
- [ ] Browse with an adblocker enabled — nothing breaks visually or functionally
- [ ] Force the market-data-source-blocked path with `?polling=1` — banner shows, prices refresh every 30s, trading still works
- [ ] Throttle to 3G in DevTools — first paint is acceptable; on a normal connection prices tick within ~3s of landing
- [ ] Reset demo on `/portfolio` — restores $100,000, clears holdings and history, watchlist untouched

## Attributions

- Market metadata: [Powered by CoinGecko](https://www.coingecko.com)
- Charts: lightweight-charts [lightweight-charts](https://github.com/lightweight-charts/lightweight-charts) (Apache-2.0, attribution logo enabled)
- Live market data: market-data-source public market-data endpoints
````

- [ ] **Step 2: Verify the README structure**

```bash
grep -c '^- \[ \]' README.md
grep -n 'polling=1' README.md
grep -c 'TODO' README.md
```

Expected: the first command prints `5` (the five demo-day checklist items); the second prints two matching lines (the Features bullet and the checklist item); the third prints `0` and exits with code 1 — no TODO markers or placeholders anywhere in the README is the pass condition.

- [ ] **Step 3: Confirm the project still lints and builds**

```bash
npm run lint
```

Expected: exits clean (ESLint does not process Markdown; this confirms the working tree is still green after the edit).

### Task 24: Vercel deployment + final polish checklist

**Files:**
- Create: `.vercel/project.json` + `.vercel/README.txt` (generated by the Vercel CLI when linking — never written by hand)

No git anywhere in this task: `npx vercel` uploads the local directory directly, so no repository or commits are required. Vercel Hobby is fine for this demo (spec §8: keep it non-commercial — no ads, payments, or donation links).

- [ ] **Step 1: Pre-deploy gate — unit and e2e suites pass**

```bash
npm test
npx playwright test
```

Expected: Vitest prints `Test Files … passed` with 0 failures; Playwright prints `1 passed`.

- [ ] **Step 2: Pre-deploy gate — production build succeeds locally**

```bash
npm run build
```

Expected: `✓ Compiled successfully`, followed by the route table listing `/`, `/coin/[symbol]`, `/watchlist`, `/portfolio`, `/api/markets`, `/api/trending` — no type or build errors.

- [ ] **Step 3: Authenticate the Vercel CLI**

```bash
npx vercel whoami
```

If it prints your Vercel username, you are already logged in — skip ahead. Otherwise:

```bash
npx vercel login
```

Expected: an email/GitHub/GitLab login picker; after completing the browser/email flow it prints `> Success! … now logged in`.

- [ ] **Step 4: Link the project and create a preview deployment from the local directory**

```bash
npx vercel
```

Answer the prompts: `Set up and deploy?` → **Y** · `Which scope?` → your account · `Link to existing project?` → **N** · `What's your project's name?` → **riverflow** · `In which directory is your code located?` → **./** · Vercel auto-detects Next.js (`Want to modify these settings?` → **N**). Expected output ends with:

```
🔗  Linked to <scope>/riverflow (created .vercel)
🔍  Inspect: https://vercel.com/<scope>/riverflow/<id>
✅  Preview: https://riverflow-<hash>-<scope>.vercel.app
```

Open the Preview URL and confirm the Markets page loads.

- [ ] **Step 5: Set the CoinGecko API key env var (optional but recommended)**

```bash
npx vercel env add COINGECKO_API_KEY production
```

Paste the key at the `What's the value of COINGECKO_API_KEY?` prompt. Expected: `Added Environment Variable COINGECKO_API_KEY to Project riverflow`. (Dashboard alternative: vercel.com → riverflow → Settings → Environment Variables → add for Production.) Skip entirely if running keyless — the proxy works without it. Env vars apply to the *next* deployment, which is the very next step.

- [ ] **Step 6: Production deploy**

```bash
npx vercel --prod
```

Expected output ends with:

```
✅  Production: https://riverflow-<scope>.vercel.app
```

That URL is the live demo. All remaining steps run against it.

- [ ] **Step 7: Verify — live tick within 3 seconds.** Open the production URL in a fresh incognito window. Within ~3s of landing the connection badge should read streaming (⚡) and at least one price cell should flash green/red. If your region is geo-blocked by market-data-source, the polling banner must appear instead and prices must still render — either state is a pass; a blank table is a fail.

- [ ] **Step 8: Verify — trade flow on the deployed URL.** On production: star BTC on Markets → open `/coin/btc` → buy `0.05` → "Order filled" toast → `/portfolio` shows the position, updated cash, and the trade in history → `/watchlist` shows BTC. Then use Reset demo (confirm dialog) and check cash returns to $100,000 with the watchlist untouched.

- [ ] **Step 9: Verify — mobile viewport.** Open the production URL on a real phone (or DevTools device toolbar, iPhone-class width ~390px): header, trending strip, table, chart, and trade panel are all usable with no horizontal overflow; complete one buy on mobile.

- [ ] **Step 10: Verify — Lighthouse performance sanity (≥ 85)**

```bash
npx lighthouse https://riverflow-<scope>.vercel.app --only-categories=performance --quiet --chrome-flags="--headless=new"
```

(Or DevTools → Lighthouse → Performance.) Expected: `Performance` score ≥ 0.85. If it falls short, the usual culprits here are unoptimized coin logos (check `next/image` usage / image sizes) and chart JS in the initial bundle (check that `lightweight-charts` only loads on the coin page via the client component split).

- [ ] **Step 11: Verify — footer attributions visible on production.** Scroll to the footer on any page and confirm all three, per spec §8: the "Powered by CoinGecko" link, the lightweight-charts `lightweight-charts` note (plus the attribution logo on the chart itself at `/coin/btc`), and the disclaimer "Demo application. Simulated trading with fictional funds — not financial advice."

- [ ] **Step 12: Final polish checklist — spec §1 success criteria, all on the production URL:**

  - [ ] Cold visit shows live-ticking prices within ~3 seconds, with no login wall
  - [ ] A first-time visitor can buy a coin with the demo balance within 60 seconds, unassisted — hand your phone to someone who hasn't seen the app and watch
  - [ ] Nothing ever looks broken: `?polling=1` on production shows the banner and everything still works; kill the network mid-session and reconnect — badge cycles reconnecting → streaming, prices gray out when stale rather than blanking
  - [ ] Works on mobile (Step 9 passed)
  - [ ] Hobby-plan compliance: no ads, payments, or donation links anywhere
  - [ ] Run the full README demo-day checklist (Task 23) against the production URL and tick every box

If every box is checked, the demo is ready to show clients.
