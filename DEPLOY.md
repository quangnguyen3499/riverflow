# Deploying Riverflow

Deployment needs your Vercel credentials, so the steps below are for you to run — nothing here has
been executed on your behalf. The pre-deploy gates *have* been run and all pass (see the bottom).

> **No git required.** `npx vercel` uploads the local directory directly. This project never uses git.

## 1. Log in

```bash
npx vercel whoami        # prints your username if you're already logged in
npx vercel login         # otherwise: email / GitHub / GitLab picker
```

## 2. Create a preview deployment

```bash
npx vercel
```

Answer the prompts: *Set up and deploy?* **Y** · scope: your account · *Link to existing project?* **N** ·
name: **riverflow** · directory: **./** · *Modify settings?* **N** (Next.js is auto-detected).

It finishes with a `Preview:` URL. Open it and confirm the Markets page loads with prices ticking.

## 3. Environment variables

```bash
npx vercel env ls production   # expect: nothing, or STOCKS_DATA_MODE=fixture
```

The crypto pages talk to market-data source directly from the browser with no key, so they need nothing.

**Leave `MASSIVE_API_KEY` out of the deployed environment entirely.** The stocks page defaults to
synthetic fixture data and only calls Massive when `STOCKS_DATA_MODE` is exactly `live`, so a
deployment is compliant even if the key leaks in — but not shipping the key is the stronger guarantee.

### Build hygiene — do this before any deploy that follows local live work

Two things bite here, both verified:

```bash
rm -rf .next && npm run build      # then deploy
```

1. **A local `STOCKS_DATA_MODE=live` run leaves raw Massive JSON in `.next/cache/fetch-cache/`** —
   roughly 1.7 MB including every real US ticker. `.next` is gitignored so it never reaches a repo,
   but an artifact-based deploy (`vercel deploy --prebuilt`, a Docker image, an rsync of `.next`, a
   restored build cache) would carry their market data into a hosted location. Wipe `.next` first.
2. **`/api/stocks` is statically prerendered**, so the fixture/live decision for its first response is
   baked in at *build* time, not request time. Never produce a deployable artifact while
   `STOCKS_DATA_MODE=live` is in your shell. Corollary for local work: setting the variable against
   `npx next start` does nothing for up to 12h — use `npm run dev`, or rebuild.

## 4. Promote to production

```bash
npx vercel --prod
```

## 5. Post-deploy checklist

Run these against the deployed URL, not localhost:

- [ ] Markets page paints its first row in a few seconds and prices visibly tick.
- [ ] Badge reads **⚡ Live** (not Offline).
- [ ] Coin detail renders a candlestick chart with the lightweight-charts logo visible.
- [ ] A buy executes and the Portfolio shows the position with P&L moving on its own.
- [ ] Star a coin → it appears on Watchlist → still there after a hard reload.
- [ ] Mobile viewport (~390px): no horizontal scroll, table stays readable.
- [ ] `?offline=1` shows the amber "prices shown as of HH:MM" banner and trading still works.
- [ ] `?nodata=1` shows the "Live market data is unavailable" panel and does **not** heal itself.
- [ ] Footer shows the lightweight-charts attribution and the demo disclaimer.
- [ ] Lighthouse performance ≥ 85 on desktop.

## Two constraints to respect

**Vercel Hobby is non-commercial only.** No ads, payment links, affiliate links, or donation
buttons on the deployed demo. Showing it to a client to win work is fine; monetising the page
itself is not.

**Do not deploy real Massive/Polygon stock data publicly.** Their Market Data Terms §1 grant
personal, non-commercial use and forbid using the data "to build an application intended for use by
end users other than you"; §5(c) puts *display* in the same prohibition as redistribution and extends
it to charts. Paid *individual* plans don't change this — only a Business plan permits public
display. So keep `STOCKS_DATA_MODE=fixture` (synthetic data) on any public deployment and use real
data locally only. Also **do not** add a "Powered by Massive" credit: §6 grants no trademark rights,
and no attribution is required.

## Pre-deploy gates — verified

| Gate | Result |
|---|---|
| `npx vitest run` | **259 passed** (15 files) |
| `npx playwright test` | **1 passed** — markets → star → coin detail → buy → portfolio → watchlist |
| `npm run build` | ✓ Compiled; routes `/`, `/coin/[symbol]`, `/watchlist`, `/portfolio`, `/stocks`, `/stocks/[ticker]`, `/api/stocks`, `/api/stocks/[ticker]` |
| Crypto path uses no server routes | ✓ the browser calls market-data source directly; the only `app/api/*` routes are the two stocks handlers, which exist solely to keep the Massive key server-side |
| Fixture default holds | ✓ a build carrying a real `MASSIVE_API_KEY` with `STOCKS_DATA_MODE` unset served synthetic data (ZENITH/HELIOS), and `/api/stocks/AAPL` 404s |
| No horizontal scroll at 380px | ✓ all six pages measured `doc=380 client=380` |
| `rm -rf .next && npx tsc --noEmit` | exit 0 |
| `npm run lint` | clean |
