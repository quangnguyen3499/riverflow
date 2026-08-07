// app/api/stocks/route.ts
import {
  fetchGroupedDaily,
  MissingApiKeyError,
  NoSessionError,
  RateLimitError,
  resolveTradingDate,
} from '@/lib/massive';
import { stocksDataMode, stocksFixture } from '@/lib/stocks-fixture';
import { rankMovers } from '@/lib/stocks-movers';
import type { StocksPayload } from '@/lib/types';

export const revalidate = 43_200; // 12h — a closed session's data is immutable

export async function GET(): Promise<Response> {
  // The licence gate, and it fails safe: only STOCKS_DATA_MODE=live reaches Massive. Unset,
  // misspelled or differently-cased values all serve the synthetic fixture, so a deployment
  // that happens to carry MASSIVE_API_KEY does NOT start publishing licensed market data.
  // See lib/stocks-fixture.ts for the terms this implements.
  if (stocksDataMode() !== 'live') {
    return Response.json(stocksFixture());
  }

  try {
    const sessionDate = await resolveTradingDate();
    const bars = await fetchGroupedDaily(sessionDate);
    if (bars.length === 0) {
      return Response.json({ error: 'no-session' }, { status: 502 });
    }

    const { gainers, losers, actives, filtered } = rankMovers(bars);
    const payload: StocksPayload = {
      mode: 'live',
      sessionDate,
      asOf: Date.now(),
      gainers,
      losers,
      actives,
      filtered,
    };
    return Response.json(payload);
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
