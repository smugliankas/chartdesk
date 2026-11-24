/** A point on the chart in real time (UNIX seconds) and price. */
export interface Point {
  time: number;
  price: number;
}

interface Base {
  id: string;
  color: string;
}

export type TrendLine = Base & { type: 'trend'; p1: Point; p2: Point };
export type Rectangle = Base & { type: 'rect'; p1: Point; p2: Point };
export type FibRetracement = Base & { type: 'fib'; p1: Point; p2: Point };
export type HorizontalLine = Base & { type: 'hline'; price: number };

export type Drawing = TrendLine | Rectangle | FibRetracement | HorizontalLine;
export type TwoPointDrawing = TrendLine | Rectangle | FibRetracement;

export type ToolId = 'cursor' | Drawing['type'];

export const TOOLS: readonly { id: ToolId; label: string; title: string }[] = [
  { id: 'cursor', label: '↖', title: 'Cursor (Esc)' },
  { id: 'trend', label: '╱', title: 'Trend line' },
  { id: 'hline', label: '—', title: 'Horizontal line' },
  { id: 'rect', label: '▭', title: 'Rectangle' },
  { id: 'fib', label: 'Fib', title: 'Fibonacci retracement' },
];

export const DEFAULT_COLORS: Record<Drawing['type'], string> = {
  trend: '#4f8cff',
  hline: '#f5a623',
  rect: '#b07cff',
  fib: '#2ecc71',
};

export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Price at a Fibonacci level. Level 0 is at the end point (p2), level 1 at the start point (p1). */
export function fibPrice(d: FibRetracement, level: number): number {
  return d.p2.price + (d.p1.price - d.p2.price) * level;
}

export function isTwoPoint(d: Drawing): d is TwoPointDrawing {
  return d.type !== 'hline';
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
