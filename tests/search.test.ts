import { describe, expect, it } from 'vitest';
import { mergeResults } from '../src/providers/search';

const s = (symbol: string, source: string) => ({ symbol, source });
const names = (list: { symbol: string; source?: string }[]) => list.map((i) => `${i.symbol}@${i.source}`);

describe('mergeResults (symbol search across sources)', () => {
  it('puts exact matches first, then prefixes, then the rest, taking turns between sources', () => {
    const binance = [s('XAUTUSDT', 'A'), s('XAIUSDT', 'A')];
    const bybit = [s('XAUUSDT', 'B'), s('GDXUSDT', 'B')];
    const binTf = [s('XAUUSDT', 'C')];
    expect(names(mergeResults('xau', [binance, bybit, binTf]))).toEqual([
      'XAUUSDT@B',
      'XAUUSDT@C',
      'XAUTUSDT@A',
      'XAIUSDT@A',
      'GDXUSDT@B',
    ]);
  });

  it("doesn't let one source with many matches push the others off the list", () => {
    const many = Array.from({ length: 80 }, (_, i) => s(`A${i}USDT`, 'A'));
    const merged = mergeResults('a', [many, [s('AAPLUSDT', 'B')]]);
    expect(merged.length).toBe(60);
    expect(names(merged).slice(0, 3)).toEqual(['A0USDT@A', 'AAPLUSDT@B', 'A1USDT@A']);
  });

  it('with an empty box shows the first source, then a few of each other', () => {
    const a = Array.from({ length: 30 }, (_, i) => s(`A${i}`, 'A'));
    const b = Array.from({ length: 30 }, (_, i) => s(`B${i}`, 'B'));
    const merged = mergeResults('  ', [a, b]);
    expect(merged.length).toBe(30);
    expect(merged[19].symbol).toBe('A19');
    expect(merged[20].symbol).toBe('B0');
  });
});
