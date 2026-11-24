import type { Candle, Timeframe } from '../types';
import type { DataProvider } from './types';

// Binance's public market-data-only endpoints. No API key or account needed.
const REST_URL = 'https://data-api.binance.vision/api/v3/klines';
const WS_URL = 'wss://data-stream.binance.vision/ws';

type KlineRow = [number, string, string, string, string, string, ...unknown[]];

interface KlineMessage {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string };
}

export class BinanceProvider implements DataProvider {
  readonly id = 'binance';
  readonly name = 'Binance (crypto)';
  readonly freeSymbolInput = true;

  async getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    const url = `${REST_URL}?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${tf}&limit=1000`;
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
    const rows = (await res.json()) as KlineRow[];
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
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
