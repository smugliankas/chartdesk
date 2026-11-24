import type { Candle, Timeframe } from '../types';

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
  /** Whether the user types a symbol (true) or the provider supplies it (e.g. a loaded file). */
  readonly freeSymbolInput: boolean;

  /** Historical candles, oldest first. */
  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]>;

  /**
   * Optional live updates. `onCandle` receives the latest (possibly still forming) bar.
   * Returns a function that stops the subscription.
   */
  subscribe?(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void;
}
