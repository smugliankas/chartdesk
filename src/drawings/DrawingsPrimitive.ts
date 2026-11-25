import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { labelTextColor, readable } from '../chart/appearance';
import type { ChartController } from '../chart/ChartController';
import type { Timeframe } from '../types';
import { extendSegment, handlesOf } from './geometry';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_WIDTH,
  DEFAULT_LOSS_COLOR,
  DEFAULT_PROFIT_COLOR,
  fibLevelsOf,
  fibPrice,
  fibShowsTrendLine,
  formatDuration,
  formatVolume,
  measureText,
  shownOn,
  TEXT_PADDING,
  textFont,
  textLineHeight,
  type Drawing,
  type LineStyle,
  type Point,
  type Position,
} from './model';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** What the primitive needs to know to render. Implemented by DrawingManager. */
export interface DrawingSource {
  readonly drawings: readonly Drawing[];
  readonly preview: Drawing | null;
  readonly selectedId: string | null;
  /** Hidden while the text is being edited in place. */
  readonly editingId: string | null;
  /** All drawings hidden ("hide drawings" toggle). */
  readonly hidden: boolean;
  readonly measure: { p1: Point; p2: Point } | null;
  /** The chart's timeframe; drawings limited to other timeframes are not shown. */
  readonly timeframe: Timeframe | null;
}

const LABEL_FONT = '11px system-ui, -apple-system, Segoe UI, sans-serif';

/** The visible part of the chart in bar indexes and prices, with a margin around it. */
export interface ViewWindow {
  from: number;
  to: number;
  low: number;
  high: number;
}

const overlaps = (a1: number, a2: number, b1: number, b2: number) => Math.max(a1, a2) >= b1 && Math.min(a1, a2) <= b2;

/**
 * A single Lightweight Charts primitive that paints every drawing on top of the candles,
 * plus price-axis labels for horizontal lines.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdateFn: (() => void) | null = null;
  private readonly views: readonly IPrimitivePaneView[];
  private axisViews: ISeriesPrimitiveAxisView[] = [];

  constructor(
    private readonly source: DrawingSource,
    private readonly cc: ChartController,
  ) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.requestUpdateFn = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdateFn = null;
  }

  requestUpdate(): void {
    this.requestUpdateFn?.();
  }

  updateAllViews(): void {
    // Labels only for lines inside the visible price range: with thousands of lines,
    // labels off screen would still cost time on every frame.
    const pane = this.cc.paneSize();
    const top = this.cc.yToPrice(0);
    const bottom = this.cc.yToPrice(pane.height);
    const lo = top === null || bottom === null ? -Infinity : Math.min(top, bottom);
    const hi = top === null || bottom === null ? Infinity : Math.max(top, bottom);
    this.axisViews = this.levelLines()
      .filter(({ price }) => price >= lo && price <= hi)
      .map(({ d, price }) => {
        const y = this.cc.priceToY(price);
        const text = this.cc.formatPrice(price);
        return {
          coordinate: () => y ?? -100,
          text: () => text,
          textColor: () => labelTextColor(d.color),
          backColor: () => d.color,
          visible: () => y !== null,
        };
      });
  }

  private levelCache: {
    drawings: readonly Drawing[];
    hidden: boolean;
    timeframe: Timeframe | null;
    lines: { d: Drawing; price: number }[];
  } | null = null;

  /** Drawings with a price label (horizontal lines and rays, cross lines). Worked out again only when the drawings change. */
  private levelLines(): { d: Drawing; price: number }[] {
    const { drawings, hidden, timeframe } = this.source;
    const c = this.levelCache;
    if (c && c.drawings === drawings && c.hidden === hidden && c.timeframe === timeframe) return c.lines;
    const lines = hidden
      ? []
      : drawings
          .filter((d) => !d.hidden && shownOn(d, timeframe))
          .flatMap((d): { d: Drawing; price: number }[] =>
            d.type === 'hline' ? [{ d, price: d.price }] : d.type === 'hray' || d.type === 'cross' ? [{ d, price: d.p.price }] : [],
          );
    this.levelCache = { drawings, hidden, timeframe, lines };
    return lines;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  // --- rendering ----------------------------------------------------------

  /**
   * The visible area plus a margin, or null when it can't be worked out yet.
   * Drawings entirely outside it are skipped, so thousands of them stay fast.
   */
  viewWindow(): ViewWindow | null {
    const range = this.cc.chart.timeScale().getVisibleLogicalRange();
    const pane = this.cc.paneSize();
    const top = this.cc.yToPrice(0);
    const bottom = this.cc.yToPrice(pane.height);
    if (!range || top === null || bottom === null) return null;
    const bars = range.to - range.from;
    const prices = Math.abs(top - bottom);
    return {
      from: range.from - 5 - bars * 0.15,
      to: range.to + 5 + bars * 0.15,
      low: Math.min(top, bottom) - prices * 0.15,
      high: Math.max(top, bottom) + prices * 0.15,
    };
  }

  /** Whether any part of the drawing can be on screen. When unsure, says yes. */
  inView(d: Drawing, w: ViewWindow): boolean {
    const L = (t: number) => this.cc.timeToLogical(t);
    const priceIn = (p: number) => p >= w.low && p <= w.high;
    switch (d.type) {
      case 'hline':
        return priceIn(d.price);
      case 'vline':
        return L(d.time) >= w.from && L(d.time) <= w.to;
      case 'hray':
        return priceIn(d.p.price) && L(d.p.time) <= w.to;
      case 'cross':
        return priceIn(d.p.price) || (L(d.p.time) >= w.from && L(d.p.time) <= w.to);
      case 'ray':
      case 'extended': {
        // They reach past their points, so test the line itself against the screen.
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) return true;
        const pane = this.cc.paneSize();
        const reach = (pane.width + pane.height) * 4;
        const [x1, y1, x2, y2] = extendSegment(a.x, a.y, b.x, b.y, reach, d.type === 'extended');
        return segmentCrossesRect(x1, y1, x2, y2, -50, -50, pane.width + 50, pane.height + 50);
      }
      case 'text':
        // Extends right and down from its point; only skip it when clearly away.
        return L(d.p.time) <= w.to && L(d.p.time) >= w.from - (w.to - w.from) && d.p.price >= w.low;
      case 'long':
      case 'short':
        return overlaps(L(d.entry.time), L(d.endTime), w.from, w.to) && overlaps(Math.min(d.tp, d.sl), Math.max(d.tp, d.sl), w.low, w.high);
      case 'brush': {
        let t1 = Infinity, t2 = -Infinity, p1 = Infinity, p2 = -Infinity;
        for (const p of d.points) {
          t1 = Math.min(t1, p.time);
          t2 = Math.max(t2, p.time);
          p1 = Math.min(p1, p.price);
          p2 = Math.max(p2, p.price);
        }
        return overlaps(L(t1), L(t2), w.from, w.to) && overlaps(p1, p2, w.low, w.high);
      }
      case 'channel':
        return (
          overlaps(L(d.p1.time), L(d.p2.time), w.from, w.to) &&
          overlaps(
            Math.min(d.p1.price, d.p2.price, d.p1.price + d.offset, d.p2.price + d.offset),
            Math.max(d.p1.price, d.p2.price, d.p1.price + d.offset, d.p2.price + d.offset),
            w.low,
            w.high,
          )
        );
      default:
        // Two-point drawings (trend, arrow, rectangle, Fibonacci, ranges): their box.
        return overlaps(L(d.p1.time), L(d.p2.time), w.from, w.to) && overlaps(d.p1.price, d.p2.price, w.low, w.high);
    }
  }

  private draw(target: RenderTarget): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { drawings, preview, selectedId, editingId, measure, hidden, timeframe } = this.source;
      const size = { w: mediaSize.width, h: mediaSize.height };
      const w = this.viewWindow();
      if (!hidden) {
        for (const d of drawings) {
          if (d.id === editingId || d.hidden || !shownOn(d, timeframe)) continue;
          const selected = d.id === selectedId;
          if (!selected && w && !this.inView(d, w)) continue;
          this.drawOne(ctx, size, d, selected);
        }
      }
      if (preview) this.drawOne(ctx, size, preview, true);
      if (measure) this.drawMeasure(ctx, measure.p1, measure.p2);
    });
  }

  private xy(p: Point): { x: number; y: number } | null {
    const x = this.cc.timeToX(p.time);
    const y = this.cc.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  private drawOne(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, d: Drawing, selected: boolean): void {
    // No ctx.save()/restore() per drawing (slow with thousands of them): every drawing
    // sets what it uses, and resetState() puts back what some of them change.
    const theme = this.cc.themeColors;
    const color = readable(d.color, theme.background, theme.text);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const width = d.width ?? DEFAULT_WIDTH;
    ctx.lineWidth = width;
    // Selected: the same line with a soft glow in its own color, instead of a thicker line.
    if (selected) {
      ctx.shadowColor = glowColor(color);
      ctx.shadowBlur = 6 * (window.devicePixelRatio || 1); // the blur is in screen pixels
    }
    setDash(ctx, d.lineStyle ?? 'solid', width);
    ctx.font = LABEL_FONT;
    const reach = (size.w + size.h) * 4;

    switch (d.type) {
      case 'hline': {
        const y = this.cc.priceToY(d.price);
        if (y !== null) line(ctx, 0, y, size.w, y);
        break;
      }

      case 'vline': {
        const x = this.cc.timeToX(d.time);
        if (x !== null) line(ctx, x, 0, x, size.h);
        break;
      }

      case 'hray': {
        const p = this.xy(d.p);
        if (p) line(ctx, p.x, p.y, size.w, p.y);
        break;
      }

      case 'cross': {
        const p = this.xy(d.p);
        if (!p) break;
        line(ctx, 0, p.y, size.w, p.y);
        line(ctx, p.x, 0, p.x, size.h);
        break;
      }

      case 'arrow': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) break;
        const head = 8 + width * 2;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        // Stop the shaft under the arrowhead, so a thick line doesn't poke through its tip.
        const k = len > head ? (len - head * 0.6) / len : 0;
        line(ctx, a.x, a.y, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        arrowHead(ctx, a.x, a.y, b.x, b.y, head);
        break;
      }

      case 'channel': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        const a2 = this.xy({ time: d.p1.time, price: d.p1.price + d.offset });
        const b2 = this.xy({ time: d.p2.time, price: d.p2.price + d.offset });
        if (!a || !b || !a2 || !b2) break;
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        line(ctx, a.x, a.y, b.x, b.y);
        line(ctx, a2.x, a2.y, b2.x, b2.y);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 4]);
        line(ctx, (a.x + a2.x) / 2, (a.y + a2.y) / 2, (b.x + b2.x) / 2, (b.y + b2.y) / 2);
        ctx.restore();
        break;
      }

      case 'pricerange':
      case 'daterange': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) break;
        this.drawRange(ctx, d.type, d.p1, d.p2, a, b, color);
        break;
      }

      case 'brush': {
        const pts = d.points.map((p) => this.xy(p)).filter((p): p is { x: number; y: number } => p !== null);
        if (pts.length < 2) break;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        break;
      }

      case 'trend':
      case 'ray':
      case 'extended': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) break;
        if (d.type === 'trend') line(ctx, a.x, a.y, b.x, b.y);
        else {
          const [x1, y1, x2, y2] = extendSegment(a.x, a.y, b.x, b.y, reach, d.type === 'extended');
          line(ctx, x1, y1, x2, y2);
        }
        break;
      }

      case 'rect': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) break;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, w, h);
        break;
      }

      case 'fib': {
        const a = this.xy(d.p1);
        const b = this.xy(d.p2);
        if (!a || !b) break;
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        if (fibShowsTrendLine(d)) {
          ctx.save();
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          line(ctx, a.x, a.y, b.x, b.y);
          ctx.restore();
        }
        // Level labels sit to the right of the lines, so they never cross the candles inside.
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (const level of fibLevelsOf(d)) {
          const price = fibPrice(d, level);
          const y = this.cc.priceToY(price);
          if (y === null) continue;
          line(ctx, left, y, right, y);
          ctx.fillText(`${level} (${this.cc.formatPrice(price)})`, right + 6, y);
        }
        break;
      }

      case 'text': {
        const p = this.xy(d.p);
        if (!p) break;
        const fontSize = d.fontSize ?? DEFAULT_FONT_SIZE;
        const box = measureText(d.text, fontSize);
        if (selected) {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(p.x, p.y, box.width, box.height);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.strokeRect(p.x, p.y, box.width, box.height);
        }
        ctx.font = textFont(fontSize);
        ctx.textBaseline = 'top';
        const lh = textLineHeight(fontSize);
        const offset = (lh - fontSize) / 2;
        d.text.split('\n').forEach((l, i) => ctx.fillText(l, p.x + TEXT_PADDING, p.y + TEXT_PADDING + i * lh + offset));
        break;
      }

      case 'long':
      case 'short':
        this.drawPosition(ctx, d);
        break;
    }

    ctx.shadowBlur = 0;
    if (selected && !d.locked) {
      ctx.setLineDash([]);
      for (const h of handlesOf(d)) {
        const p = this.xy(h.point);
        if (p) handle(ctx, p.x, p.y, theme.background);
      }
    }
    resetState(ctx);
  }

  /** Price range: the distance between two prices. Date range: the bars and time between two dates. */
  private drawRange(
    ctx: CanvasRenderingContext2D,
    kind: 'pricerange' | 'daterange',
    p1: Point,
    p2: Point,
    a: { x: number; y: number },
    b: { x: number; y: number },
    color: string,
  ): void {
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    let text: string;
    let labelY: number;
    let where: 'above' | 'below';
    if (kind === 'pricerange') {
      line(ctx, left, a.y, right, a.y);
      line(ctx, left, b.y, right, b.y);
      const cx = (left + right) / 2;
      line(ctx, cx, a.y, cx, b.y);
      if (Math.abs(b.y - a.y) > 10) arrowHead(ctx, cx, a.y, cx, b.y, 7);
      const diff = p2.price - p1.price;
      const pct = p1.price !== 0 ? (diff / p1.price) * 100 : 0;
      const sign = diff >= 0 ? '+' : '−';
      text = `${sign}${this.cc.formatPrice(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%)`;
      // Label beyond the end point, like TradingView: above when the range goes up.
      where = b.y <= a.y ? 'above' : 'below';
      labelY = where === 'above' ? top : bottom;
    } else {
      line(ctx, a.x, top, a.x, bottom);
      line(ctx, b.x, top, b.x, bottom);
      const cy = (top + bottom) / 2;
      line(ctx, a.x, cy, b.x, cy);
      if (Math.abs(b.x - a.x) > 10) arrowHead(ctx, a.x, cy, b.x, cy, 7);
      const i1 = this.cc.timeToLogical(p1.time);
      const i2 = this.cc.timeToLogical(p2.time);
      const bars = Math.round(i2 - i1);
      let volume = 0;
      let hasVolume = false;
      for (let i = Math.round(Math.min(i1, i2)); i <= Math.round(Math.max(i1, i2)); i++) {
        const c = this.cc.candleAt(i);
        if (c?.volume !== undefined) {
          volume += c.volume;
          hasVolume = true;
        }
      }
      text = `${bars} bars, ${bars < 0 ? '−' : ''}${formatDuration(p2.time - p1.time)}`;
      if (hasVolume) text += `\nVol ${formatVolume(volume)}`;
      where = 'below';
      labelY = bottom;
    }
    label(ctx, text, (left + right) / 2, labelY, where, color);
  }

  private drawPosition(ctx: CanvasRenderingContext2D, d: Position): void {
    const x1 = this.cc.timeToX(d.entry.time);
    const x2 = this.cc.timeToX(d.endTime);
    const yE = this.cc.priceToY(d.entry.price);
    const yT = this.cc.priceToY(d.tp);
    const yS = this.cc.priceToY(d.sl);
    if (x1 === null || x2 === null || yE === null || yT === null || yS === null) return;
    const left = Math.min(x1, x2);
    const w = Math.max(Math.abs(x2 - x1), 1);

    const zone = (y1: number, y2: number, color: string) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(left, Math.min(y1, y2), w, Math.abs(y2 - y1));
      ctx.globalAlpha = 1;
    };
    const profit = d.profitColor ?? DEFAULT_PROFIT_COLOR;
    const loss = d.lossColor ?? DEFAULT_LOSS_COLOR;
    zone(yE, yT, profit);
    zone(yE, yS, loss);

    ctx.strokeStyle = this.cc.themeColors.text;
    ctx.lineWidth = 1;
    line(ctx, left, yE, left + w, yE);

    const entry = d.entry.price;
    const reward = Math.abs(d.tp - entry);
    const risk = Math.abs(d.sl - entry);
    const pct = (diff: number) => ((diff / entry) * 100).toFixed(2);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '∞';

    const cx = left + w / 2;
    label(ctx, `Target ${this.cc.formatPrice(d.tp)} (${pct(reward)}%)`, cx, yT, yT < yE ? 'above' : 'below', profit);
    label(ctx, `Stop ${this.cc.formatPrice(d.sl)} (${pct(risk)}%)`, cx, yS, yS < yE ? 'above' : 'below', loss);
    label(ctx, `${d.type === 'long' ? 'Long' : 'Short'} · R:R ${rr}`, cx, yE, 'center', '#3a4154');
  }

  private drawMeasure(ctx: CanvasRenderingContext2D, p1: Point, p2: Point): void {
    const a = this.xy(p1);
    const b = this.xy(p2);
    if (!a || !b) return;
    const up = p2.price >= p1.price;
    const color = up ? '#4f8cff' : '#ef5350';

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    line(ctx, a.x, a.y, b.x, b.y);
    ctx.setLineDash([]);

    const diff = p2.price - p1.price;
    const pct = p1.price !== 0 ? (diff / p1.price) * 100 : 0;
    const bars = Math.round(this.cc.timeToLogical(p2.time) - this.cc.timeToLogical(p1.time));
    const sign = diff >= 0 ? '+' : '−';
    const text =
      `${sign}${this.cc.formatPrice(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%)\n` +
      `${Math.abs(bars)} bars, ${formatDuration(p2.time - p1.time)}`;
    ctx.font = LABEL_FONT;
    label(ctx, text, (a.x + b.x) / 2, Math.max(a.y, b.y) + 8, 'below', color);
    ctx.restore();
  }
}

// --- canvas helpers ------------------------------------------------------------------

/** Whether the segment (x1,y1)→(x2,y2) touches the rectangle (Liang–Barsky clipping). */
function segmentCrossesRect(x1: number, y1: number, x2: number, y2: number, left: number, top: number, right: number, bottom: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x1 - left],
    [dx, right - x1],
    [-dy, y1 - top],
    [dy, bottom - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/** Undoes the state changes a drawing may leave behind. */
/** The glow around a selected drawing: its color, slightly see-through. */
function glowColor(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 1)`;
}

function resetState(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle, width: number): void {
  if (style === 'dashed') ctx.setLineDash([5 + width * 2, 4 + width]);
  else if (style === 'dotted') {
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 2.5 * width + 1.5]);
  } else ctx.setLineDash([]);
}

/** A filled arrowhead at (x2, y2), pointing away from (x1, y1). */
function arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** A filled label box with white text, placed above, below or centered on `y`. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  where: 'above' | 'below' | 'center',
  bg: string,
): void {
  const lines = text.split('\n');
  ctx.font = LABEL_FONT;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
  const lh = 15;
  const h = lines.length * lh + 6;
  const top = where === 'above' ? y - h - 4 : where === 'below' ? y + 4 : y - h / 2;
  ctx.save();
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, h, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, top + 4 + i * lh));
  ctx.restore();
}
