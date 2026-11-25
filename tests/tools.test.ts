import { describe, expect, it } from 'vitest';
import { distToPolyline, handlesOf, insideChannel, moveHandle, moveWhole } from '../src/drawings/geometry';
import { formatVolume, isOnePointType, isTwoPointType, type Brush, type ParallelChannel } from '../src/drawings/model';

const channel = {
  id: 'c',
  type: 'channel',
  color: '#000',
  p1: { time: 0, price: 100 },
  p2: { time: 100, price: 120 },
  offset: 10,
} as ParallelChannel;

describe('parallel channel', () => {
  it('has handles on both lines', () => {
    expect(handlesOf(channel).map((h) => [h.part, h.point.price])).toEqual([
      ['p1', 100],
      ['p2', 120],
      ['c1', 110],
      ['c2', 130],
    ]);
  });

  it('changes only its width from the parallel line’s handles', () => {
    const wider = moveHandle(channel, 'c2', { time: 999, price: 145 }) as ParallelChannel;
    expect(wider.offset).toBe(25);
    expect(wider.p1).toEqual(channel.p1);
    expect(wider.p2).toEqual(channel.p2);
    const flipped = moveHandle(channel, 'c1', { time: 0, price: 90 }) as ParallelChannel;
    expect(flipped.offset).toBe(-10);
  });

  it('knows what is inside it on screen', () => {
    const a = { x: 0, y: 100 };
    const b = { x: 100, y: 0 };
    expect(insideChannel(50, 40, a, b, -20)).toBe(true); // between y=50 and y=30
    expect(insideChannel(50, 60, a, b, -20)).toBe(false);
    expect(insideChannel(150, 40, a, b, -20)).toBe(false); // past the end
  });
});

describe('brush', () => {
  const brush = { id: 'b', type: 'brush', color: '#000', points: [{ time: 0, price: 1 }, { time: 10, price: 2 }] } as Brush;

  it('moves every point', () => {
    const moved = moveWhole(brush, (t) => t + 5, 1) as Brush;
    expect(moved.points).toEqual([
      { time: 5, price: 2 },
      { time: 15, price: 3 },
    ]);
    expect(handlesOf(brush)).toEqual([]);
  });

  it('measures distance to its stroke', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distToPolyline(5, 2, pts)).toBe(2);
    expect(distToPolyline(12, 5, pts)).toBe(2);
    expect(distToPolyline(1, 1, [])).toBe(Infinity);
  });
});

describe('tool kinds', () => {
  it('places one-point and two-point tools the right way', () => {
    expect(isOnePointType('hray')).toBe(true);
    expect(isOnePointType('cross')).toBe(true);
    expect(['arrow', 'pricerange', 'daterange'].every((t) => isTwoPointType(t as 'arrow'))).toBe(true);
    expect(isTwoPointType('channel')).toBe(false); // three clicks
    expect(isTwoPointType('brush')).toBe(false); // freehand
  });
});

describe('formatVolume', () => {
  it.each([
    [950, '950'],
    [12_345, '12.3K'],
    [4_560_000, '4.56M'],
    [1_200_000_000, '1.20B'],
  ])('%i → %s', (v, text) => expect(formatVolume(v)).toBe(text));
});
