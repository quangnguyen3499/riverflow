export interface CoinMarket {
  id: string;        // lowercase base asset, e.g. "btc" — THE identity key (routes, watchlist, Holding.coinId)
  symbol: string;    // lowercase ticker, e.g. "btc" — always === id
  name: string;      // display name from lib/coin-names.ts, else the uppercase ticker
  pair: string;      // spot symbol, e.g. "BTCUSDT" — key into tickers{}
  rank: number;      // 1-based position by 24h QUOTE VOLUME — NOT a market-cap rank
  price: number;     // lastPrice: snapshot value / fallback when no live tick has arrived
  change24h: number; // priceChangePercent, already a percent (no ×100)
  high24h: number;   // highPrice — feeds the 24h Range micro-bar (Task 15)
  low24h: number;    // lowPrice  — ditto
  volume24h: number; // quoteVolume — 24h notional in USDT
  trades24h: number; // count — 24h trade count. SNAPSHOT-ONLY: the miniTicker frame has no trade
                     // count (only the heavier !ticker@arr carries `n`), so this refreshes when
                     // ticker/24hr does, not on every tick. A trade count minutes old is fine;
                     // a price minutes old would not be, which is why prices come off the socket.
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
  coinId: string;        // lowercase base asset, e.g. "btc"
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

/** 'polling' is historical. It means "the WebSocket gave up after 4 consecutive failures" —
 *  i.e. no live stream. Nothing polls: there is no second data source. Render it as "Offline". */
export type ConnectionStatus = 'connecting' | 'streaming' | 'reconnecting' | 'polling';

export interface Candle {
  time: number;          // UNIX seconds (lightweight-charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
}

/** One ranked row on the /stocks movers tables. Derived from a single grouped-daily bar. */
export interface StockRow {
  ticker: string;        // "AAPL", uppercase
  open: number;          // session open, USD
  close: number;         // session close, USD
  changePct: number;     // (close - open) / open * 100 — the session's open-to-close move
  volume: number;        // shares
  dollarVolume: number;  // volume * (vwap ?? close) — the Most Active sort key
}

/** One daily bar for one ticker, as returned by the Massive custom-bars endpoint. */
export interface StockBar {
  time: number;          // UNIX seconds, START of the daily window (lightweight-charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;        // shares
  vwap: number | null;   // null when upstream omits it
}

/**
 * Which source answered a stocks request. `'fixture'` means SYNTHETIC data (lib/stocks-fixture.ts)
 * and is the default everywhere: Massive's free tier forbids public display of its market data, so
 * only `STOCKS_DATA_MODE=live` — a local-only setting — reaches the real upstream. Both payloads
 * carry it because the UI must disclose which one a viewer is looking at.
 */
export type StocksDataMode = 'live' | 'fixture';

/** Body of GET /api/stocks — all three tabs arrive in one payload, so switching tabs costs nothing. */
export interface StocksPayload {
  mode: StocksDataMode;  // 'fixture' → invented prices; the page must say so
  sessionDate: string;   // "2026-07-31", America/New_York calendar date of the last completed session
  asOf: number;          // ms epoch the payload was built
  gainers: StockRow[];   // up to 20
  losers: StockRow[];    // up to 20
  actives: StockRow[];   // up to 20
  filtered: number;      // tickers that survived the liquidity filter, for the "only n met the filter" note
}

/** Body of GET /api/stocks/[ticker] — header stats and the whole daily series in one payload. */
export interface StockDetail {
  mode: StocksDataMode;      // 'fixture' → invented prices and candles; the page must say so
  ticker: string;
  name: string | null;       // null when the best-effort name lookup was skipped or failed
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number | null;  // previous daily bar's close; null when only one bar exists
  changePct: number | null;  // close vs prevClose; null when prevClose is null or 0
  volume: number;
  vwap: number | null;
  bars: StockBar[];          // daily, ascending — the chart series
}

export type StocksErrorCode =
  | 'no-key'
  | 'rate-limited'
  | 'upstream'
  | 'not-found'
  | 'no-session';
