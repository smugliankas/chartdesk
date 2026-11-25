import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { labelTextColor, withAlpha } from '../chart/appearance';
import type { ChartController } from '../chart/ChartController';
import { alertPriceAt, type PriceAlert } from './AlertManager';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** The bell from the toolbar icon, as canvas paths (24×24 box). */
const BELL = new Path2D('M6 16V11a6 6 0 0112 0v5l1.5 2h-15z');
const BELL_CLAPPER = new Path2D('M10 20a2 2 0 004 0');

/** Draws a small bell badge centered at (x, y). */
export function drawBellBadge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, background: string): void {
  const size = 18;
  ctx.save();
  ctx.fillStyle = background;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size / 2, size, size, 4);
  ctx.fill();
  ctx.stroke();
  ctx.translate(x - 6, y - 6.5);
  ctx.scale(0.5, 0.5);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(BELL);
  ctx.stroke(BELL_CLAPPER);
  ctx.restore();
}

/**
 * Shows the current symbol's active alerts in the chart's own text color:
 * a dashed line (unless the alert sits on a drawing), a bell at the right edge,
 * and the level on the price scale.
 */
export class AlertsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdateFn: (() => void) | null = null;
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private readonly views: readonly IPrimitivePaneView[];
  /** An alert being dragged, shown at its new level before it is saved. */
  private preview: { id: string; price: number } | null = null;

  constructor(
    private readonly cc: ChartController,
    private readonly alerts: () => readonly PriceAlert[],
  ) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => 'normal', renderer: () => renderer }];
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

  setPreview(preview: { id: string; price: number } | null): void {
    this.preview = preview;
    this.requestUpdate();
  }

  /** Active alerts of the symbol on the chart, with their current level. */
  active(): { alert: PriceAlert; level: number }[] {
    const now = Date.now() / 1000;
    return this.alerts()
      .filter((a) => !a.triggeredAt)
      .map((alert) => ({
        alert,
        level: this.preview?.id === alert.id ? this.preview.price : alertPriceAt(alert, now),
      }));
  }

  updateAllViews(): void {
    const color = this.cc.themeColors.text;
    const text = labelTextColor(color);
    this.axisViews = this.active().map(({ level }) => {
      const y = this.cc.priceToY(level);
      const label = this.cc.formatPrice(level);
      return {
        coordinate: () => y ?? -100,
        text: () => label,
        textColor: () => text,
        backColor: () => color,
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

  private draw(target: RenderTarget): void {
    const items = this.active();
    if (items.length === 0) return;
    const { text: color, background } = this.cc.themeColors;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const { alert, level } of items) {
        const y = this.cc.priceToY(level);
        if (y === null) continue;
        const yy = Math.round(y) + 0.5;
        // Alerts on a drawing need no extra line: the drawing is already there.
        if (!alert.drawingId) {
          ctx.save();
          ctx.strokeStyle = withAlpha(color, 0.55);
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, yy);
          ctx.lineTo(mediaSize.width - 22, yy);
          ctx.stroke();
          ctx.restore();
        }
        drawBellBadge(ctx, mediaSize.width - 12, yy, color, background);
      }
    });
  }
}
