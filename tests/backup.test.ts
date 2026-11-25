import { describe, expect, it } from 'vitest';
import { collectBackup, parseBackup, restoreBackup, summarize } from '../src/backup';

/** A minimal in-memory Storage. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const line = (id: string) => ({ id, type: 'hline', price: 1 });

describe('backup', () => {
  it('exports only ChartDesk data, and renames keys from the old project name', () => {
    const storage = memoryStorage({
      'chartdesk:drawings:binance:BTCUSDT': JSON.stringify([line('a'), line('b')]),
      'chart-app:drawings:binance:ETHUSDT': JSON.stringify([line('c')]),
      'chartdesk:alerts': JSON.stringify([{ id: 'x' }]),
      'chartdesk:settings': '{}',
      'someone-else': 'secret',
    });
    const backup = collectBackup(storage, new Date('2026-11-25T01:00:00Z'));
    expect(Object.keys(backup.data).sort()).toEqual([
      'chartdesk:alerts',
      'chartdesk:drawings:binance:BTCUSDT',
      'chartdesk:drawings:binance:ETHUSDT',
      'chartdesk:settings',
    ]);
    expect(summarize(backup)).toEqual({
      drawingSymbols: ['binance:BTCUSDT', 'binance:ETHUSDT'],
      drawings: 3,
      alerts: 1,
      hasSettings: true,
    });
  });

  it('round-trips through a file and keeps drawings of other symbols', () => {
    const source = memoryStorage({ 'chartdesk:drawings:binance:BTCUSDT': JSON.stringify([line('a')]) });
    const text = JSON.stringify(collectBackup(source));

    const target = memoryStorage({
      'chartdesk:drawings:binance:BTCUSDT': JSON.stringify([line('old')]),
      'chartdesk:drawings:csv:EURUSD': JSON.stringify([line('keep')]),
    });
    restoreBackup(parseBackup(text), target);
    expect(JSON.parse(target.getItem('chartdesk:drawings:binance:BTCUSDT')!)).toEqual([line('a')]);
    expect(JSON.parse(target.getItem('chartdesk:drawings:csv:EURUSD')!)).toEqual([line('keep')]);
  });

  it('refuses files that are not backups, and never writes foreign keys', () => {
    expect(() => parseBackup('not json')).toThrow(/not a ChartDesk backup/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a ChartDesk backup/);
    expect(() => parseBackup('{"format":"chartdesk-backup","version":9,"data":{}}')).toThrow(/newer version/);
    const b = parseBackup('{"format":"chartdesk-backup","version":1,"data":{"chartdesk:alerts":"[]","other":"x","chartdesk:n":5}}');
    expect(Object.keys(b.data)).toEqual(['chartdesk:alerts']);
  });
});
