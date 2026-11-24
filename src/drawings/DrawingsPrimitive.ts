import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { ChartController } from '../chart/ChartController';
import { FIB_LEVELS, fibPrice, isTwoPoint, type Drawing, type Point } from './model';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** What the primitive needs to know to render. Implemented by DrawingManager. */
export interface DrawingSource {
  readonly drawings: readonly Drawing[];
  readonly preview: Drawing | null;
  readonly selectedId: string | null;
}

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
    const all = [...this.source.drawings, ...(this.source.preview ? [this.source.preview] : [])];
    this.axisViews = all
      .filter((d) => d.type === 'hline')
      .map((d) => {
        const y = this.cc.priceToY(d.price);
        const text = this.cc.formatPrice(d.price);
        return {
          coordinate: () => y ?? -100,
          text: () => text,
          textColor: () => '#0f1117',
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
      const { drawings, preview, selectedId } = this.source;
      for (const d of drawings) this.drawOne(ctx, mediaSize.width, d, d.id === selectedId);
      if (preview) this.drawOne(ctx, mediaSize.width, preview, true);
    });
  }

  private xy(p: Point): { x: number; y: number } | null {
    const x = this.cc.timeToX(p.time);
    const y = this.cc.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  private drawOne(ctx: CanvasRenderingContext2D, width: number, d: Drawing, selected: boolean): void {
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';

    if (d.type === 'hline') {
      const y = this.cc.priceToY(d.price);
      if (y !== null) line(ctx, 0, y, width, y);
      ctx.restore();
      return;
    }

    const a = this.xy(d.p1);
    const b = this.xy(d.p2);
    if (!a || !b) {
      ctx.restore();
      return;
    }

    switch (d.type) {
      case 'trend':
        line(ctx, a.x, a.y, b.x, b.y);
        break;

      case 'rect': {
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
    }

    if (selected && isTwoPoint(d)) {
      handle(ctx, a.x, a.y);
      handle(ctx, b.x, b.y);
    }
    ctx.restore();
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0f1117';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
}
