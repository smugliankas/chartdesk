import { describe, expect, it } from 'vitest';
import { barCloseTime, formatRemaining } from '../src/chart/countdown';

const utc = (...a: [number, number, number, number?]) => Date.UTC(...a) / 1000;

describe('barCloseTime', () => {
  it('adds the bar length for fixed timeframes', () => {
    expect(barCloseTime(utc(2024, 0, 1, 10), '15m')).toBe(utc(2024, 0, 1, 10) + 900);
    expect(barCloseTime(utc(2024, 0, 1), '1d')).toBe(utc(2024, 0, 2));
  });

  it('closes monthly bars at the start of the next calendar month', () => {
    expect(barCloseTime(utc(2024, 1, 1), '1M')).toBe(utc(2024, 2, 1)); // February in a leap year
    expect(barCloseTime(utc(2024, 11, 1), '1M')).toBe(utc(2025, 0, 1)); // over the year end
  });
});

describe('formatRemaining', () => {
  it.each([
    [5, '00:05'],
    [42 * 60 + 7, '42:07'],
    [3 * 3600 + 42 * 60 + 7, '03:42:07'],
    [5 * 86400 + 3 * 3600 + 42 * 60, '5d 03:42'],
    [59.9, '00:59'],
  ])('%s s → %s', (s, text) => expect(formatRemaining(s)).toBe(text));
});
