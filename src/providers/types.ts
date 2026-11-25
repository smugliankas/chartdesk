import type { Candle, Timeframe } from '../types';

/** Latest price and 24-hour change of a symbol, for the watchlist. */
export interface Quote {
  symbol: string;
  price: number;
  /** Change over the last 24 hours, in percent. */
  changePct: number;
  /** Decimals the market quotes this symbol with (from its tick size), when known. */
  decimals?: number;
}

/** One entry in the symbol search list. */
export interface SymbolInfo {
  symbol: string;
  /** Plain name, e.g. "Gold" or "Apple", shown after the symbol. */
  name?: string;
  /** Short extra text shown next to the symbol (e.g. 24h change). */
  detail?: string;
  /** In a search across sources: the source the symbol comes from, and its label. */
  providerId?: string;
  source?: string;
}

/**
 * A source of candle data.
 *
 * To add a new data source (a broker, an exchange, a local file format…),
 * implement this interface and register it in `providers/index.ts`.
 * Everything runs on the user's own machine: each user brings their own data,
 * nothing is redistributed through a server.
 */
export interface DataProvider {
  /** Stable id, used in storage keys (e.g. "binance"). */
  readonly id: string;
  /** Name shown in the UI. */
  readonly name: string;
  /** One or two sentences about the data, shown as a tooltip on the source. */
  readonly description?: string;
  /** Whether the user types a symbol (true) or the provider supplies it (e.g. a loaded file). */
  readonly freeSymbolInput: boolean;
  /** Symbol opened the first time this source is picked. */
  readonly defaultSymbol?: string;

  /** The most recent candles, oldest first. */
  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]>;

  /**
   * Optional: older candles that end before `beforeTime` (UNIX seconds), oldest first.
   * Called when the user scrolls to the left edge. Return an empty array when there is no more history.
   */
  getCandlesBefore?(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]>;

  /**
   * Optional live updates. `onCandle` receives the latest (possibly still forming) bar.
   * Returns a function that stops the subscription.
   */
  subscribe?(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void;

  /** Optional symbol search for the symbol box. Best matches first. */
  searchSymbols?(query: string): Promise<SymbolInfo[]>;

  /** Optional live quotes for several symbols at once (watchlist). Returns a function that stops it. */
  watchQuotes?(symbols: string[], onQuote: (q: Quote) => void): () => void;
}
