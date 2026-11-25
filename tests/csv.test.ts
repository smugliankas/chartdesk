import { describe, expect, it } from 'vitest';
import { CsvProvider, parseCsv } from '../src/providers/csv';

const MT5 = [
  '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>',
  '2024.01.02\t00:00:00\t1.10000\t1.10100\t1.09900\t1.10050\t120\t0\t5',
  '2024.01.02\t01:00:00\t1.10050\t1.10200\t1.10000\t1.10150\t80\t0\t5',
].join('\r\n');

describe('parseCsv', () => {
  it('reads MetaTrader 5 "Export Bars" files', () => {
    const candles = parseCsv(MT5);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({
      time: Date.UTC(2024, 0, 2) / 1000,
      open: 1.1,
      high: 1.101,
      low: 1.099,
      close: 1.1005,
      volume: 120,
    });
    expect(candles[1].time - candles[0].time).toBe(3600);
  });

  it('reads generic exports with UNIX milliseconds', () => {
    const text = 'timestamp,open,high,low,close,volume\n1704067200000,1,2,0.5,1.5,10\n';
    expect(parseCsv(text)).toEqual([{ time: 1704067200, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
  });

  it('reads ISO dates and semicolons, sorts rows and drops duplicate times', () => {
    const text = [
      'Date;Open;High;Low;Close',
      '2024-01-03;3;3;3;3',
      '2024-01-01;1;1;1;1',
      '2024-01-03;4;4;4;4',
    ].join('\n');
    const candles = parseCsv(text);
    expect(candles.map((c) => c.close)).toEqual([1, 4]);
    expect(candles[0].time).toBe(Date.UTC(2024, 0, 1) / 1000);
  });

  it('skips rows that are not numbers', () => {
    const text = 'time,open,high,low,close\n1704067200,1,1,1,1\n1704070800,x,1,1,1\n';
    expect(parseCsv(text)).toHaveLength(1);
  });

  it('explains what is wrong with a file it cannot read', () => {
    expect(() => parseCsv('just one line')).toThrow(/no data rows/);
    expect(() => parseCsv('a,b,c\n1,2,3')).toThrow(/columns/);
  });
});

describe('CsvProvider', () => {
  /** Daily bars from 2024-01-01 to 2024-03-31. */
  async function dailyFile(): Promise<{ provider: CsvProvider; symbol: string }> {
    const rows = ['date,open,high,low,close,volume'];
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2024, 3, 1); t += 86400_000) {
      const day = new Date(t).getUTCDate();
      rows.push(`${new Date(t).toISOString().slice(0, 10)},${day},${day + 1},${day - 1},${day},1`);
    }
    const provider = new CsvProvider();
    const symbol = await provider.loadFile(new File([rows.join('\n')], 'EURUSD_D1.csv'));
    return { provider, symbol };
  }

  it('names the symbol after the file and detects its timeframe', async () => {
    const { provider, symbol } = await dailyFile();
    expect(symbol).toBe('EURUSD_D1');
    expect(provider.baseTimeframe(symbol)).toBe('1d');
  });

  it('refuses timeframes below the file’s own', async () => {
    const { provider, symbol } = await dailyFile();
    await expect(provider.getCandles(symbol, '1h')).rejects.toThrow(/1D/);
  });

  it('builds weekly bars that start on Monday', async () => {
    const { provider, symbol } = await dailyFile();
    const weeks = await provider.getCandles(symbol, '1w');
    for (const w of weeks) expect(new Date(w.time * 1000).getUTCDay()).toBe(1);
  });

  it('builds calendar-month bars', async () => {
    const { provider, symbol } = await dailyFile();
    const months = await provider.getCandles(symbol, '1M');
    expect(months.map((m) => new Date(m.time * 1000).toISOString().slice(0, 10))).toEqual([
      '2024-01-01',
      '2024-02-01',
      '2024-03-01',
    ]);
    const feb = months[1];
    expect(feb.open).toBe(1); // Feb 1st
    expect(feb.close).toBe(29); // Feb 29th (leap year)
    expect(feb.high).toBe(30);
    expect(feb.low).toBe(0);
    expect(feb.volume).toBe(29);
  });
});
