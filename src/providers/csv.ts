import { TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from '../types';
import type { DataProvider } from './types';

interface Dataset {
  candles: Candle[];
  /** Bar size of the file, in seconds. */
  interval: number;
}

/**
 * Loads candles from a CSV/TSV file on the user's computer.
 *
 * Works with MetaTrader 5's "Export Bars" files (<DATE> <TIME> <OPEN> …) and with
 * most generic exports that have time/open/high/low/close columns.
 * Higher timeframes are built from the file's own bars.
 */
export class CsvProvider implements DataProvider {
  readonly id = 'csv';
  readonly name = 'CSV file';
  readonly freeSymbolInput = false;

  private datasets = new Map<string, Dataset>();

  /** Parses a file and returns the symbol name to use for it. */
  async loadFile(file: File): Promise<string> {
    const candles = parseCsv(await file.text());
    const symbol = file.name.replace(/\.(csv|txt|tsv)$/i, '');
    this.datasets.set(symbol, { candles, interval: detectInterval(candles) });
    return symbol;
  }

  /** The smallest supported timeframe that is not below the file's own bar size. */
  baseTimeframe(symbol: string): Timeframe {
    const ds = this.datasets.get(symbol);
    if (!ds) return '1h';
    return TIMEFRAMES.find((tf) => TF_SECONDS[tf] >= ds.interval) ?? '1w';
  }

  async getCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
    const ds = this.datasets.get(symbol);
    if (!ds) throw new Error('Open a CSV file first.');
    const target = TF_SECONDS[tf];
    if (target < ds.interval) {
      throw new Error(`This file has ${this.baseTimeframe(symbol)} bars. Pick ${this.baseTimeframe(symbol)} or higher.`);
    }
    if (target === ds.interval) return ds.candles.slice();
    return resample(ds.candles, target);
  }
}

// ---------------------------------------------------------------------------

export function parseCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('The file has no data rows.');

  const delim = detectDelimiter(lines[0]);
  const header = lines[0].split(delim).map((h) => h.replace(/[<>"']/g, '').trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const iDate = col('date', 'day');
  const iTime = col('time', 'timestamp', 'datetime', 'date_time', 'open_time', 'opentime', 'unix', 'gmt time', 'local time');
  const iOpen = col('open', 'o');
  const iHigh = col('high', 'h');
  const iLow = col('low', 'l');
  const iClose = col('close', 'c');
  const iVol = col('tickvol', 'tick_volume', 'volume', 'vol', 'real_volume', 'v');

  if ((iDate < 0 && iTime < 0) || iOpen < 0 || iHigh < 0 || iLow < 0 || iClose < 0) {
    throw new Error('Could not find the columns. The first row must be a header with date/time, open, high, low, close.');
  }

  const out: Candle[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = lines[n].split(delim).map((c) => c.replace(/"/g, '').trim());
    let rawTime: string;
    if (iDate >= 0 && iTime >= 0) rawTime = `${cells[iDate]} ${cells[iTime]}`;
    else rawTime = cells[iTime >= 0 ? iTime : iDate];

    const time = parseTime(rawTime);
    const candle: Candle = {
      time,
      open: parseNumber(cells[iOpen]),
      high: parseNumber(cells[iHigh]),
      low: parseNumber(cells[iLow]),
      close: parseNumber(cells[iClose]),
    };
    if (iVol >= 0) candle.volume = parseNumber(cells[iVol]);
    if ([candle.time, candle.open, candle.high, candle.low, candle.close].some((v) => !Number.isFinite(v))) continue;
    out.push(candle);
  }

  if (out.length === 0) throw new Error('No valid rows found in the file.');

  out.sort((a, b) => a.time - b.time);
  // Drop duplicate timestamps (keep the last one).
  const deduped: Candle[] = [];
  for (const c of out) {
    if (deduped.length && deduped[deduped.length - 1].time === c.time) deduped[deduped.length - 1] = c;
    else deduped.push(c);
  }
  return deduped;
}

function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ';', ','];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function parseNumber(s: string | undefined): number {
  if (s === undefined || s === '') return NaN;
  return Number(s);
}

/** Accepts UNIX seconds/ms, YYYYMMDD, ISO dates and MT5's "2024.01.02 13:00". Times without a zone are read as UTC. */
function parseTime(raw: string | undefined): number {
  if (!raw) return NaN;
  const s = raw.trim();
  if (/^\d{8}$/.test(s)) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 1000;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Math.floor(n > 1e11 ? n / 1000 : n);
  }
  let iso = s.replace(/^(\d{4})[./](\d{2})[./](\d{2})/, '$1-$2-$3').replace(' ', 'T');
  if (/T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}

/** Most common gap between consecutive bars. */
function detectInterval(candles: Candle[]): number {
  const counts = new Map<number, number>();
  const n = Math.min(candles.length, 500);
  for (let i = 1; i < n; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 3600;
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount || (c === bestCount && d < best)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

// Monday 1970-01-05 00:00 UTC, so weekly bars start on Monday like most platforms.
const WEEK_ANCHOR = 4 * 86400;

function bucketStart(time: number, seconds: number): number {
  if (seconds === TF_SECONDS['1w']) return Math.floor((time - WEEK_ANCHOR) / seconds) * seconds + WEEK_ANCHOR;
  return Math.floor(time / seconds) * seconds;
}

function resample(candles: Candle[], seconds: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = bucketStart(c.time, seconds);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      if (c.volume !== undefined) last.volume = (last.volume ?? 0) + c.volume;
    } else {
      out.push({ ...c, time: t });
    }
  }
  return out;
}
