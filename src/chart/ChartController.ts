import {
  CandlestickSeries,
  createChart,
  CrosshairMode,
  HistogramSeries,
  PriceScaleMode,
  TickMarkType,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../types';
import { defaultAppearance, effectiveTextColor, THEMES, withAlpha, type Appearance, type ThemeColors } from './appearance';

/**
 * Owns the chart, the candle and volume series, and the mapping between
 * real time (UNIX seconds) and the chart's bar index ("logical" coordinate).
 *
 * Drawings are stored in real time + price, so they stay in place when the
 * timeframe changes and can extend into the empty space right of the last bar.
 */
export class ChartController {
  readonly chart: IChartApi;
  readonly candles: ISeriesApi<'Candlestick'>;
  readonly volume: ISeriesApi<'Histogram'>;

  private data: Candle[] = [];
  private times: number[] = [];
  private interval = 3600;
  private precision = 2;
  private look: Appearance = defaultAppearance();

  constructor(container: HTMLElement) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        // The license's attribution and link to tradingview.com are given in the About dialog instead (see index.html).
        attributionLogo: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        tickMarkFormatter: (time: Time, type: TickMarkType) => formatTick(time as number, type),
      },
      localization: {
        timeFormatter: (time: Time) => formatFull(time as number),
      },
    });

    this.candles = this.chart.addSeries(CandlestickSeries);

    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    this.applyAppearance(this.look);
  }

  // --- appearance -----------------------------------------------------------

  get appearance(): Appearance {
    return this.look;
  }

  /** Colors of the current theme, for drawings that need to contrast with the background. */
  get themeColors(): ThemeColors {
    return { ...THEMES[this.look.theme], background: this.look.background, text: effectiveTextColor(this.look) };
  }

  applyAppearance(a: Appearance): void {
    const volumeColorsChanged = a.upColor !== this.look.upColor || a.downColor !== this.look.downColor;
    this.look = a;
    this.chart.applyOptions({
      layout: { background: { color: a.background }, textColor: effectiveTextColor(a), fontSize: a.fontSize },
      grid: {
        vertLines: { visible: a.gridVert, color: a.gridColor },
        horzLines: { visible: a.gridHorz, color: a.gridColor },
      },
      // No border lines between the chart and its axes: a cleaner, more modern look.
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    this.candles.applyOptions({
      upColor: a.upColor,
      downColor: a.downColor,
      borderVisible: a.borders,
      borderUpColor: a.borderUpColor,
      borderDownColor: a.borderDownColor,
      wickVisible: a.wicks,
      wickUpColor: a.wickUpColor,
      wickDownColor: a.wickDownColor,
    });
    this.volume.applyOptions({ visible: a.showVolume });
    if (volumeColorsChanged && this.data.length) this.volume.setData(this.data.map((c) => this.toVolumeData(c)));
  }

  get barCount(): number {
    return this.data.length;
  }

  get lastCandle(): Candle | undefined {
    return this.data[this.data.length - 1];
  }

  setData(candles: Candle[], intervalSeconds: number): void {
    this.data = candles.slice();
    this.interval = intervalSeconds;
    this.precision = detectPrecision(this.data);
    this.candles.applyOptions({
      priceFormat: { type: 'price', precision: this.precision, minMove: 10 ** -this.precision },
    });
    this.pushToSeries();

    const n = this.data.length;
    if (n > 0) this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 12 });
    if (!this.isAutoScale()) this.fitPriceIfOffscreen(Math.max(0, n - 150));
  }

  /**
   * With auto-scale off the price scale keeps its old range, so after switching to a
   * symbol at a very different price the candles would be off screen. In that case,
   * frame the visible bars once and leave auto-scale off, as the user had it.
   */
  private fitPriceIfOffscreen(fromIndex: number): void {
    const last = this.lastCandle;
    if (!last) return;
    const scale = this.candles.priceScale();
    const range = scale.getVisibleRange();
    if (range && last.close >= Math.min(range.from, range.to) && last.close <= Math.max(range.from, range.to)) return;

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = fromIndex; i < this.data.length; i++) {
      lo = Math.min(lo, this.data[i].low);
      hi = Math.max(hi, this.data[i].high);
    }
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.01 || 1;
    scale.setVisibleRange({ from: lo - pad, to: hi + pad });
  }

  /**
   * Adds older candles to the left without moving what the user is looking at.
   * Returns how many bars were added.
   */
  prependData(older: Candle[]): number {
    const first = this.data[0];
    const add = first ? older.filter((c) => c.time < first.time) : older;
    if (add.length === 0) return 0;

    const ts = this.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    this.data = [...add, ...this.data];
    this.pushToSeries();
    if (range) ts.setVisibleLogicalRange({ from: range.from + add.length, to: range.to + add.length });
    return add.length;
  }

  private pushToSeries(): void {
    this.times = this.data.map((c) => c.time);
    this.candles.setData(this.data.map(toCandleData));
    this.volume.setData(this.data.map((c) => this.toVolumeData(c)));
  }

  get firstTime(): number | undefined {
    return this.data[0]?.time;
  }

  /** The candle at a bar index, if there is one. */
  candleAt(index: number): Candle | undefined {
    return this.data[index];
  }

  // --- view controls ------------------------------------------------------

  scrollToRealtime(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  /** True when the last bar is on screen. */
  isLastBarVisible(): boolean {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    return !range || range.to >= this.data.length - 1;
  }

  isLogScale(): boolean {
    return this.candles.priceScale().options().mode === PriceScaleMode.Logarithmic;
  }

  setLogScale(on: boolean): void {
    this.candles.priceScale().applyOptions({ mode: on ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }

  isAutoScale(): boolean {
    return this.candles.priceScale().options().autoScale;
  }

  /** Turning auto-scale off keeps the current price range where it is. */
  setAutoScale(on: boolean): void {
    this.candles.priceScale().setAutoScale(on);
  }

  priceScaleWidth(): number {
    return this.candles.priceScale().width();
  }

  timeScaleHeight(): number {
    return this.chart.timeScale().height();
  }

  /** Applies a live update: replaces the last bar or appends a new one. */
  update(candle: Candle): void {
    const last = this.lastCandle;
    if (!last || candle.time < last.time) return;
    if (candle.time === last.time) {
      this.data[this.data.length - 1] = candle;
    } else {
      this.data.push(candle);
      this.times.push(candle.time);
    }
    this.candles.update(toCandleData(candle));
    this.volume.update(this.toVolumeData(candle));
  }

  private toVolumeData(c: Candle) {
    return {
      time: c.time as UTCTimestamp,
      value: c.volume ?? 0,
      color: withAlpha(c.close >= c.open ? this.look.upColor : this.look.downColor, 0.35),
    };
  }

  // --- coordinate helpers -------------------------------------------------

  /** Real time → bar index. Interpolates between bars and extrapolates outside the data. */
  timeToLogical(time: number): number {
    const t = this.times;
    const n = t.length;
    if (n === 0) return 0;
    if (time <= t[0]) return (time - t[0]) / this.interval;
    if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]) / this.interval;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - t[lo]) / (t[hi] - t[lo]);
  }

  /** Bar index → real time. Inverse of `timeToLogical`. */
  logicalToTime(logical: number): number {
    const t = this.times;
    const n = t.length;
    if (n === 0) return 0;
    if (logical <= 0) return t[0] + logical * this.interval;
    if (logical >= n - 1) return t[n - 1] + (logical - (n - 1)) * this.interval;
    const i = Math.floor(logical);
    return t[i] + (logical - i) * (t[i + 1] - t[i]);
  }

  timeToX(time: number): number | null {
    return this.logicalToX(this.timeToLogical(time));
  }

  /**
   * Bar index → x. The library only converts whole bar indexes, so fractional
   * positions (a time between two bars) are interpolated here.
   */
  logicalToX(logical: number): number | null {
    const ts = this.chart.timeScale();
    const i = Math.floor(logical);
    const x0 = ts.logicalToCoordinate(i as Logical);
    if (x0 === null || logical === i) return x0;
    const x1 = ts.logicalToCoordinate((i + 1) as Logical);
    return x1 === null ? x0 : x0 + (logical - i) * (x1 - x0);
  }

  priceToY(price: number): number | null {
    return this.candles.priceToCoordinate(price);
  }

  xToLogical(x: number): number | null {
    return this.chart.timeScale().coordinateToLogical(x);
  }

  yToPrice(y: number): number | null {
    return this.candles.coordinateToPrice(y);
  }

  formatPrice(price: number): string {
    return price.toFixed(this.precision);
  }

  /** Size of the main drawing area (excludes the price and time axes). */
  paneSize(): { width: number; height: number } {
    const ts = this.chart.timeScale();
    const size = this.chart.paneSize(0);
    return { width: ts.width(), height: size.height };
  }
}

// ---------------------------------------------------------------------------

function toCandleData(c: Candle): CandlestickData<Time> {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}


function decimals(n: number): number {
  const s = String(n);
  if (s.includes('e')) return 8;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

function detectPrecision(data: Candle[]): number {
  let p = 0;
  for (let i = Math.max(0, data.length - 300); i < data.length; i++) {
    const c = data[i];
    p = Math.max(p, decimals(c.open), decimals(c.high), decimals(c.low), decimals(c.close));
  }
  return Math.min(Math.max(p, 2), 8);
}

// Axis labels in the user's local time zone.
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTick(time: number, type: TickMarkType): string {
  const d = new Date(time * 1000);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return String(d.getDate());
    case TickMarkType.Time:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case TickMarkType.TimeWithSeconds:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

function formatFull(time: number): string {
  const d = new Date(time * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
