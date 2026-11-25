import type { Candle, Timeframe } from '../types';
import { COMMODITY_NAMES, getJson, liveSocket, pctText, stepDecimals } from './socket';
import type { DataProvider, Quote, SymbolInfo } from './types';

// Binance USDⓈ-M futures, public market data. No API key or account needed.
const REST_URL = 'https://fapi.binance.com/fapi/v1';
// Market data streams live under /market (the plain /ws path no longer sends them).
const WS_URL = 'wss://fstream.binance.com/market';
const PAGE_SIZE = 1500;

type KlineRow = [number, string, string, string, string, string, ...unknown[]];

interface FuturesSymbol {
  symbol: string;
  status: string;
  contractType: string;
  baseAsset: string;
  underlyingType: string;
  underlyingSubType?: string[];
  filters?: { filterType: string; tickSize?: string }[];
}

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

interface Market {
  symbol: string;
  name: string;
  decimals?: number;
}

const KIND_NAMES: Record<string, string> = {
  EQUITY: 'US stock / ETF',
  HK_EQUITY: 'Hong Kong stock',
  KR_EQUITY: 'Korean stock',
  CN_EQUITY: 'Chinese stock',
  FX: 'Forex',
  PREMARKET: 'Pre-IPO',
};

/**
 * Binance's "TradFi" perpetual futures: gold, silver, oil, US stocks and ETFs (SPY, QQQ…)
 * and a few forex pairs, priced in USDT.
 *
 * These are futures prices, not a broker's spot quotes: they trade around the clock, weekends
 * included, and can sit a little away from the underlying market.
 */
export class BinanceTradFiProvider implements DataProvider {
  readonly id = 'binance-tradfi';
  readonly name = 'Binance TradFi (gold, oil, stocks)';
  readonly description =
    'Binance perpetual futures on traditional markets. Futures prices, trading 24/7 (weekends too), so they can differ a little from your broker.';
  readonly freeSymbolInput = true;
  readonly defaultSymbol = 'XAUUSDT';

  private markets: Promise<Map<string, Market>> | null = null;
  private tickers: Promise<Map<string, Ticker24h>> | null = null;

  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    return this.klines(symbol, tf);
  }

  getCandlesBefore(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]> {
    return this.klines(symbol, tf, beforeTime * 1000 - 1);
  }

  private async klines(symbol: string, tf: Timeframe, endTimeMs?: number): Promise<Candle[]> {
    let url = `${REST_URL}/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${tf}&limit=${PAGE_SIZE}`;
    if (endTimeMs !== undefined) url += `&endTime=${endTimeMs}`;
    const rows = await getJson<KlineRow[]>(url, 'Binance');
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }

  /** The TradFi contracts, from the exchange's list (once per session). */
  private loadMarkets(): Promise<Map<string, Market>> {
    this.markets ??= getJson<{ symbols: FuturesSymbol[] }>(`${REST_URL}/exchangeInfo`, 'Binance')
      .then((info) => {
        const map = new Map<string, Market>();
        for (const s of info.symbols) {
          if (s.status !== 'TRADING' || !s.underlyingSubType?.includes('TradFi')) continue;
          const tick = s.filters?.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize;
          const name =
            s.underlyingType === 'COMMODITY' ? (COMMODITY_NAMES[s.baseAsset] ?? 'Commodity') : (KIND_NAMES[s.underlyingType] ?? '');
          map.set(s.symbol, { symbol: s.symbol, name, decimals: tick ? stepDecimals(tick) : undefined });
        }
        return map;
      })
      .catch((err: unknown) => {
        this.markets = null;
        throw err;
      });
    return this.markets;
  }

  private loadTickers(): Promise<Map<string, Ticker24h>> {
    this.tickers ??= getJson<Ticker24h[]>(`${REST_URL}/ticker/24hr`, 'Binance')
      .then((rows) => new Map(rows.map((r) => [r.symbol, r])))
      .catch((err: unknown) => {
        this.tickers = null;
        throw err;
      });
    return this.tickers;
  }

  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    const [markets, tickers] = await Promise.all([this.loadMarkets(), this.loadTickers().catch(() => new Map<string, Ticker24h>())]);
    const q = query.trim().toUpperCase();
    const list = [...markets.values()].sort(
      (a, b) => Number(tickers.get(b.symbol)?.quoteVolume ?? 0) - Number(tickers.get(a.symbol)?.quoteVolume ?? 0),
    );
    const match = (m: Market) => !q || m.symbol.includes(q) || m.name.toUpperCase().includes(q);
    const starts = list.filter((m) => q && m.symbol.startsWith(q));
    const rest = list.filter((m) => match(m) && !starts.includes(m));
    return [...starts, ...rest].slice(0, 50).map((m) => {
      const t = tickers.get(m.symbol);
      return { symbol: m.symbol, name: m.name, detail: t ? pctText(Number(t.priceChangePercent)) : undefined };
    });
  }

  watchQuotes(symbols: string[], onQuote: (q: Quote) => void): () => void {
    const list = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (list.length === 0) return () => {};
    let decimals = new Map<string, number | undefined>();
    const quote = (symbol: string, last: number, open: number): Quote => ({
      symbol,
      price: last,
      changePct: open > 0 ? (last / open - 1) * 100 : 0,
      decimals: decimals.get(symbol),
    });

    // Snapshot first (with each market's decimals), then the live stream.
    void Promise.all([this.loadMarkets(), getJson<Ticker24h[]>(`${REST_URL}/ticker/24hr`, 'Binance')])
      .then(([markets, rows]) => {
        decimals = new Map(list.map((s) => [s, markets.get(s)?.decimals]));
        for (const r of rows) {
          if (!list.includes(r.symbol)) continue;
          const last = Number(r.lastPrice);
          const pct = Number(r.priceChangePercent);
          onQuote({ symbol: r.symbol, price: last, changePct: pct, decimals: decimals.get(r.symbol) });
        }
      })
      .catch(() => {
        /* the stream fills it */
      });

    const streams = list.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
    return liveSocket(`${WS_URL}/stream?streams=${streams}`, {
      onMessage: (msg) => {
        const d = (msg as { data?: { s: string; c: string; o: string } }).data;
        if (d) onQuote(quote(d.s, Number(d.c), Number(d.o)));
      },
    });
  }

  subscribe(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void {
    return liveSocket(`${WS_URL}/ws/${symbol.toLowerCase()}@kline_${tf}`, {
      onMessage: (msg) => {
        const k = (msg as { k?: { t: number; o: string; h: string; l: string; c: string; v: string } }).k;
        if (!k) return;
        onCandle({
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        });
      },
    });
  }
}
