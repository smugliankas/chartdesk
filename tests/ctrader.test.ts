import { describe, expect, it } from 'vitest';
import { CTraderProvider, maxRangeMs, normalizeSymbol, PERIODS, PT, toCandle } from '../src/providers/ctrader';

/** A stand-in for cTrader's JSON WebSocket server: answers the messages the provider sends. */
class FakeServer {
  sent: { payloadType: number; payload: Record<string, unknown> }[] = [];
  sockets: FakeSocket[] = [];
  accounts = [{ ctidTraderAccountId: 77, isLive: false, traderLogin: 5123456, brokerTitleShort: 'Pepperstone' }];
  symbols = [
    { symbolId: 1, symbolName: 'EURUSD', enabled: true, description: 'Euro vs US Dollar', sortingNumber: 1 },
    { symbolId: 41, symbolName: 'XAUUSD', enabled: true, description: 'Gold vs US Dollar', sortingNumber: 5 },
    { symbolId: 9, symbolName: 'OLD', enabled: false },
  ];
  /** Bars per symbol; trendbar requests get the ones inside their time range. */
  bars = new Map<number, { utcTimestampInMinutes: number; low: number; deltaOpen: number; deltaHigh: number; deltaClose: number; volume: number }[]>();
  fail: Partial<Record<number, string>> = {};

  socket(url: string): FakeSocket {
    const s = new FakeSocket(url, this);
    this.sockets.push(s);
    return s;
  }

  answer(socket: FakeSocket, msg: { clientMsgId?: string; payloadType: number; payload: Record<string, unknown> }): void {
    this.sent.push({ payloadType: msg.payloadType, payload: msg.payload });
    const reply = (payloadType: number, payload: object) => socket.receive({ clientMsgId: msg.clientMsgId, payloadType, payload });
    if (this.fail[msg.payloadType]) return reply(PT.OA_ERROR, { errorCode: this.fail[msg.payloadType], description: 'nope' });
    const p = msg.payload;
    switch (msg.payloadType) {
      case PT.APP_AUTH_REQ:
        return reply(PT.APP_AUTH_RES, {});
      case PT.ACCOUNTS_BY_TOKEN_REQ:
        return reply(PT.ACCOUNTS_BY_TOKEN_RES, { accessToken: p.accessToken, ctidTraderAccount: this.accounts });
      case PT.ACCOUNT_AUTH_REQ:
        return reply(PT.ACCOUNT_AUTH_RES, { ctidTraderAccountId: p.ctidTraderAccountId });
      case PT.REFRESH_TOKEN_REQ:
        return reply(PT.REFRESH_TOKEN_RES, { accessToken: 'new-access', refreshToken: 'new-refresh', tokenType: 'bearer', expiresIn: 2_628_000 });
      case PT.SYMBOLS_LIST_REQ:
        return reply(PT.SYMBOLS_LIST_RES, { ctidTraderAccountId: 77, symbol: this.symbols });
      case PT.SYMBOL_BY_ID_REQ:
        return reply(PT.SYMBOL_BY_ID_RES, {
          symbol: (p.symbolId as number[]).map((id) => ({ symbolId: id, digits: id === 41 ? 2 : 5, pipPosition: 4 })),
        });
      case PT.GET_TRENDBARS_REQ: {
        const all = this.bars.get(p.symbolId as number) ?? [];
        const inRange = all.filter((b) => b.utcTimestampInMinutes * 60000 >= (p.fromTimestamp as number) && b.utcTimestampInMinutes * 60000 <= (p.toTimestamp as number));
        return reply(PT.GET_TRENDBARS_RES, { period: p.period, trendbar: inRange.slice(-(p.count as number)) });
      }
      case PT.SUBSCRIBE_SPOTS_REQ:
        return reply(PT.SUBSCRIBE_SPOTS_RES, {});
      case PT.SUBSCRIBE_LIVE_TRENDBAR_REQ:
        return reply(PT.SUBSCRIBE_LIVE_TRENDBAR_RES, {});
      case PT.UNSUBSCRIBE_SPOTS_REQ:
        return reply(PT.UNSUBSCRIBE_SPOTS_RES, {});
      case PT.UNSUBSCRIBE_LIVE_TRENDBAR_REQ:
        return reply(PT.UNSUBSCRIBE_LIVE_TRENDBAR_RES, {});
    }
  }

  types(): number[] {
    return this.sent.map((m) => m.payloadType).filter((t) => t !== PT.HEARTBEAT);
  }

  spot(event: object): void {
    this.sockets.at(-1)!.receive({ payloadType: PT.SPOT_EVENT, payload: event });
  }
}

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(
    readonly url: string,
    private readonly server: FakeServer,
  ) {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(text: string): void {
    const msg = JSON.parse(text);
    setTimeout(() => this.server.answer(this, msg), 0);
  }

  receive(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function memoryStorage(initial?: object) {
  const data = new Map<string, string>(initial ? [['chartdesk:ctrader', JSON.stringify(initial)]] : []);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    get saved() {
      return JSON.parse(data.get('chartdesk:ctrader') ?? 'null');
    },
  };
}

function setup(stored?: object) {
  const server = new FakeServer();
  const storage = memoryStorage(stored);
  const provider = new CTraderProvider({
    app: async () => ({ clientId: 'id', clientSecret: 'secret' }),
    login: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 2_628_000 }),
    createSocket: (url) => server.socket(url) as unknown as WebSocket,
    storage,
    hosts: { demo: 'wss://demo.test:5036', live: 'wss://live.test:5036' },
  });
  return { server, storage, provider };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('cTrader helpers', () => {
  it('turns a trendbar (low + deltas in 1/100000) into a candle', () => {
    const c = toCandle({ utcTimestampInMinutes: 29_926_740, low: 109_465, deltaOpen: 12, deltaHigh: 40, deltaClose: 30, volume: 812 }, 5);
    expect(c).toEqual({ time: 29_926_740 * 60, open: 1.09477, high: 1.09505, low: 1.09465, close: 1.09495, volume: 812 });
  });

  it('maps timeframes to cTrader periods and knows how far one request may reach', () => {
    expect(PERIODS['1h']).toBe(9);
    expect(PERIODS['1M']).toBe(14);
    expect(maxRangeMs(PERIODS['1m'])).toBe(302_400_000);
    expect(maxRangeMs(PERIODS['1w'])).toBe(158_112_000_000);
  });

  it('matches symbols however the broker writes them', () => {
    expect(normalizeSymbol('eur/usd')).toBe('EURUSD');
    expect(normalizeSymbol('US500.cash')).toBe('US500.CASH');
  });
});

describe('cTrader provider', () => {
  it('needs signing in first', async () => {
    const { provider } = setup();
    expect(provider.account.isConnected()).toBe(false);
    await expect(provider.getCandles('EURUSD', '1h')).rejects.toThrow(/Connect your cTrader account/);
    await expect(provider.searchSymbols('eur')).rejects.toThrow(/Connect/);
  });

  it('signs in, picks the demo account and remembers it', async () => {
    const { provider, server, storage } = setup();
    server.accounts = [
      { ctidTraderAccountId: 90, isLive: true, traderLogin: 1, brokerTitleShort: 'Pepperstone' },
      { ctidTraderAccountId: 77, isLive: false, traderLogin: 5123456, brokerTitleShort: 'Pepperstone' },
    ];
    await provider.account.connect();
    expect(server.sockets[0].url).toBe('wss://demo.test:5036');
    expect(server.types()).toEqual([PT.APP_AUTH_REQ, PT.ACCOUNTS_BY_TOKEN_REQ, PT.ACCOUNT_AUTH_REQ]);
    expect(server.sent[0].payload).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(storage.saved).toMatchObject({ accessToken: 'access', accountId: 77, isLive: false, broker: 'Pepperstone', login: 5123456 });
    expect(provider.account.label()).toBe('Pepperstone 5123456 (demo)');
  });

  it('moves to the live server for a live account', async () => {
    const { provider, server } = setup();
    server.accounts = [{ ctidTraderAccountId: 90, isLive: true, traderLogin: 1, brokerTitleShort: 'IC Markets' }];
    await provider.account.connect();
    expect(server.sockets.map((s) => s.url)).toEqual(['wss://demo.test:5036', 'wss://live.test:5036']);
    expect(provider.account.label()).toBe('IC Markets 1');
  });

  it('refreshes an access token that is about to run out', async () => {
    const { provider, server, storage } = setup({ accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() + 3600_000, accountId: 77, isLive: false });
    await provider.searchSymbols('');
    expect(server.types().slice(0, 3)).toEqual([PT.APP_AUTH_REQ, PT.REFRESH_TOKEN_REQ, PT.ACCOUNT_AUTH_REQ]);
    expect(storage.saved.accessToken).toBe('new-access');
    expect(server.sent[2].payload).toEqual({ ctidTraderAccountId: 77, accessToken: 'new-access' });
  });

  it('lists the enabled symbols with their names, best matches first', async () => {
    const { provider } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    expect(await provider.searchSymbols('')).toEqual([
      { symbol: 'EURUSD', name: 'Euro vs US Dollar' },
      { symbol: 'XAUUSD', name: 'Gold vs US Dollar' },
    ]);
    expect((await provider.searchSymbols('gold')).map((s) => s.symbol)).toEqual(['XAUUSD']);
  });

  it('loads candles oldest first, with the symbol’s decimals, and steps back over a weekend', async () => {
    const { provider, server } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    const now = Math.floor(Date.now() / 60000);
    // Gold M1 bars that ended five days ago: the first request (3.5 days back) finds nothing.
    const end = now - 5 * 1440;
    server.bars.set(41, [
      { utcTimestampInMinutes: end - 1, low: 350_012_000, deltaOpen: 1000, deltaHigh: 5000, deltaClose: 3000, volume: 5 },
      { utcTimestampInMinutes: end - 2, low: 350_000_000, deltaOpen: 0, deltaHigh: 900, deltaClose: 800, volume: 7 },
    ]);
    const candles = await provider.getCandles('xauusd', '1m');
    expect(candles.map((c) => c.time)).toEqual([(end - 2) * 60, (end - 1) * 60]);
    expect(candles[1]).toMatchObject({ open: 3500.13, high: 3500.17, low: 3500.12, close: 3500.15 });
    const requests = server.sent.filter((m) => m.payloadType === PT.GET_TRENDBARS_REQ);
    expect(requests).toHaveLength(2);
    expect(requests[0].payload).toMatchObject({ ctidTraderAccountId: 77, symbolId: 41, period: 1, count: 1000 });
    // Older bars: up to just before the first bar shown.
    expect(await provider.getCandlesBefore('XAUUSD', '1m', candles[0].time)).toEqual([]);
    const older = server.sent.filter((m) => m.payloadType === PT.GET_TRENDBARS_REQ).slice(2);
    expect(older[0].payload.toTimestamp).toBe(candles[0].time * 1000 - 1);
    expect(older).toHaveLength(6); // gave up after six empty ranges: no more history
  });

  it('says so when the broker has no such symbol', async () => {
    const { provider } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    await expect(provider.getCandles('BTCUSDT', '1h')).rejects.toThrow(/no symbol BTCUSDT/);
  });

  it('streams the live bar and stops cleanly', async () => {
    const { provider, server } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    const got: number[] = [];
    const stop = provider.subscribe('EURUSD', '1h', (c) => got.push(c.close));
    await tick();
    await tick();
    expect(server.types()).toContain(PT.SUBSCRIBE_SPOTS_REQ);
    expect(server.sent.find((m) => m.payloadType === PT.SUBSCRIBE_LIVE_TRENDBAR_REQ)?.payload).toMatchObject({ symbolId: 1, period: 9 });
    server.spot({
      symbolId: 1,
      bid: 109_500,
      trendbar: [
        { period: 1, utcTimestampInMinutes: 1, low: 100_000, deltaClose: 1, volume: 1 },
        { period: 9, utcTimestampInMinutes: 60, low: 109_400, deltaClose: 100, volume: 3 },
      ],
    });
    server.spot({ symbolId: 41, trendbar: [{ period: 9, utcTimestampInMinutes: 60, low: 1, volume: 1 }] });
    expect(got).toEqual([1.095]);
    stop();
    await tick();
    await tick();
    expect(server.types().slice(-2)).toEqual([PT.UNSUBSCRIBE_LIVE_TRENDBAR_REQ, PT.UNSUBSCRIBE_SPOTS_REQ]);
  });

  it('builds the live bar like cTrader sends it: period by name, no close, bids in between', async () => {
    const { provider, server } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    const hour = Math.floor(Date.now() / 3_600_000) * 60; // this hour, in minutes
    const got: { time: number; open: number; high: number; low: number; close: number }[] = [];
    const stop = provider.subscribe('EURUSD', '1h', (c) => got.push(c));
    await tick();
    await tick();
    // The bar as it opens: period "H1", low and deltas, but no deltaClose.
    server.spot({ symbolId: 1, bid: 109_450, trendbar: [{ period: 'H1', utcTimestampInMinutes: hour, low: 109_400, deltaOpen: 20, deltaHigh: 80, volume: 3 }] });
    expect(got.at(-1)).toMatchObject({ time: hour * 60, open: 1.0942, high: 1.0948, low: 1.094, close: 1.0945 });
    // Bids alone move the close, and the high or low when they pass them.
    server.spot({ symbolId: 1, bid: 109_510 });
    expect(got.at(-1)).toMatchObject({ high: 1.0951, close: 1.0951 });
    server.spot({ symbolId: 1, bid: 109_300 });
    expect(got.at(-1)).toMatchObject({ high: 1.0951, low: 1.093, close: 1.093 });
    // The same bar sent again keeps the extremes the bids reached.
    server.spot({ symbolId: 1, bid: 109_350, trendbar: [{ period: 'H1', utcTimestampInMinutes: hour, low: 109_400, deltaOpen: 20, deltaHigh: 80, volume: 4 }] });
    expect(got.at(-1)).toMatchObject({ high: 1.0951, low: 1.093, close: 1.0935 });
    stop();
  });

  it('moves the newest bar from the history while no live bar has come yet', async () => {
    const { provider, server } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    const hour = Math.floor(Date.now() / 3_600_000) * 60;
    server.bars.set(1, [
      { utcTimestampInMinutes: hour - 60, low: 109_000, deltaOpen: 10, deltaHigh: 50, deltaClose: 20, volume: 9 },
      { utcTimestampInMinutes: hour, low: 109_100, deltaOpen: 10, deltaHigh: 50, deltaClose: 20, volume: 2 },
    ]);
    const got: { time: number; close: number; high: number }[] = [];
    const stop = provider.subscribe('EURUSD', '1h', (c) => got.push(c));
    await tick();
    await tick();
    server.spot({ symbolId: 1, bid: 109_200 });
    for (let i = 0; i < 4; i++) await tick();
    expect(got.at(-1)).toMatchObject({ time: hour * 60, close: 1.092, high: 1.092 });
    stop();
  });

  it('gives watchlist quotes with the change since the last session close', async () => {
    const { provider, server } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    const quotes: { symbol: string; price: number; changePct: number; decimals?: number }[] = [];
    const stop = provider.watchQuotes(['EURUSD', 'NOPE', 'XAUUSD'], (q) => quotes.push(q));
    for (let i = 0; i < 6; i++) await tick();
    server.spot({ symbolId: 41, bid: 352_000_000, sessionClose: 350_000_000 });
    server.spot({ symbolId: 41, ask: 352_010_000 }); // no new bid: the last one stands
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toEqual({ symbol: 'XAUUSD', price: 3520, changePct: expect.closeTo(0.5714, 3), decimals: 2 });
    stop();
  });

  it('forgets a sign-in cTrader no longer accepts', async () => {
    const { provider, server, storage } = setup({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 30 * 86400_000, accountId: 77 });
    server.fail[PT.ACCOUNT_AUTH_REQ] = 'CH_ACCESS_TOKEN_INVALID';
    let changed = 0;
    provider.account.onChange(() => changed++);
    await expect(provider.getCandles('EURUSD', '1h')).rejects.toThrow(/nope/);
    await tick();
    expect(storage.saved).toBeNull();
    expect(provider.account.isConnected()).toBe(false);
    expect(changed).toBe(1);
  });
});
