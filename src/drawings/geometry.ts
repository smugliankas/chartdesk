import type { Drawing, Point } from './model';

/** A handle the user can grab to reshape a drawing. */
export type HandlePart = 'p1' | 'p2' | 'entry' | 'tp' | 'sl' | 'end';
export type Part = HandlePart | 'body';

/** Grabbable handles of a drawing, in chart coordinates. */
export function handlesOf(d: Drawing): { part: HandlePart; point: Point }[] {
  switch (d.type) {
    case 'trend':
    case 'ray':
    case 'extended':
    case 'rect':
    case 'fib':
      return [
        { part: 'p1', point: d.p1 },
        { part: 'p2', point: d.p2 },
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
    case 'rect':
    case 'fib':
      return part === 'p1' ? { ...d, p1: pt } : part === 'p2' ? { ...d, p2: pt } : d;
    case 'long':
    case 'short':
      if (part === 'entry') return { ...d, entry: pt };
      if (part === 'tp') return { ...d, tp: pt.price };
      if (part === 'sl') return { ...d, sl: pt.price };
      if (part === 'end') return { ...d, endTime: Math.max(pt.time, d.entry.time) };
      return d;
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
    case 'rect':
    case 'fib':
      return { ...d, p1: shift(d.p1), p2: shift(d.p2) };
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
