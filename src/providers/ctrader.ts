import type { Candle, Timeframe } from '../types';
import type { BrokerAccount, DataProvider, Quote, SymbolInfo } from './types';

// cTrader Open API (Spotware), JSON over WebSocket: prices from the person's own broker.
// Desktop app only: signing in needs the app's secret and a local redirect (see src-tauri/src/ctrader.rs).
// Message numbers and fields: https://github.com/spotware/openapi-proto-messages

const HOSTS = { demo: 'wss://demo.ctraderapi.com:5036', live: 'wss://live.ctraderapi.com:5036' };
const STORAGE_KEY = 'chartdesk:ctrader';
const HEARTBEAT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * cTrader allows about 5 history requests a second (fewer in practice), so they go one at a
 * time, this far apart; when cTrader still says "too many", the request waits and goes again.
 */
const HISTORY_GAP_MS = 300;
const HISTORY_RETRY_MS = 1000;
const HISTORY_RETRIES = 3;
/** Bars asked for per request, counting back from its end time. */
const PAGE_SIZE = 1000;

/** ProtoOAPayloadType and ProtoPayloadType numbers used here. */
export const PT = {
  ERROR: 50,
  HEARTBEAT: 51,
  APP_AUTH_REQ: 2100,
  APP_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  UNSUBSCRIBE_SPOTS_RES: 2130,
  SPOT_EVENT: 2131,
  SUBSCRIBE_LIVE_TRENDBAR_REQ: 2135,
  UNSUBSCRIBE_LIVE_TRENDBAR_REQ: 2136,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  OA_ERROR: 2142,
  TOKEN_INVALIDATED: 2147,
  CLIENT_DISCONNECT: 2148,
  ACCOUNTS_BY_TOKEN_REQ: 2149,
  ACCOUNTS_BY_TOKEN_RES: 2150,
  SUBSCRIBE_LIVE_TRENDBAR_RES: 2165,
  UNSUBSCRIBE_LIVE_TRENDBAR_RES: 2166,
  REFRESH_TOKEN_REQ: 2173,
  REFRESH_TOKEN_RES: 2174,
} as const;

/** ProtoOATrendbarPeriod for each of our timeframes. */
export const PERIODS: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 7, '30m': 8, '1h': 9, '4h': 10, '1d': 12, '1w': 13, '1M': 14 };

const PERIOD_NAMES: Record<string, number> = {
  M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M10: 6, M15: 7, M30: 8, H1: 9, H4: 10, H12: 11, D1: 12, W1: 13, MN1: 14,
};

/**
 * A trendbar's period as a number. The JSON API may send the enum's name ("H1") or its number,
 * and leaves it out for the default, M1.
 */
export function periodOf(tb: RawTrendbar): number {
  const p = tb.period;
  if (p === undefined) return 1;
  return typeof p === 'number' ? p : (PERIOD_NAMES[p] ?? -1);
}

/** Length of a bar in seconds, by period (a month counts as 31 days). */
const PERIOD_SECONDS: Record<number, number> = {
  1: 60, 2: 120, 3: 180, 4: 240, 5: 300, 6: 600, 7: 900, 8: 1800, 9: 3600, 10: 14_400, 11: 43_200, 12: 86_400, 13: 604_800, 14: 2_678_400,
};

/** The longest time range one trendbar request may cover, by period (from Spotware's own SDK). */
export function maxRangeMs(period: number): number {
  if (period <= 5) return 302_400_000; // M1–M5: 3.5 days
  if (period <= 9) return 21_168_000_000; // M10–H1: 245 days
  if (period <= 12) return 31_622_400_000; // H4–D1: 366 days
  return 158_112_000_000; // W1, MN1: about 5 years
}

/** A bar as the API sends it: prices in 1/100000, as a low plus deltas. */
export interface RawTrendbar {
  volume?: number;
  period?: number | string;
  low?: number;
  deltaOpen?: number;
  deltaClose?: number;
  deltaHigh?: number;
  utcTimestampInMinutes?: number;
}

export function toCandle(tb: RawTrendbar, digits: number): Candle {
  const low = tb.low ?? 0;
  const price = (v: number) => Number((v / 100000).toFixed(digits));
  return {
    time: (tb.utcTimestampInMinutes ?? 0) * 60,
    open: price(low + (tb.deltaOpen ?? 0)),
    high: price(low + (tb.deltaHigh ?? 0)),
    low: price(low),
    close: price(low + (tb.deltaClose ?? 0)),
    volume: tb.volume ?? 0,
  };
}

/** "EUR/USD", "eurusd" → "EURUSD": brokers name symbols differently. */
export function normalizeSymbol(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

interface Stored {
  accessToken: string;
  refreshToken: string;
  /** Unix ms when the access token runs out. */
  expiresAt: number;
  accountId?: number;
  isLive?: boolean;
  broker?: string;
  login?: number;
}

interface LightSymbol {
  symbolId: number;
  symbolName?: string;
  enabled?: boolean;
  description?: string;
  sortingNumber?: number;
}

interface SpotEvent {
  symbolId: number;
  bid?: number;
  ask?: number;
  sessionClose?: number;
  trendbar?: RawTrendbar[];
}

/** What the provider needs from the outside world; tests pass fakes. */
export interface CTraderDeps {
  /** The Open API app's id and secret, or null when this build has none. */
  app(): Promise<{ clientId: string; clientSecret: string } | null>;
  /** Signs in through the browser and returns new tokens. */
  login(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
  createSocket(url: string): WebSocket;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  hosts?: { demo: string; live: string };
}

export class CTraderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NOT_CONNECTED = 'Connect your cTrader account first: the Connect button next to the symbol.';

export class CTraderProvider implements DataProvider {
  readonly id = 'ctrader';
  readonly name = 'cTrader (your broker)';
  readonly description = "Prices from your own broker through cTrader. Sign in with your cTrader ID; a free demo account works. Desktop app only.";
  readonly freeSymbolInput = true;
  readonly defaultSymbol = 'EURUSD';
  readonly account: BrokerAccount;

  private socket: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, { resolve: (p: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private msgSeq = 0;
  /** Counts charts asked for; history requests of an older one are dropped before they go. */
  private chartSeq = 0;
  private historyQueue: Promise<unknown> = Promise.resolve();
  private lastHistoryAt = 0;
  /** The bar being made, as built for the chart's history ("symbol:timeframe"). */
  private formingCache = new Map<string, Candle>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelay = 1000;
  private symbolList: Promise<LightSymbol[]> | null = null;
  private digits = new Map<number, number>();
  /** Live spot subscriptions by symbol id, counted; and live bar subscriptions "symbolId:period", counted. */
  private spotSubs = new Map<number, number>();
  private barSubs = new Map<string, number>();
  private spotListeners = new Set<(e: SpotEvent) => void>();
  private stateListeners = new Set<() => void>();

  constructor(private readonly deps: CTraderDeps) {
    const self = this;
    this.account = {
      isConnected: () => this.stored() !== null,
      label: () => {
        const s = this.stored();
        if (!s?.accountId) return null;
        return `${s.broker ?? 'cTrader'} ${s.login ?? s.accountId}${s.isLive ? '' : ' (demo)'}`;
      },
      async connect() {
        const t = await self.deps.login();
        self.store({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 });
        self.resetConnection();
        await self.ensureReady();
        self.emitState();
      },
      disconnect() {
        self.deps.storage.removeItem(STORAGE_KEY);
        self.resetConnection();
        self.emitState();
      },
      onChange(fn) {
        self.stateListeners.add(fn);
      },
    };
  }

  // --- DataProvider -----------------------------------------------------------------

  async getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    // A new chart: history requests still waiting for an older one are dropped.
    const seq = ++this.chartSeq;
    // cTrader's history ends with the last finished bar; the one being made comes with the first
    // live message, a moment later. So it is built here at once from the smaller bars under it.
    const [bars, forming] = await Promise.all([this.bars(symbol, tf, Date.now(), seq), this.formingBar(symbol, tf, seq).catch(() => null)]);
    const last = bars.at(-1);
    let bar = forming;
    if (bar && last && last.time % PERIOD_SECONDS[PERIODS[tf]] !== 0) bar = null; // the broker's bars sit elsewhere on the clock
    // Weeks and months start where the broker says: the bar after its last one.
    if (!bar && last && (tf === '1w' || tf === '1M')) bar = await this.barAfter(symbol, tf, last, seq).catch(() => null);
    if (bar && (!last || bar.time > last.time)) bars.push(bar);
    else if (bar && last && bar.time === last.time) bars[bars.length - 1] = bar;
    if (bar) this.formingCache.set(`${symbol}:${tf}`, bar);
    return bars;
  }

  /**
   * The bar still being made, from the 1-minute bars since it started (5-minute bars for a day).
   * Not for 1-minute charts (nothing smaller); weeks and months: see barAfter.
   */
  private formingBar(symbol: string, tf: Timeframe, seq: number): Promise<Candle | null> {
    const lower: Partial<Record<Timeframe, number>> = { '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1, '1d': 5 };
    const sub = lower[tf];
    if (!sub) return Promise.resolve(null);
    const len = PERIOD_SECONDS[PERIODS[tf]];
    return this.joinBars(symbol, sub, Math.floor(Date.now() / 1000 / len) * len, seq);
  }

  /** The week or month after `last` (the broker's last finished one), from its daily bars. */
  private barAfter(symbol: string, tf: '1w' | '1M', last: Candle, seq: number): Promise<Candle | null> {
    let start: number;
    if (tf === '1w') start = last.time + 7 * 86_400;
    else {
      const d = new Date(last.time * 1000);
      start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()) / 1000;
    }
    if (start * 1000 > Date.now()) return Promise.resolve(null);
    return this.joinBars(symbol, 12, start, seq);
  }

  /** One bar starting at `start` (seconds), made of the `sub`-period bars since then. */
  private async joinBars(symbol: string, sub: number, start: number, seq: number): Promise<Candle | null> {
    const s = await this.find(symbol);
    const digits = await this.digitsOf(s.symbolId);
    const res = await this.history(
      {
        ctidTraderAccountId: this.accountId(),
        symbolId: s.symbolId,
        period: sub,
        fromTimestamp: start * 1000,
        toTimestamp: Date.now(),
        count: PAGE_SIZE,
      },
      seq,
    );
    const parts = ((res.trendbar as RawTrendbar[] | undefined) ?? [])
      .map((tb) => toCandle(tb, digits))
      .filter((c) => c.time >= start)
      .sort((a, b) => a.time - b.time);
    if (parts.length === 0) return null;
    return {
      time: start,
      open: parts[0].open,
      high: Math.max(...parts.map((c) => c.high)),
      low: Math.min(...parts.map((c) => c.low)),
      close: parts[parts.length - 1].close,
      volume: parts.reduce((sum, c) => sum + (c.volume ?? 0), 0),
    };
  }

  getCandlesBefore(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]> {
    return this.bars(symbol, tf, beforeTime * 1000 - 1, this.chartSeq);
  }

  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    const list = await this.symbols();
    const q = normalizeSymbol(query);
    const text = query.trim().toUpperCase();
    const name = (s: LightSymbol) => normalizeSymbol(s.symbolName ?? '');
    const starts = list.filter((s) => q && name(s).startsWith(q));
    const rest = list.filter((s) => !starts.includes(s) && (!q || name(s).includes(q) || (text && (s.description ?? '').toUpperCase().includes(text))));
    return [...starts, ...rest].slice(0, 50).map((s) => ({ symbol: name(s), name: s.description }));
  }

  subscribe(symbol: string, tf: Timeframe, onCandle: (candle: Candle) => void): () => void {
    let stopped = false;
    let undo: (() => void) | null = null;
    void (async () => {
      const s = await this.find(symbol);
      const digits = await this.digitsOf(s.symbolId);
      if (stopped) return;
      const period = PERIODS[tf];
      // The live bar comes without a close: its close is the latest bid. The bar itself comes when
      // it opens (and now and then); every bid in between moves its close, high and low. Until the
      // first one arrives, the newest bar from the history stands in for it.
      let bar: Candle | null = null;
      let bid: number | undefined;
      let seeding = false;
      const len = PERIOD_SECONDS[period];
      const emit = () => {
        if (!bar || stopped) return;
        if (bid !== undefined) bar.close = bid;
        bar.high = Math.max(bar.high, bar.close);
        bar.low = Math.min(bar.low, bar.close);
        onCandle({ ...bar });
      };
      const listener = (e: SpotEvent) => {
        if (e.symbolId !== s.symbolId) return;
        if (e.bid !== undefined) bid = Number((e.bid / 100000).toFixed(digits));
        const tb = (e.trendbar ?? []).find((t) => periodOf(t) === period);
        if (tb) {
          const c = toCandle(tb, digits);
          // The same bar again keeps the extremes the bids already reached.
          const same = bar !== null && bar.time === c.time;
          bar = same ? { ...c, high: Math.max(c.high, bar!.high), low: Math.min(c.low, bar!.low) } : c;
          if (tb.deltaClose === undefined && bid === undefined) bar.close = c.open;
          emit();
        } else if (e.bid !== undefined) {
          const now = Date.now() / 1000;
          // Up to an hour, bars start on the clock: a bid after the bar's end opens the next one,
          // should the new bar itself be late.
          if (bar && period <= 9 && now >= bar.time + len && bid !== undefined) {
            const time = Math.floor(now / len) * len;
            bar = { time, open: bid, high: bid, low: bid, close: bid, volume: 0 };
          }
          if (bar) emit();
          else if (!seeding) {
            seeding = true;
            // The bar the chart got with its history, while it is still the one being made.
            const cached = this.formingCache.get(`${symbol}:${tf}`);
            void Promise.resolve(cached && cached.time + len > Date.now() / 1000 ? cached : null)
              .then((forming) => {
                if (forming && !bar) bar = { ...forming };
                emit();
              })
              .catch(() => {})
              .finally(() => (seeding = false));
          }
        }
      };
      this.spotListeners.add(listener);
      await this.addSpots(s.symbolId);
      await this.addBars(s.symbolId, period);
      undo = () => {
        this.spotListeners.delete(listener);
        void this.removeBars(s.symbolId, period).then(() => this.removeSpots(s.symbolId));
      };
      if (stopped) undo();
    })().catch(() => {
      /* not connected or unknown symbol: the chart shows the error from getCandles */
    });
    return () => {
      stopped = true;
      undo?.();
      undo = null;
    };
  }

  watchQuotes(symbols: string[], onQuote: (q: Quote) => void): () => void {
    let stopped = false;
    const undo: (() => void)[] = [];
    void (async () => {
      const found = (await Promise.all(symbols.map((s) => this.find(s).catch(() => null)))).filter((s): s is LightSymbol => s !== null);
      if (stopped || found.length === 0) return;
      const byId = new Map(found.map((s) => [s.symbolId, normalizeSymbol(s.symbolName ?? '')]));
      await this.digitsOf(...byId.keys()).catch(() => 0);
      const last = new Map<number, { bid?: number; close?: number }>();
      const listener = (e: SpotEvent) => {
        const sym = byId.get(e.symbolId);
        if (!sym) return;
        const q = last.get(e.symbolId) ?? {};
        if (e.bid !== undefined) q.bid = e.bid;
        if (e.sessionClose !== undefined) q.close = e.sessionClose;
        last.set(e.symbolId, q);
        if (q.bid === undefined) return;
        const digits = this.digits.get(e.symbolId);
        onQuote({ symbol: sym, price: q.bid / 100000, changePct: q.close ? (q.bid / q.close - 1) * 100 : 0, decimals: digits });
      };
      this.spotListeners.add(listener);
      undo.push(() => this.spotListeners.delete(listener));
      for (const id of byId.keys()) {
        await this.addSpots(id);
        undo.push(() => void this.removeSpots(id));
      }
      if (stopped) undo.splice(0).forEach((fn) => fn());
    })().catch(() => {});
    return () => {
      stopped = true;
      undo.splice(0).forEach((fn) => fn());
    };
  }

  // --- history ------------------------------------------------------------------------

  private async bars(symbol: string, tf: Timeframe, to: number, seq: number): Promise<Candle[]> {
    const s = await this.find(symbol);
    const digits = await this.digitsOf(s.symbolId);
    const period = PERIODS[tf];
    const range = maxRangeMs(period);
    // A range can fall on a weekend or holiday with no bars: step further back a few times.
    for (let tries = 0, end = to; tries < 6; tries++, end -= range) {
      const res = await this.history(
        {
          ctidTraderAccountId: this.accountId(),
          symbolId: s.symbolId,
          period,
          fromTimestamp: Math.max(0, end - range),
          toTimestamp: end,
          count: PAGE_SIZE,
        },
        seq,
      );
      const bars = ((res.trendbar as RawTrendbar[] | undefined) ?? []).map((tb) => toCandle(tb, digits));
      if (bars.length > 0) return bars.sort((a, b) => a.time - b.time);
      if (end - range <= 0) break;
    }
    return [];
  }

  // --- symbols --------------------------------------------------------------------------

  private symbols(): Promise<LightSymbol[]> {
    this.symbolList ??= this.request(PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: this.accountIdOrThrow() })
      .then((res) =>
        ((res.symbol as LightSymbol[] | undefined) ?? [])
          .filter((s) => s.enabled !== false && s.symbolName)
          .sort((a, b) => (a.sortingNumber ?? 1e9) - (b.sortingNumber ?? 1e9)),
      )
      .catch((err: unknown) => {
        this.symbolList = null;
        throw err;
      });
    return this.symbolList;
  }

  private async find(symbol: string): Promise<LightSymbol> {
    const want = normalizeSymbol(symbol);
    const s = (await this.symbols()).find((x) => normalizeSymbol(x.symbolName ?? '') === want);
    if (!s) throw new Error(`cTrader: your broker has no symbol ${symbol}.`);
    return s;
  }

  /** Price decimals of symbols, asked once each. Returns the first one's. */
  private async digitsOf(...ids: number[]): Promise<number> {
    const missing = ids.filter((id) => !this.digits.has(id));
    if (missing.length > 0) {
      const res = await this.request(PT.SYMBOL_BY_ID_REQ, { ctidTraderAccountId: this.accountId(), symbolId: missing });
      for (const s of (res.symbol as { symbolId: number; digits: number }[] | undefined) ?? []) this.digits.set(s.symbolId, s.digits);
    }
    return this.digits.get(ids[0]) ?? 5;
  }

  // --- live subscriptions (counted, and sent again after a reconnect) ------------------

  private async addSpots(id: number): Promise<void> {
    const n = this.spotSubs.get(id) ?? 0;
    this.spotSubs.set(id, n + 1);
    if (n === 0) await this.request(PT.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: this.accountId(), symbolId: [id] }).catch(ignoreAlready);
  }

  private async removeSpots(id: number): Promise<void> {
    const n = (this.spotSubs.get(id) ?? 0) - 1;
    if (n > 0) return void this.spotSubs.set(id, n);
    this.spotSubs.delete(id);
    if (this.socket) await this.request(PT.UNSUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: this.accountId(), symbolId: [id] }).catch(() => {});
  }

  private async addBars(id: number, period: number): Promise<void> {
    const key = `${id}:${period}`;
    const n = this.barSubs.get(key) ?? 0;
    this.barSubs.set(key, n + 1);
    if (n === 0) await this.request(PT.SUBSCRIBE_LIVE_TRENDBAR_REQ, { ctidTraderAccountId: this.accountId(), symbolId: id, period }).catch(ignoreAlready);
  }

  private async removeBars(id: number, period: number): Promise<void> {
    const key = `${id}:${period}`;
    const n = (this.barSubs.get(key) ?? 0) - 1;
    if (n > 0) return void this.barSubs.set(key, n);
    this.barSubs.delete(key);
    if (this.socket) await this.request(PT.UNSUBSCRIBE_LIVE_TRENDBAR_REQ, { ctidTraderAccountId: this.accountId(), symbolId: id, period }).catch(() => {});
  }

  private async resubscribe(): Promise<void> {
    const ctidTraderAccountId = this.accountId();
    const spots = [...this.spotSubs.keys()];
    if (spots.length) await this.send(PT.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId, symbolId: spots }).catch(ignoreAlready);
    for (const key of this.barSubs.keys()) {
      const [symbolId, period] = key.split(':').map(Number);
      await this.send(PT.SUBSCRIBE_LIVE_TRENDBAR_REQ, { ctidTraderAccountId, symbolId, period }).catch(ignoreAlready);
    }
  }

  // --- connection -------------------------------------------------------------------------

  private stored(): Stored | null {
    try {
      const s = JSON.parse(this.deps.storage.getItem(STORAGE_KEY) ?? 'null') as Stored | null;
      return s?.accessToken ? s : null;
    } catch {
      return null;
    }
  }

  private store(s: Stored): void {
    this.deps.storage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  private accountId(): number {
    return this.stored()?.accountId ?? 0;
  }

  private accountIdOrThrow(): number {
    const id = this.stored()?.accountId;
    if (!id) throw new CTraderError('NOT_CONNECTED', NOT_CONNECTED);
    return id;
  }

  private emitState(): void {
    this.stateListeners.forEach((fn) => fn());
  }

  /** Closes the connection and forgets cached account data (after signing in or out). */
  private resetConnection(): void {
    this.symbolList = null;
    this.digits.clear();
    this.closeSocket();
  }

  private closeSocket(): void {
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);
    const ws = this.socket;
    this.socket = null;
    this.ready = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CTraderError('DISCONNECTED', 'cTrader connection closed.'));
    }
    this.pending.clear();
  }

  /** Connected and signed in to the account, ready for requests. */
  private ensureReady(): Promise<void> {
    this.ready ??= this.open().catch((err: unknown) => {
      this.closeSocket();
      throw err;
    });
    return this.ready;
  }

  private async open(): Promise<void> {
    const stored = this.stored();
    if (!stored) throw new CTraderError('NOT_CONNECTED', NOT_CONNECTED);
    const app = await this.deps.app();
    if (!app) throw new CTraderError('NOT_SET_UP', "cTrader isn't set up in this build of ChartDesk.");
    const hosts = this.deps.hosts ?? HOSTS;
    const url = stored.isLive ? hosts.live : hosts.demo;

    await new Promise<void>((resolve, reject) => {
      const ws = this.deps.createSocket(url);
      this.socket = ws;
      const unreachable = () => new CTraderError('NETWORK', `Can't reach cTrader (${new URL(url).host}). This network may be blocking it.`);
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => reject(unreachable());
      ws.onmessage = (e) => this.onMessage(String(e.data));
      ws.onclose = () => {
        if (!opened) reject(unreachable());
        this.onClose(ws);
      };
    });

    await this.send(PT.APP_AUTH_REQ, { clientId: app.clientId, clientSecret: app.clientSecret });
    let token = stored;
    if (token.expiresAt - Date.now() < 24 * 3600_000) {
      // The access token runs out within a day: get a new one.
      const res = await this.send(PT.REFRESH_TOKEN_REQ, { refreshToken: token.refreshToken });
      token = { ...token, accessToken: String(res.accessToken), refreshToken: String(res.refreshToken), expiresAt: Date.now() + Number(res.expiresIn) * 1000 };
      this.store(token);
    }
    if (!token.accountId) {
      const res = await this.send(PT.ACCOUNTS_BY_TOKEN_REQ, { accessToken: token.accessToken });
      const accounts = (res.ctidTraderAccount as { ctidTraderAccountId: number; isLive?: boolean; traderLogin?: number; brokerTitleShort?: string }[] | undefined) ?? [];
      if (accounts.length === 0) throw new CTraderError('NO_ACCOUNTS', 'This cTrader ID has no trading accounts. Open a demo account with a cTrader broker first.');
      // A demo account first: it never risks anything, and its server is the one we're on.
      const a = accounts.find((x) => !x.isLive) ?? accounts[0];
      token = { ...token, accountId: a.ctidTraderAccountId, isLive: !!a.isLive, broker: a.brokerTitleShort, login: a.traderLogin };
      this.store(token);
      if (token.isLive) {
        // Live accounts are served from the live host: start again there.
        const old = this.socket;
        this.socket = null;
        if (old) {
          old.onclose = null;
          old.close();
        }
        return this.open();
      }
    }
    await this.send(PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: token.accountId, accessToken: token.accessToken });
    this.heartbeat = setInterval(() => this.raw({ payloadType: PT.HEARTBEAT, payload: {} }), HEARTBEAT_MS);
    this.reconnectDelay = 1000;
    await this.resubscribe();
  }

  private onClose(ws: WebSocket): void {
    if (ws !== this.socket) return;
    this.closeSocket();
    this.scheduleReconnect();
  }

  /** Keeps live prices coming: reconnects (waiting longer each time) while something is subscribed. */
  private scheduleReconnect(): void {
    if (!this.stored() || (this.spotSubs.size === 0 && this.barSubs.size === 0)) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.ensureReady().catch(() => this.scheduleReconnect());
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(30_000, this.reconnectDelay * 2);
  }

  private onMessage(text: string): void {
    let msg: { payloadType?: number; payload?: Record<string, unknown>; clientMsgId?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const payload = msg.payload ?? {};
    const waiting = msg.clientMsgId ? this.pending.get(msg.clientMsgId) : undefined;
    if (waiting) {
      this.pending.delete(msg.clientMsgId!);
      clearTimeout(waiting.timer);
      if (msg.payloadType === PT.OA_ERROR || msg.payloadType === PT.ERROR) {
        const code = String(payload.errorCode ?? 'ERROR');
        if (code === 'CH_ACCESS_TOKEN_INVALID' || code === 'OA_AUTH_TOKEN_EXPIRED' || code === 'ACCESS_DENIED') this.signedOut();
        waiting.reject(new CTraderError(code, `cTrader: ${String(payload.description ?? code)}`));
      } else {
        waiting.resolve(payload);
      }
      return;
    }
    switch (msg.payloadType) {
      case PT.SPOT_EVENT:
        this.spotListeners.forEach((fn) => fn(payload as unknown as SpotEvent));
        break;
      case PT.TOKEN_INVALIDATED:
        this.signedOut();
        break;
      case PT.CLIENT_DISCONNECT:
        this.socket?.close();
        break;
    }
  }

  /** The sign-in is no longer valid: forget it, the Connect button comes back. */
  private signedOut(): void {
    this.deps.storage.removeItem(STORAGE_KEY);
    this.spotSubs.clear();
    this.barSubs.clear();
    queueMicrotask(() => {
      this.resetConnection();
      this.emitState();
    });
  }

  private raw(msg: object): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(msg));
  }

  /** Sends a message on the open socket and waits for its answer. */
  private send(payloadType: number, payload: object): Promise<Record<string, unknown>> {
    const clientMsgId = `cd${++this.msgSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(clientMsgId);
        reject(new CTraderError('TIMEOUT', 'cTrader did not answer in time.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(clientMsgId, { resolve, reject, timer });
      this.raw({ clientMsgId, payloadType, payload });
    });
  }

  /**
   * A trendbar request, in line behind the others and spaced out to stay under cTrader's limit.
   * Dropped (STALE) when a newer chart was asked for before its turn came.
   */
  private history(payload: object, seq: number): Promise<Record<string, unknown>> {
    const run = async (): Promise<Record<string, unknown>> => {
      for (let attempt = 0; ; attempt++) {
        if (seq !== this.chartSeq) throw new CTraderError('STALE', 'A newer chart was asked for.');
        const wait = this.lastHistoryAt + HISTORY_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastHistoryAt = Date.now();
        try {
          return await this.request(PT.GET_TRENDBARS_REQ, payload);
        } catch (e) {
          if (attempt >= HISTORY_RETRIES || !isRateLimit(e)) throw e;
          this.lastHistoryAt = Date.now() + HISTORY_RETRY_MS - HISTORY_GAP_MS;
        }
      }
    };
    const result = this.historyQueue.then(run, run);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  /** Like send, after connecting and signing in when needed. */
  private async request(payloadType: number, payload: object): Promise<Record<string, unknown>> {
    await this.ensureReady();
    return this.send(payloadType, payload);
  }
}

/** cTrader's "too many requests": REQUEST_FREQUENCY_EXCEEDED, "You are being rate limited". */
function isRateLimit(e: unknown): boolean {
  return e instanceof CTraderError && /FREQUENCY_EXCEEDED|rate limit/i.test(`${e.code} ${e.message}`);
}

function ignoreAlready(err: unknown): void {
  if (err instanceof CTraderError && /ALREADY_SUBSCRIBED/.test(err.code + err.message)) return;
  throw err;
}
