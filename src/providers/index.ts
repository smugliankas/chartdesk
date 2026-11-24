import { BinanceProvider } from './binance';
import { CsvProvider } from './csv';
import type { DataProvider } from './types';

export const binance = new BinanceProvider();
export const csv = new CsvProvider();

/** All available data sources, in the order they appear in the UI. Add new providers here. */
export const PROVIDERS: readonly DataProvider[] = [binance, csv];

export function getProvider(id: string): DataProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export type { DataProvider } from './types';
