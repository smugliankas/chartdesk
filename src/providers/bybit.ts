import type { Candle, Timeframe } from '../types';
import { COMMODITY_NAMES, getJson, liveSocket, pctText, stepDecimals } from './socket';
import type { DataProvider, Quote, SymbolInfo } from './types';

// Bybit v5 public market data. No API key or account needed.
const REST_URL = 'https://api.bybit.com/v5/market';
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const PAGE_SIZE = 1000;

/** Bybit's interval names. */
const INTERVALS: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

/** Kinds of traditional-market contracts (Bybit's `symbolType`), in the order search lists them. */
const KINDS = ['forex', 'commodity', 'ETF', 'stock'] as const;

interface Instrument {
  symbol: string;
  status: string;
  contractType: string;
  quoteCoin: string;
  symbolType?: string;
  fullName?: string;
  baseCoin?: string;
  priceFilter?: { tickSize?: string };
}

interface Ticker {
  symbol: string;
  lastPrice?: string;
  price24hPcnt?: string;
  turnover24h?: string;
}

interface Market {
  symbol: string;
  name: string;
  kind: string;
  decimals?: number;
}

interface Envelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

async function bybit<T>(path: string): Promise<T> {
  const body = await getJson<Envelope<T>>(`${REST_URL}${path}`, 'Bybit');
  if (body.retCode !== 0) throw new Error(`Bybit: ${body.retMsg}`);
  return body.result;
}

/**
 * Bybit's "TradFi" perpetual futures: forex majors (EUR/USD, GBP/USD, USD/JPY), gold, silver,
 * oil, US stocks and ETFs, priced in USDT.
 *
 * These are futures prices, not a broker's spot quotes: they trade around the clock, weekends
 * included, and can sit a little away from the underlying market.
 */
/** Bybit gives some markets only a code ("XAU", "EURUSD"); make those readable. */
function marketName(s: Instrument): string {
  const base = s.baseCoin ?? '';
  if (COMMODITY_NAMES[base]) return COMMODITY_NAMES[base];
  const pair = /^([A-Z]{3})([A-Z]{3})$/.exec(base);
  if (s.symbolType === 'forex' && pair) return `${pair[1]} / ${pair[2]}`;
  return s.fullName ?? '';
}

export class BybitTradFiProvider implements DataProvider {
  readonly id = 'bybit-tradfi';
  readonly name = 'Bybit TradFi (forex, gold, stocks)';
  readonly description =
    'Bybit perpetual futures on traditional markets. Futures prices, trading 24/7 (weekends too), so they can differ a little from your broker.';
  readonly freeSymbolInput = true;
  readonly defaultSymbol = 'EURUSDUSDT';

  private markets: Promise<Map<string, Market>> | null = null;

  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    return this.klines(symbol, tf);
  }

  getCandlesBefore(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]> {
    return this.klines(symbol, tf, beforeTime * 1000 - 1);
  }

  private async klines(symbol: string, tf: Timeframe, endMs?: number): Promise<Candle[]> {
    let path = `/kline?category=linear&symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${INTERVALS[tf]}&limit=${PAGE_SIZE}`;
    if (endMs !== undefined) path += `&end=${endMs}`;
    const result = await bybit<{ list: string[][] }>(path);
    // Newest first in the response; the chart wants oldest first.
    return result.list
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
      .reverse();
  }

  /** The traditional-market contracts (once per session). */
  private loadMarkets(): Promise<Map<string, Market>> {
    this.markets ??= (async () => {
      const map = new Map<string, Market>();
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const r = await bybit<{ list: Instrument[]; nextPageCursor?: string }>(
          `/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        for (const s of r.list) {
          if (s.status !== 'Trading' || s.contractType !== 'LinearPerpetual' || s.quoteCoin !== 'USDT') continue;
          if (!KINDS.includes(s.symbolType as (typeof KINDS)[number])) continue;
          const tick = s.priceFilter?.tickSize;
          map.set(s.symbol, { symbol: s.symbol, name: marketName(s), kind: s.symbolType!, decimals: tick ? stepDecimals(tick) : undefined });
        }
        cursor = r.nextPageCursor ?? '';
        if (!cursor) break;
      }
      return map;
    })().catch((err: unknown) => {
      this.markets = null;
      throw err;
    });
    return this.markets;
  }

  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    const [markets, tickers] = await Promise.all([
      this.loadMarkets(),
      bybit<{ list: Ticker[] }>('/tickers?category=linear')
        .then((r) => new Map(r.list.map((t) => [t.symbol, t])))
        .catch(() => new Map<string, Ticker>()),
    ]);
    const q = query.trim().toUpperCase();
    const volume = (m: Market) => Number(tickers.get(m.symbol)?.turnover24h ?? 0);
    // Forex first, then commodities, ETFs and stocks; busiest first within each.
    const list = [...markets.values()].sort((a, b) => KINDS.indexOf(a.kind as never) - KINDS.indexOf(b.kind as never) || volume(b) - volume(a));
    const match = (m: Market) => !q || m.symbol.includes(q) || m.name.toUpperCase().includes(q);
    const starts = list.filter((m) => q && m.symbol.startsWith(q));
    const rest = list.filter((m) => match(m) && !starts.includes(m));
    return [...starts, ...rest].slice(0, 50).map((m) => {
      const t = tickers.get(m.symbol);
      return { symbol: m.symbol, name: m.name, detail: t?.price24hPcnt ? pctText(Number(t.price24hPcnt) * 100) : undefined };
    });
  }

  watchQuotes(symbols: string[], onQuote: (q: Quote) => void): () => void {
    const list = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (list.length === 0) return () => {};
    let decimals = new Map<string, number | undefined>();
    // Ticker messages after the first only carry the fields that changed: keep the rest.
    const last = new Map<string, { price?: number; pct?: number }>();
    const emit = (symbol: string) => {
      const s = last.get(symbol);
      if (s?.price === undefined) return;
      onQuote({ symbol, price: s.price, changePct: (s.pct ?? 0) * 100, decimals: decimals.get(symbol) });
    };
    void this.loadMarkets()
      .then((m) => {
        decimals = new Map(list.map((s) => [s, m.get(s)?.decimals]));
        list.forEach(emit);
      })
      .catch(() => {});

    return liveSocket(WS_URL, {
      ping: JSON.stringify({ op: 'ping' }),
      onOpen: (ws) => {
        // At most 10 topics per subscribe message.
        for (let i = 0; i < list.length; i += 10) {
          ws.send(JSON.stringify({ op: 'subscribe', args: list.slice(i, i + 10).map((s) => `tickers.${s}`) }));
        }
      },
      onMessage: (msg) => {
        const m = msg as { topic?: string; data?: Ticker };
        if (!m.topic?.startsWith('tickers.') || !m.data) return;
        const s = last.get(m.data.symbol) ?? {};
        if (m.data.lastPrice !== undefined) s.price = Number(m.data.lastPrice);
        if (m.data.price24hPcnt !== undefined) s.pct = Number(m.data.price24hPcnt);
        last.set(m.data.symbol, s);
        if (m.data.lastPrice !== undefined || m.data.price24hPcnt !== undefined) emit(m.data.symbol);
      },
    });
  }

  subscribe(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void {
    const topic = `kline.${INTERVALS[tf]}.${symbol.toUpperCase()}`;
    return liveSocket(WS_URL, {
      ping: JSON.stringify({ op: 'ping' }),
      onOpen: (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [topic] })),
      onMessage: (msg) => {
        const m = msg as { topic?: string; data?: { start: number; open: string; high: string; low: string; close: string; volume: string }[] };
        if (m.topic !== topic || !m.data) return;
        for (const k of m.data) {
          onCandle({
            time: Math.floor(k.start / 1000),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
          });
        }
      },
    });
  }
}
