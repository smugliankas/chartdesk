import type { Candle, Timeframe } from '../types';
import type { DataProvider, SymbolInfo } from './types';

// Binance's public market-data-only endpoints. No API key or account needed.
const REST_URL = 'https://data-api.binance.vision/api/v3';
const WS_URL = 'wss://data-stream.binance.vision/ws';
const PAGE_SIZE = 1000;

type KlineRow = [number, string, string, string, string, string, ...unknown[]];

interface KlineMessage {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string };
}

interface MiniTicker {
  symbol: string;
  openPrice: string;
  lastPrice: string;
  quoteVolume: string;
  count: number;
}

export class BinanceProvider implements DataProvider {
  readonly id = 'binance';
  readonly name = 'Binance (crypto)';
  readonly freeSymbolInput = true;

  private symbolList: Promise<{ symbol: string; change: number }[]> | null = null;

  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    return this.klines(symbol, tf);
  }

  getCandlesBefore(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]> {
    return this.klines(symbol, tf, beforeTime * 1000 - 1);
  }

  private async klines(symbol: string, tf: Timeframe, endTimeMs?: number): Promise<Candle[]> {
    let url = `${REST_URL}/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${tf}&limit=${PAGE_SIZE}`;
    if (endTimeMs !== undefined) url += `&endTime=${endTimeMs}`;
    const rows = await getJson<KlineRow[]>(url);
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }

  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    // One request for the whole list (sorted by 24h volume), cached for the session.
    this.symbolList ??= getJson<MiniTicker[]>(`${REST_URL}/ticker/24hr?type=MINI`)
      .then((rows) =>
        rows
          .filter((r) => r.count > 0)
          .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
          .map((r) => ({
            symbol: r.symbol,
            change: Number(r.openPrice) > 0 ? (Number(r.lastPrice) / Number(r.openPrice) - 1) * 100 : 0,
          })),
      )
      .catch((err: unknown) => {
        this.symbolList = null; // try again next time
        throw err;
      });

    const list = await this.symbolList;
    const q = query.trim().toUpperCase();
    const starts = q ? list.filter((s) => s.symbol.startsWith(q)) : list;
    const contains = q ? list.filter((s) => !s.symbol.startsWith(q) && s.symbol.includes(q)) : [];
    return [...starts, ...contains].slice(0, 50).map((s) => ({
      symbol: s.symbol,
      detail: `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%`,
    }));
  }

  subscribe(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(`${WS_URL}/${symbol.toLowerCase()}@kline_${tf}`);
      ws.onmessage = (ev) => {
        attempt = 0;
        const k = (JSON.parse(String(ev.data)) as KlineMessage).k;
        if (!k) return;
        onCandle({
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        // Reconnect with exponential backoff, capped at 30 s.
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { msg?: string };
      if (body.msg) detail = body.msg;
    } catch {
      /* ignore */
    }
    throw new Error(`Binance: ${detail}`);
  }
  return (await res.json()) as T;
}
