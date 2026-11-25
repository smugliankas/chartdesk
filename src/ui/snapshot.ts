import type { IChartApi } from 'lightweight-charts';
import type { Candle } from '../types';

export interface SnapshotInfo {
  /** "BTCUSDT · 1H · Binance" */
  title: string;
  candle: Candle | undefined;
  formatPrice: (p: number) => string;
  background: string;
  text: string;
  up: string;
  down: string;
}

const HEADER = 34;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * The chart as an image, with a header line: symbol and timeframe, the last bar's OHLC,
 * and a small "ChartDesk" mark with the date on the right.
 */
export function renderSnapshot(chart: IChartApi, info: SnapshotInfo): HTMLCanvasElement {
  const shot = chart.takeScreenshot(true, false);
  const cssWidth = chart.chartElement().clientWidth || shot.width;
  const scale = shot.width / cssWidth;

  const out = document.createElement('canvas');
  out.width = shot.width;
  out.height = shot.height + Math.round(HEADER * scale);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = info.background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(shot, 0, Math.round(HEADER * scale));

  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';
  const y = HEADER / 2 + 1;
  let x = 12;

  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = info.text;
  ctx.fillText(info.title, x, y);
  x += ctx.measureText(info.title).width + 14;

  const c = info.candle;
  if (c) {
    const color = c.close >= c.open ? info.up : info.down;
    ctx.font = `12px ${FONT}`;
    for (const [label, value] of [
      ['O', c.open],
      ['H', c.high],
      ['L', c.low],
      ['C', c.close],
    ] as const) {
      ctx.fillStyle = info.text;
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 4;
      const text = info.formatPrice(value);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width + 10;
    }
  }

  // Right side: the app name and when the image was made.
  const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = info.text;
  const right = cssWidth - 12;
  ctx.fillText(when, right, y);
  const whenWidth = ctx.measureText(when).width;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText('ChartDesk', right - whenWidth - 10, y);
  ctx.restore();

  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'),
  );
}

/**
 * Copies an image to the clipboard. The blob is passed as a promise, which Safari needs
 * to keep the click's permission while the image is being made.
 */
export async function copyImage(blob: Promise<Blob>): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('This browser cannot copy images. Use "Download image" instead.');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** "BTCUSDT_1H_2026-11-25_0412.png" */
export function snapshotFileName(symbol: string, tfLabel: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const safe = symbol.replace(/[^\w.-]+/g, '_') || 'chart';
  return `${safe}_${tfLabel}_${stamp}.png`;
}
