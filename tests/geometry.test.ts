import { describe, expect, it } from 'vitest';
import { distToSegment, extendSegment, handlesOf, moveHandle, moveWhole } from '../src/drawings/geometry';
import type { Drawing, Position, TrendLine } from '../src/drawings/model';

const long: Position = {
  id: 'p',
  type: 'long',
  entry: { time: 1000, price: 100 },
  tp: 110,
  sl: 95,
  endTime: 5000,
} as Position;

const line: TrendLine = { id: 't', type: 'trend', p1: { time: 0, price: 1 }, p2: { time: 10, price: 2 } } as TrendLine;

describe('moveHandle on positions (TradingView behaviour)', () => {
  it('moves the entry price and start time together', () => {
    const d = moveHandle(long, 'entry', { time: 2000, price: 102 }) as Position;
    expect(d.entry).toEqual({ time: 2000, price: 102 });
    expect(d.tp).toBe(110);
    expect(d.sl).toBe(95);
  });

  it('keeps the entry between stop and target, and before the end', () => {
    const d = moveHandle(long, 'entry', { time: 9000, price: 200 }) as Position;
    expect(d.entry.price).toBeLessThan(110);
    expect(d.entry.time).toBe(5000);
  });

  it('moves target and stop in price only, never across the entry', () => {
    const tp = moveHandle(long, 'tp', { time: 4000, price: 90 }) as Position;
    expect(tp.tp).toBeGreaterThan(100);
    expect(tp.entry.time).toBe(1000);
    const sl = moveHandle(long, 'sl', { time: 4000, price: 120 }) as Position;
    expect(sl.sl).toBeLessThan(100);
  });

  it('mirrors the limits for a short', () => {
    const short = { ...long, type: 'short', tp: 90, sl: 105 } as Position;
    expect((moveHandle(short, 'tp', { time: 0, price: 150 }) as Position).tp).toBeLessThan(100);
    expect((moveHandle(short, 'sl', { time: 0, price: 50 }) as Position).sl).toBeGreaterThan(100);
  });

  it('moves the right edge in time only, not before the entry', () => {
    expect((moveHandle(long, 'end', { time: 8000, price: 1 }) as Position).endTime).toBe(8000);
    expect((moveHandle(long, 'end', { time: 10, price: 1 }) as Position).endTime).toBe(1000);
  });
});

describe('handles and moving', () => {
  it('gives two handles to lines and four to positions', () => {
    expect(handlesOf(line).map((h) => h.part)).toEqual(['p1', 'p2']);
    expect(handlesOf(long).map((h) => h.part)).toEqual(['entry', 'tp', 'sl', 'end']);
    expect(handlesOf({ id: 'h', type: 'hline', price: 1 } as Drawing)).toEqual([]);
  });

  it('moves a whole drawing in time and price', () => {
    const moved = moveWhole(line, (t) => t + 5, 0.5) as TrendLine;
    expect(moved.p1).toEqual({ time: 5, price: 1.5 });
    expect(moved.p2).toEqual({ time: 15, price: 2.5 });
    const pos = moveWhole(long, (t) => t + 1, -1) as Position;
    expect([pos.entry.price, pos.tp, pos.sl, pos.endTime]).toEqual([99, 109, 94, 5001]);
  });
});

describe('segment helpers', () => {
  it('extends a ray forward and an extended line both ways', () => {
    expect(extendSegment(0, 0, 10, 0, 100, false)).toEqual([0, 0, 110, 0]);
    expect(extendSegment(0, 0, 10, 0, 100, true)).toEqual([-100, 0, 110, 0]);
    expect(extendSegment(5, 5, 5, 5, 100, true)).toEqual([5, 5, 5, 5]);
  });

  it('measures the distance from a point to a segment', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(13, 4, 0, 0, 10, 0)).toBe(5); // past the end → distance to the end point
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});
