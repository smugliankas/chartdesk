/** A point on the chart in real time (UNIX seconds) and price. */
export interface Point {
  time: number;
  price: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

interface Base {
  id: string;
  color: string;
  /** Line width in pixels. Missing in drawings saved before styles existed: use DEFAULT_WIDTH. */
  width?: number;
  lineStyle?: LineStyle;
}

export type TrendLine = Base & { type: 'trend'; p1: Point; p2: Point };
/** Starts at p1, passes through p2 and continues to the edge of the chart. */
export type Ray = Base & { type: 'ray'; p1: Point; p2: Point };
/** Passes through p1 and p2 and continues in both directions. */
export type ExtendedLine = Base & { type: 'extended'; p1: Point; p2: Point };
export type Rectangle = Base & { type: 'rect'; p1: Point; p2: Point };
export type FibRetracement = Base & { type: 'fib'; p1: Point; p2: Point };
export type HorizontalLine = Base & { type: 'hline'; price: number };
export type VerticalLine = Base & { type: 'vline'; time: number };
export type TextNote = Base & { type: 'text'; p: Point; text: string; fontSize?: number };
/** Long or short position: entry, take-profit and stop-loss prices, drawn from entry time to `endTime`. */
export type Position = Base & { type: 'long' | 'short'; entry: Point; tp: number; sl: number; endTime: number };

export type Drawing =
  | TrendLine
  | Ray
  | ExtendedLine
  | Rectangle
  | FibRetracement
  | HorizontalLine
  | VerticalLine
  | TextNote
  | Position;

export type DrawingType = Drawing['type'];
export type TwoPointDrawing = TrendLine | Ray | ExtendedLine | Rectangle | FibRetracement;
export type TwoPointType = TwoPointDrawing['type'];

/** `measure` is a temporary ruler; it is never saved. */
export type ToolId = 'cursor' | 'measure' | DrawingType;

export const TWO_POINT_TYPES: readonly TwoPointType[] = ['trend', 'ray', 'extended', 'rect', 'fib'];

export function isTwoPointType(t: ToolId): t is TwoPointType {
  return (TWO_POINT_TYPES as readonly string[]).includes(t);
}

export function isTwoPoint(d: Drawing): d is TwoPointDrawing {
  return isTwoPointType(d.type);
}

export const DEFAULT_COLORS: Record<DrawingType, string> = {
  trend: '#4f8cff',
  ray: '#4f8cff',
  extended: '#4f8cff',
  hline: '#f5a623',
  vline: '#f5a623',
  rect: '#b07cff',
  fib: '#2ecc71',
  text: '#e6e9ef',
  long: '#26a69a',
  short: '#ef5350',
};

/** The style properties a user can change. */
export interface DrawingStyle {
  color?: string;
  width?: number;
  lineStyle?: LineStyle;
  fontSize?: number;
}

export const DEFAULT_WIDTH = 1;
export const DEFAULT_FONT_SIZE = 13;
export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 4];
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
export const FONT_SIZES: readonly number[] = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32];

export const PALETTE: readonly string[] = [
  '#e6e9ef', '#8b93a7', '#4f8cff', '#00bcd4', '#26a69a', '#2ecc71',
  '#cddc39', '#f5d742', '#f5a623', '#ff7043', '#ef5350', '#ec407a',
  '#b07cff', '#7e57c2', '#795548', '#000000',
];

/** Which style controls apply to a drawing type. Positions use fixed green/red zones. */
export function styleSupport(type: DrawingType): { color: boolean; line: boolean; font: boolean } {
  switch (type) {
    case 'long':
    case 'short':
      return { color: false, line: false, font: false };
    case 'text':
      return { color: true, line: false, font: true };
    default:
      return { color: true, line: true, font: false };
  }
}

export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Price at a Fibonacci level. Level 0 is at the end point (p2), level 1 at the start point (p1). */
export function fibPrice(d: FibRetracement, level: number): number {
  return d.p2.price + (d.p1.price - d.p2.price) * level;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// --- text measuring (shared by rendering and hit testing) ------------------------

export const TEXT_PADDING = 4;

export function textFont(size: number = DEFAULT_FONT_SIZE): string {
  return `${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
}

export function textLineHeight(size: number = DEFAULT_FONT_SIZE): number {
  return Math.round(size * 1.3);
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width and height of a (possibly multi-line) text note, including padding. */
export function measureText(text: string, size: number = DEFAULT_FONT_SIZE): { width: number; height: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const lines = text.split('\n');
  let width = 0;
  if (measureCtx) {
    measureCtx.font = textFont(size);
    for (const l of lines) width = Math.max(width, measureCtx.measureText(l).width);
  } else {
    width = Math.max(...lines.map((l) => l.length * size * 0.55));
  }
  return { width: width + TEXT_PADDING * 2, height: lines.length * textLineHeight(size) + TEXT_PADDING * 2 };
}

// --- formatting helpers ---------------------------------------------------------

export function formatDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
