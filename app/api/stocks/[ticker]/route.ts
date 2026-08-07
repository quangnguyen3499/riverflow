// app/api/stocks/[ticker]/route.ts
import {
  fetchStockBars,
  fetchTickerName,
  MissingApiKeyError,
  minusDays,
  nyDate,
  NoSessionError,
  RateLimitError,
} from '@/lib/massive';
import { stockDetailFixture, stocksDataMode } from '@/lib/stocks-fixture';
import type { StockDetail } from '@/lib/types';

export const revalidate = 86_400; // 24h — completed daily bars never change

/** Quota guard: anything that is not a plausible US ticker 404s without an upstream call. */
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
const LOOKBACK_DAYS = 365; // well inside the free tier's 2-year window

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  const { ticker: raw } = await ctx.params;
  const ticker = (raw ?? '').toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return Response.json({ error: 'not-found' }, { status: 404 });
  }

  // The licence gate — same fail-safe rule as /api/stocks: only STOCKS_DATA_MODE=live reaches
  // Massive, so an unset (or merely key-bearing) deployment serves synthetic candles instead of
  // publishing a Derived Work. A ticker outside the fixture universe 404s exactly as a delisted
  // symbol does on the live path.
  if (stocksDataMode() !== 'live') {
    const fixture = stockDetailFixture(ticker);
    if (fixture === null) {
      return Response.json({ error: 'not-found' }, { status: 404 });
    }
    return Response.json(fixture);
  }

  try {
    const to = nyDate(Date.now());
    const bars = await fetchStockBars(ticker, minusDays(to, LOOKBACK_DAYS), to);
    if (bars.length === 0) {
      return Response.json({ error: 'not-found' }, { status: 404 });
    }

    const last = bars[bars.length - 1];
    const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;
    // Best effort, never fatal — the header falls back to "US Equity".
    const name = await fetchTickerName(ticker).catch(() => null);

    const detail: StockDetail = {
      mode: 'live',
      ticker,
      name,
      // The bar's `t` is the START of its daily window, i.e. midnight ET on the
      // session date, so this is the session's own New York calendar date.
      sessionDate: nyDate(last.time * 1000),
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      prevClose,
      changePct:
        prevClose !== null && prevClose > 0
          ? ((last.close - prevClose) / prevClose) * 100
          : null,
      volume: last.volume,
      vwap: last.vwap,
      bars,
    };
    return Response.json(detail);
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return Response.json({ error: 'no-key' }, { status: 503 });
    }
    if (e instanceof RateLimitError) {
      return Response.json({ error: 'rate-limited' }, { status: 503 });
    }
    if (e instanceof NoSessionError) {
      return Response.json({ error: 'no-session' }, { status: 502 });
    }
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
