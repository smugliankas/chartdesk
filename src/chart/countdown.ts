import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { TF_SECONDS, type Timeframe } from '../types';
import { labelTextColor } from './appearance';
import type { ChartController } from './ChartController';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

interface LabelState {
  y: number;
  price: string;
  countdown: string | null;
  color: string;
}

/**
 * "Countdown to bar close": while it is on, the last-price label on the price scale
 * becomes a two-line label, the price on top and the time left until the bar closes
 * below it, like TradingView. Ticks every second.
 */
export class BarCountdown implements ISeriesPrimitive<Time> {
  private requestUpdateFn: (() => void) | null = null;
  private timeframe: Timeframe | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private state: LabelState | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly cc: ChartController) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => 'normal', renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.requestUpdateFn = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdateFn = null;
    clearInterval(this.timer);
  }

  /** Starts counting for this timeframe, or stops and goes back to the normal price label with `null`. */
  setTimeframe(tf: Timeframe | null): void {
    this.timeframe = tf;
    clearInterval(this.timer);
    if (tf) this.timer = setInterval(() => this.requestUpdateFn?.(), 1000);
    // Our combined label replaces the library's own last-price label while counting.
    this.cc.candles.applyOptions({ lastValueVisible: tf === null });
    this.requestUpdateFn?.();
  }

  updateAllViews(): void {
    this.state = null;
    const last = this.cc.lastCandle;
    if (!this.timeframe || !last) return;
    const y = this.cc.priceToY(last.close);
    if (y === null) return;

    const remaining = barCloseTime(last.time, this.timeframe) - Date.now() / 1000;
    const { upColor, downColor } = this.cc.appearance;
    this.state = {
      y,
      price: this.cc.formatPrice(last.close),
      // No countdown once the bar's time is up but no new bar has arrived (e.g. market closed).
      countdown: remaining > 0 ? formatRemaining(remaining) : null,
      color: last.close >= last.open ? upColor : downColor,
    };
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: RenderTarget): void {
    const s = this.state;
    if (!s) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const layout = this.cc.chart.options().layout;
      const fontSize = layout.fontSize;
      const lineHeight = Math.round(fontSize * 1.25);
      const padY = 3;
      const lines = s.countdown ? [s.price, s.countdown] : [s.price];
      const height = lines.length * lineHeight + padY * 2;
      // The price line sits in the middle of the first line, as with the normal label.
      const top = Math.round(s.y - lineHeight / 2 - padY);

      ctx.fillStyle = s.color;
      ctx.fillRect(0, top, mediaSize.width, height);

      ctx.fillStyle = labelTextColor(s.color);
      ctx.font = `${fontSize}px ${layout.fontFamily}`;
      ctx.textBaseline = 'middle';
      lines.forEach((text, i) => ctx.fillText(text, 7, top + padY + lineHeight * i + lineHeight / 2));
    });
  }
}

/** When a bar that opened at `openTime` closes (UNIX seconds). */
export function barCloseTime(openTime: number, tf: Timeframe): number {
  if (tf === '1M') {
    const d = new Date(openTime * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return openTime + TF_SECONDS[tf];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 42:07, 03:42:07 or 5d 03:42. */
export function formatRemaining(seconds: number): string {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}
