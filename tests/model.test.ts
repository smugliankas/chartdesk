import { describe, expect, it } from 'vitest';
import { FIB_LEVELS, fibLevelsOf, fibPrice, fibShowsTrendLine, formatDuration, isStraightLineType, type FibRetracement } from '../src/drawings/model';

const fib = { id: 'f', type: 'fib', p1: { time: 0, price: 100 }, p2: { time: 10, price: 200 } } as FibRetracement;

describe('Fibonacci retracement', () => {
  it('puts level 0 at the end point and 1 at the start point', () => {
    expect(fibPrice(fib, 0)).toBe(200);
    expect(fibPrice(fib, 1)).toBe(100);
    expect(fibPrice(fib, 0.5)).toBe(150);
    expect(fibPrice(fib, 0.618)).toBeCloseTo(138.2);
  });

  it('uses the default levels unless the drawing has its own', () => {
    expect(fibLevelsOf(fib)).toBe(FIB_LEVELS);
    expect(fibLevelsOf({ ...fib, levels: [0, 1] })).toEqual([0, 1]);
  });

  it('shows the diagonal line unless it was turned off', () => {
    expect(fibShowsTrendLine(fib)).toBe(true);
    expect(fibShowsTrendLine({ ...fib, trendLine: false })).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0m'],
    [59 * 60, '59m'],
    [3600, '1h'],
    [3600 + 25 * 60, '1h 25m'],
    [86400, '1d'],
    [2 * 86400 + 3 * 3600, '2d 3h'],
    [-7200, '2h'],
  ])('%i s → %s', (s, text) => expect(formatDuration(s)).toBe(text));
});

describe('isStraightLineType', () => {
  it('is true only for lines that Shift can snap', () => {
    expect(['trend', 'ray', 'extended'].every((t) => isStraightLineType(t as 'trend'))).toBe(true);
    expect(isStraightLineType('rect')).toBe(false);
    expect(isStraightLineType('fib')).toBe(false);
  });
});
