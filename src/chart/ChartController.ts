import {
  CandlestickSeries,
  createChart,
  CrosshairMode,
  HistogramSeries,
  TickMarkType,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../types';

const UP = '#26a69a';
const DOWN = '#ef5350';

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

  constructor(container: HTMLElement) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: '#0f1117' },
        textColor: '#c9d1d9',
        fontSize: 12,
        // The license's attribution and link to tradingview.com are given in the About dialog instead (see index.html).
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#1c2030' },
        horzLines: { color: '#1c2030' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2f3e' },
      timeScale: {
        borderColor: '#2a2f3e',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        tickMarkFormatter: (time: Time, type: TickMarkType) => formatTick(time as number, type),
      },
      localization: {
        timeFormatter: (time: Time) => formatFull(time as number),
      },
    });

    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }

  get barCount(): number {
    return this.data.length;
  }

  get lastCandle(): Candle | undefined {
    return this.data[this.data.length - 1];
  }

  setData(candles: Candle[], intervalSeconds: number): void {
    this.data = candles.slice();
    this.times = this.data.map((c) => c.time);
    this.interval = intervalSeconds;
    this.precision = detectPrecision(this.data);

    this.candles.applyOptions({
      priceFormat: { type: 'price', precision: this.precision, minMove: 10 ** -this.precision },
    });
    this.candles.setData(this.data.map(toCandleData));
    this.volume.setData(this.data.map(toVolumeData));

    const n = this.data.length;
    if (n > 0) this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 12 });
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
    this.volume.update(toVolumeData(candle));
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
    return this.chart.timeScale().logicalToCoordinate(this.timeToLogical(time) as Logical);
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

function toVolumeData(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    value: c.volume ?? 0,
    color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
  };
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
