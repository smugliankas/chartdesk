import { BinanceProvider } from './binance';
import { BinanceTradFiProvider } from './binanceTradfi';
import { BybitTradFiProvider } from './bybit';
import { CsvProvider } from './csv';
import { CTraderProvider } from './ctrader';
import { desktopCTrader, IS_DESKTOP } from '../desktop';
import type { DataProvider } from './types';

export const binance = new BinanceProvider();
export const csv = new CsvProvider();
export const binanceTradFi = new BinanceTradFiProvider();
export const bybitTradFi = new BybitTradFiProvider();
/** Prices from the person's own broker; desktop app only (signing in needs the app). */
export const cTrader = IS_DESKTOP
  ? new CTraderProvider({ ...desktopCTrader, createSocket: (url) => new WebSocket(url), storage: localStorage })
  : null;

/** All available data sources, in the order they appear in the UI. Add new providers here. */
export const PROVIDERS: readonly DataProvider[] = [binance, ...(cTrader ? [cTrader] : []), bybitTradFi, binanceTradFi, csv];

export function getProvider(id: string): DataProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export type { DataProvider, Quote, SymbolInfo } from './types';
