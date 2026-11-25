import type { Drawing, Point } from './model';

/** A handle the user can grab to reshape a drawing. */
export type HandlePart = 'p1' | 'p2' | 'p' | 'c1' | 'c2' | 'entry' | 'tp' | 'sl' | 'end';
export type Part = HandlePart | 'body';

/** Grabbable handles of a drawing, in chart coordinates. */
export function handlesOf(d: Drawing): { part: HandlePart; point: Point }[] {
  switch (d.type) {
    case 'trend':
    case 'ray':
    case 'extended':
    case 'arrow':
    case 'rect':
    case 'fib':
    case 'pricerange':
    case 'daterange':
      return [
        { part: 'p1', point: d.p1 },
        { part: 'p2', point: d.p2 },
      ];
    case 'hray':
    case 'cross':
      return [{ part: 'p', point: d.p }];
    case 'channel':
      return [
        { part: 'p1', point: d.p1 },
        { part: 'p2', point: d.p2 },
        { part: 'c1', point: { time: d.p1.time, price: d.p1.price + d.offset } },
        { part: 'c2', point: { time: d.p2.time, price: d.p2.price + d.offset } },
      ];
    case 'long':
    case 'short':
      return [
        { part: 'entry', point: d.entry },
        { part: 'tp', point: { time: d.entry.time, price: d.tp } },
        { part: 'sl', point: { time: d.entry.time, price: d.sl } },
        { part: 'end', point: { time: d.endTime, price: d.entry.price } },
      ];
    default:
      return [];
  }
}

/** Returns a copy of `d` with one handle moved to `pt`. */
export function moveHandle(d: Drawing, part: HandlePart, pt: Point): Drawing {
  switch (d.type) {
    case 'trend':
    case 'ray':
    case 'extended':
    case 'arrow':
    case 'rect':
    case 'fib':
    case 'pricerange':
    case 'daterange':
      return part === 'p1' ? { ...d, p1: pt } : part === 'p2' ? { ...d, p2: pt } : d;
    case 'hray':
    case 'cross':
      return part === 'p' ? { ...d, p: pt } : d;
    case 'channel':
      // The base line's ends move freely; the parallel line's ends only change the width.
      if (part === 'p1') return { ...d, p1: pt };
      if (part === 'p2') return { ...d, p2: pt };
      if (part === 'c1') return { ...d, offset: pt.price - d.p1.price };
      if (part === 'c2') return { ...d, offset: pt.price - d.p2.price };
      return d;
    case 'long':
    case 'short': {
      // Same as TradingView: the entry handle (left edge, at the entry price) moves the entry
      // price and the start time; target and stop move their price only; the right edge
      // moves the end time only. Levels can't be dragged across the entry.
      const long = d.type === 'long';
      const gap = Math.abs(d.entry.price) * 1e-5 || 1e-8;
      const above = Math.max(d.tp, d.sl);
      const below = Math.min(d.tp, d.sl);
      if (part === 'entry') {
        const price = Math.min(above - gap, Math.max(below + gap, pt.price));
        return { ...d, entry: { time: Math.min(pt.time, d.endTime), price } };
      }
      if (part === 'end') return { ...d, endTime: Math.max(pt.time, d.entry.time) };
      if (part === 'tp') {
        const tp = long ? Math.max(pt.price, d.entry.price + gap) : Math.min(pt.price, d.entry.price - gap);
        return { ...d, tp };
      }
      if (part === 'sl') {
        const sl = long ? Math.min(pt.price, d.entry.price - gap) : Math.max(pt.price, d.entry.price + gap);
        return { ...d, sl };
      }
      return d;
    }
    default:
      return d;
  }
}

/** Returns a copy of `d` moved as a whole. `shiftTime` moves a time by the dragged number of bars. */
export function moveWhole(d: Drawing, shiftTime: (t: number) => number, dPrice: number): Drawing {
  const shift = (p: Point): Point => ({ time: shiftTime(p.time), price: p.price + dPrice });
  switch (d.type) {
    case 'trend':
    case 'ray':
    case 'extended':
    case 'arrow':
    case 'rect':
    case 'fib':
    case 'pricerange':
    case 'daterange':
    case 'channel':
      return { ...d, p1: shift(d.p1), p2: shift(d.p2) };
    case 'hray':
    case 'cross':
      return { ...d, p: shift(d.p) };
    case 'brush':
      return { ...d, points: d.points.map(shift) };
    case 'hline':
      return { ...d, price: d.price + dPrice };
    case 'vline':
      return { ...d, time: shiftTime(d.time) };
    case 'text':
      return { ...d, p: shift(d.p) };
    case 'long':
    case 'short':
      return { ...d, entry: shift(d.entry), tp: d.tp + dPrice, sl: d.sl + dPrice, endTime: shiftTime(d.endTime) };
  }
}

/**
 * Stretches the segment a→b so it reaches past the visible area:
 * forward only for a ray, both ways for an extended line.
 */
export function extendSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  reach: number,
  bothWays: boolean,
): [number, number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [ax, ay, bx, by];
  const f = reach / len;
  const x2 = bx + dx * f;
  const y2 = by + dy * f;
  if (!bothWays) return [ax, ay, x2, y2];
  return [ax - dx * f, ay - dy * f, x2, y2];
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a polyline (a freehand brush stroke). */
export function distToPolyline(px: number, py: number, pts: readonly { x: number; y: number }[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, distToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  }
  return best;
}

/**
 * Whether (px, py) lies inside a parallel channel on screen: between the base line a→b and
 * the same line moved by `dy` pixels, within the base line's horizontal extent.
 */
export function insideChannel(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  dy: number,
): boolean {
  if (px < Math.min(a.x, b.x) || px > Math.max(a.x, b.x)) return false;
  const base = a.x === b.x ? a.y : a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x);
  return py >= Math.min(base, base + dy) && py <= Math.max(base, base + dy);
}
