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
  /** Locked drawings can be selected but not moved or reshaped. */
  locked?: boolean;
  /** Hidden from the chart (shown again from the drawings list). */
  hidden?: boolean;
}

export type TrendLine = Base & { type: 'trend'; p1: Point; p2: Point };
/** Starts at p1, passes through p2 and continues to the edge of the chart. */
export type Ray = Base & { type: 'ray'; p1: Point; p2: Point };
/** Passes through p1 and p2 and continues in both directions. */
export type ExtendedLine = Base & { type: 'extended'; p1: Point; p2: Point };
export type Rectangle = Base & { type: 'rect'; p1: Point; p2: Point };
/** `levels`: the levels shown (all when missing). `trendLine`: the dashed diagonal (shown unless false). */
export type FibRetracement = Base & { type: 'fib'; p1: Point; p2: Point; levels?: number[]; trendLine?: boolean };
export type HorizontalLine = Base & { type: 'hline'; price: number };
/** Starts at `p` and continues to the right edge, at `p.price`. */
export type HorizontalRay = Base & { type: 'hray'; p: Point };
/** A horizontal and a vertical line crossing at `p`. */
export type CrossLine = Base & { type: 'cross'; p: Point };
/** A trend line with an arrowhead at p2. */
export type Arrow = Base & { type: 'arrow'; p1: Point; p2: Point };
/** Base line p1→p2 and a parallel line `offset` above it (below when negative), with a dashed middle line. */
export type ParallelChannel = Base & { type: 'channel'; p1: Point; p2: Point; offset: number };
/** Measures the price distance from p1 to p2. */
export type PriceRange = Base & { type: 'pricerange'; p1: Point; p2: Point };
/** Measures the time (bars) from p1 to p2. */
export type DateRange = Base & { type: 'daterange'; p1: Point; p2: Point };
/** A freehand line. Times can fall between bars. */
export type Brush = Base & { type: 'brush'; points: Point[] };
export type VerticalLine = Base & { type: 'vline'; time: number };
export type TextNote = Base & { type: 'text'; p: Point; text: string; fontSize?: number };
/** Long or short position: entry, take-profit and stop-loss prices, drawn from entry time to `endTime`. */
export type Position = Base & {
  type: 'long' | 'short';
  entry: Point;
  tp: number;
  sl: number;
  endTime: number;
  /** Colors of the target (profit) and stop (loss) zones. */
  profitColor?: string;
  lossColor?: string;
};

export type Drawing =
  | TrendLine
  | Ray
  | ExtendedLine
  | Rectangle
  | FibRetracement
  | HorizontalLine
  | HorizontalRay
  | CrossLine
  | VerticalLine
  | Arrow
  | ParallelChannel
  | PriceRange
  | DateRange
  | Brush
  | TextNote
  | Position;

export type DrawingType = Drawing['type'];
/** Drawn with two clicks and reshaped by two handles, p1 and p2. */
export type TwoPointDrawing = TrendLine | Ray | ExtendedLine | Arrow | Rectangle | FibRetracement | PriceRange | DateRange;
export type TwoPointType = TwoPointDrawing['type'];

/** `measure` is a temporary ruler; it is never saved. */
export type ToolId = 'cursor' | 'measure' | DrawingType;

export const TWO_POINT_TYPES: readonly TwoPointType[] = ['trend', 'ray', 'extended', 'arrow', 'rect', 'fib', 'pricerange', 'daterange'];

export function isTwoPointType(t: ToolId): t is TwoPointType {
  return (TWO_POINT_TYPES as readonly string[]).includes(t);
}

/** Lines that Shift can keep horizontal, vertical or at 45°. */
export function isStraightLineType(t: ToolId): t is 'trend' | 'ray' | 'extended' | 'arrow' {
  return t === 'trend' || t === 'ray' || t === 'extended' || t === 'arrow';
}

/** Drawings placed with one click at a point. */
export function isOnePointType(t: ToolId): t is 'hray' | 'cross' {
  return t === 'hray' || t === 'cross';
}

export function isTwoPoint(d: Drawing): d is TwoPointDrawing {
  return isTwoPointType(d.type);
}

export const DEFAULT_COLORS: Record<DrawingType, string> = {
  trend: '#4f8cff',
  ray: '#4f8cff',
  extended: '#4f8cff',
  arrow: '#4f8cff',
  hline: '#f5a623',
  hray: '#f5a623',
  cross: '#f5a623',
  vline: '#f5a623',
  channel: '#4f8cff',
  pricerange: '#4f8cff',
  daterange: '#4f8cff',
  brush: '#ff7043',
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
  profitColor?: string;
  lossColor?: string;
  levels?: number[];
  trendLine?: boolean;
}

export const DEFAULT_PROFIT_COLOR = '#26a69a';
export const DEFAULT_LOSS_COLOR = '#ef5350';

export const DEFAULT_WIDTH = 1;
export const DEFAULT_FONT_SIZE = 13;
export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 4];
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
export const FONT_SIZES: readonly number[] = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32];

export const PALETTE: readonly string[] = [
  '#e6e9ef', '#8a8a8a', '#4f8cff', '#00bcd4', '#26a69a', '#2ecc71',
  '#cddc39', '#f5d742', '#f5a623', '#ff7043', '#ef5350', '#ec407a',
  '#b07cff', '#7e57c2', '#795548', '#000000',
];

export interface StyleSupport {
  color: boolean;
  line: boolean;
  font: boolean;
  /** Target/stop zone colors (positions). */
  zones: boolean;
  /** Level toggles and trend line (Fibonacci). */
  fib: boolean;
}

/** Which style controls apply to a drawing type. */
export function styleSupport(type: DrawingType): StyleSupport {
  switch (type) {
    case 'long':
    case 'short':
      return { color: false, line: false, font: false, zones: true, fib: false };
    case 'text':
      return { color: true, line: false, font: true, zones: false, fib: false };
    case 'fib':
      return { color: true, line: true, font: false, zones: false, fib: true };
    case 'pricerange':
    case 'daterange':
      return { color: true, line: false, font: false, zones: false, fib: false };
    default:
      return { color: true, line: true, font: false, zones: false, fib: false };
  }
}

export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function fibLevelsOf(d: FibRetracement): readonly number[] {
  return d.levels ?? FIB_LEVELS;
}

export function fibShowsTrendLine(d: FibRetracement): boolean {
  return d.trendLine !== false;
}

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

/** Compact volume: 950, 12.3K, 4.56M, 1.2B. */
export function formatVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}
