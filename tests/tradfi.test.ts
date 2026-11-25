import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceTradFiProvider } from '../src/providers/binanceTradfi';
import { BybitTradFiProvider } from '../src/providers/bybit';

/** Answers fetch() with the body returned for each URL. */
function mockFetch(answer: (url: string) => unknown): void {
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => answer(String(url)) }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Bybit TradFi', () => {
  it('returns candles oldest first and asks for bars before a time', async () => {
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      return { retCode: 0, result: { list: [
        ['7200000', '3', '4', '2', '3.5', '10', '0'],
        ['3600000', '1', '2', '0.5', '1.5', '20', '0'],
      ] } };
    });
    const p = new BybitTradFiProvider();
    const c = await p.getCandles('eurusdusdt', '1h');
    expect(c.map((x) => x.time)).toEqual([3600, 7200]);
    expect(c[1]).toEqual({ time: 7200, open: 3, high: 4, low: 2, close: 3.5, volume: 10 });
    expect(urls[0]).toContain('symbol=EURUSDUSDT');
    expect(urls[0]).toContain('interval=60');
    await p.getCandlesBefore('EURUSDUSDT', '1d', 86400);
    expect(urls[1]).toContain('interval=D');
    expect(urls[1]).toContain('end=86399999');
  });

  it('keeps only forex, commodities, stocks and ETFs, with readable names', async () => {
    const inst = (symbol: string, baseCoin: string, fullName: string, symbolType: string) => ({
      symbol, baseCoin, fullName, symbolType, status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT',
      priceFilter: { tickSize: '0.00001' },
    });
    mockFetch((url) =>
      url.includes('instruments-info')
        ? { retCode: 0, result: { nextPageCursor: '', list: [
            inst('BTCUSDT', 'BTC', '', ''),
            inst('XAUUSDT', 'XAU', 'XAU', 'commodity'),
            inst('EURUSDUSDT', 'EURUSD', 'EURUSD', 'forex'),
            inst('AAPLUSDT', 'AAPL', 'Apple', 'stock'),
          ] } }
        : { retCode: 0, result: { list: [] } },
    );
    const p = new BybitTradFiProvider();
    const all = await p.searchSymbols('');
    expect(all.map((s) => [s.symbol, s.name])).toEqual([
      ['EURUSDUSDT', 'EUR / USD'],
      ['XAUUSDT', 'Gold'],
      ['AAPLUSDT', 'Apple'],
    ]);
    expect((await p.searchSymbols('gold')).map((s) => s.symbol)).toEqual(['XAUUSDT']);
  });

  it('reports an error message from Bybit', async () => {
    mockFetch(() => ({ retCode: 10001, retMsg: 'Invalid symbol' }));
    await expect(new BybitTradFiProvider().getCandles('NOPE', '1h')).rejects.toThrow('Invalid symbol');
  });
});

describe('Binance TradFi', () => {
  it('lists only TradFi markets, named by kind', async () => {
    const sym = (symbol: string, baseAsset: string, underlyingType: string, sub: string[]) => ({
      symbol, baseAsset, underlyingType, underlyingSubType: sub, status: 'TRADING',
      filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.010' }],
    });
    mockFetch((url) =>
      url.includes('exchangeInfo')
        ? { symbols: [
            sym('BTCUSDT', 'BTC', 'COIN', ['PoW']),
            sym('XAUUSDT', 'XAU', 'COMMODITY', ['TradFi']),
            sym('NVDAUSDT', 'NVDA', 'EQUITY', ['TradFi']),
          ] }
        : [
            { symbol: 'NVDAUSDT', quoteVolume: '9', priceChangePercent: '1.5' },
            { symbol: 'XAUUSDT', quoteVolume: '5', priceChangePercent: '-2' },
          ],
    );
    const res = await new BinanceTradFiProvider().searchSymbols('');
    expect(res).toEqual([
      { symbol: 'NVDAUSDT', name: 'US stock / ETF', detail: '+1.50%' },
      { symbol: 'XAUUSDT', name: 'Gold', detail: '-2.00%' },
    ]);
  });
});
