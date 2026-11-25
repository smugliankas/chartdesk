import { describe, expect, it } from 'vitest';
import { alertPriceAt, alertTarget, type PriceAlert } from '../src/alerts/AlertManager';

const base: PriceAlert = { id: 'a', providerId: 'binance', symbol: 'BTCUSDT', price: 100, priceText: '100.00', createdAt: 0 };

describe('alert levels', () => {
  it('is flat for a price alert', () => {
    expect(alertPriceAt(base, 0)).toBe(100);
    expect(alertPriceAt(base, 1e9)).toBe(100);
    expect(alertTarget(base)).toBe('100.00');
  });

  it('follows a sloped line over time, also past its end points', () => {
    const a: PriceAlert = { ...base, line: { kind: 'trend', p1: { time: 0, price: 100 }, p2: { time: 100, price: 200 } } };
    expect(alertPriceAt(a, 50)).toBe(150);
    expect(alertPriceAt(a, 200)).toBe(300);
    expect(alertPriceAt(a, -100)).toBe(0);
    expect(alertTarget(a)).toBe('trend line');
  });

  it('does not divide by zero for a vertical line', () => {
    const a: PriceAlert = { ...base, line: { kind: 'ray', p1: { time: 5, price: 10 }, p2: { time: 5, price: 20 } } };
    expect(alertPriceAt(a, 99)).toBe(10);
  });
});
