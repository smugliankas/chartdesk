import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { ChartController } from '../chart/ChartController';
import { extendSegment, handlesOf } from './geometry';
import {
  FIB_LEVELS,
  fibPrice,
  formatDuration,
  measureText,
  TEXT_FONT,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  type Drawing,
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
  readonly measure: { p1: Point; p2: Point } | null;
}

const LABEL_FONT = '11px system-ui, -apple-system, Segoe UI, sans-serif';
const BG = '#0f1117';

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
    this.axisViews = this.source.drawings
      .filter((d) => d.type === 'hline')
      .map((d) => {
        const y = this.cc.priceToY(d.price);
        const text = this.cc.formatPrice(d.price);
        return {
          coordinate: () => y ?? -100,
          text: () => text,
          textColor: () => BG,
          backColor: () => d.color,
          visible: () => y !== null,
        };
      });
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  // --- rendering ----------------------------------------------------------

  private draw(target: RenderTarget): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { drawings, preview, selectedId, editingId, measure } = this.source;
      const size = { w: mediaSize.width, h: mediaSize.height };
      for (const d of drawings) {
        if (d.id !== editingId) this.drawOne(ctx, size, d, d.id === selectedId);
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
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = selected ? 2 : 1.25;
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
        ctx.setLineDash([4, 4]);
        line(ctx, a.x, a.y, b.x, b.y);
        ctx.setLineDash([]);
        ctx.textBaseline = 'bottom';
        for (const level of FIB_LEVELS) {
          const price = fibPrice(d, level);
          const y = this.cc.priceToY(price);
          if (y === null) continue;
          line(ctx, left, y, right, y);
          ctx.fillText(`${level} (${this.cc.formatPrice(price)})`, left + 4, y - 2);
        }
        break;
      }

      case 'text': {
        const p = this.xy(d.p);
        if (!p) break;
        const { width, height } = measureText(d.text);
        if (selected) {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(p.x, p.y, width, height);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x, p.y, width, height);
        }
        ctx.font = TEXT_FONT;
        ctx.textBaseline = 'top';
        d.text.split('\n').forEach((l, i) => ctx.fillText(l, p.x + TEXT_PADDING, p.y + TEXT_PADDING + i * TEXT_LINE_HEIGHT + 2));
        break;
      }

      case 'long':
      case 'short':
        this.drawPosition(ctx, d);
        break;
    }

    if (selected) {
      for (const h of handlesOf(d)) {
        const p = this.xy(h.point);
        if (p) handle(ctx, p.x, p.y);
      }
    }
    ctx.restore();
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
    zone(yE, yT, '#26a69a');
    zone(yE, yS, '#ef5350');

    ctx.strokeStyle = '#c9d1d9';
    ctx.lineWidth = 1;
    line(ctx, left, yE, left + w, yE);

    const entry = d.entry.price;
    const reward = Math.abs(d.tp - entry);
    const risk = Math.abs(d.sl - entry);
    const pct = (diff: number) => ((diff / entry) * 100).toFixed(2);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '∞';

    const cx = left + w / 2;
    label(ctx, `Target ${this.cc.formatPrice(d.tp)} (${pct(reward)}%)`, cx, yT, yT < yE ? 'above' : 'below', '#26a69a');
    label(ctx, `Stop ${this.cc.formatPrice(d.sl)} (${pct(risk)}%)`, cx, yS, yS < yE ? 'above' : 'below', '#ef5350');
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

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = BG;
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
