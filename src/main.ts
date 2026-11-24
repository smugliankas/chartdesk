import './style.css';
import type { CandlestickData, Time } from 'lightweight-charts';
import { ChartController } from './chart/ChartController';
import { DrawingManager } from './drawings/DrawingManager';
import { TOOLS, type ToolId } from './drawings/model';
import { csv, getProvider, PROVIDERS, type DataProvider } from './providers';
import { TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from './types';

// --- elements ----------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSelect = $<HTMLSelectElement>('provider');
const symbolInput = $<HTMLInputElement>('symbol');
const loadButton = $<HTMLButtonElement>('load');
const csvButton = $<HTMLLabelElement>('csvButton');
const csvFile = $<HTMLInputElement>('csvFile');
const tfGroup = $<HTMLDivElement>('timeframes');
const toolGroup = $<HTMLDivElement>('tools');
const statusEl = $<HTMLSpanElement>('status');
const legendEl = $<HTMLDivElement>('legend');
const chartEl = $<HTMLDivElement>('chart');

// --- settings (remembered between visits) -------------------------------------

interface Settings {
  provider: string;
  timeframe: Timeframe;
  symbols: Record<string, string>;
}

const SETTINGS_KEY = 'chart-app:settings';

function loadSettings(): Settings {
  const fallback: Settings = { provider: 'binance', timeframe: '1h', symbols: { binance: 'BTCUSDT' } };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) } : fallback;
  } catch {
    return fallback;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const settings = loadSettings();

// --- state -------------------------------------------------------------------

let provider: DataProvider = getProvider(settings.provider);
let symbol = provider.freeSymbolInput ? (settings.symbols[provider.id] ?? '') : '';
let timeframe: Timeframe = TIMEFRAMES.includes(settings.timeframe) ? settings.timeframe : '1h';
let stopLive: (() => void) | null = null;
let loadSeq = 0;

const cc = new ChartController(chartEl);
const drawings = new DrawingManager(cc, chartEl);

// --- UI setup ------------------------------------------------------------------

for (const p of PROVIDERS) {
  providerSelect.append(new Option(p.name, p.id));
}

const tfButtons = new Map<Timeframe, HTMLButtonElement>();
for (const tf of TIMEFRAMES) {
  const b = document.createElement('button');
  b.textContent = tf;
  b.addEventListener('click', () => {
    timeframe = tf;
    settings.timeframe = tf;
    saveSettings();
    void load();
  });
  tfButtons.set(tf, b);
  tfGroup.append(b);
}

const toolButtons = new Map<ToolId, HTMLButtonElement>();
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.title = t.title;
  b.addEventListener('click', () => drawings.setTool(t.id));
  toolButtons.set(t.id, b);
  toolGroup.append(b);
}
drawings.onToolChange((tool) => {
  for (const [id, b] of toolButtons) b.classList.toggle('active', id === tool);
});

$<HTMLButtonElement>('deleteSelected').addEventListener('click', () => drawings.deleteSelected());
$<HTMLButtonElement>('clearAll').addEventListener('click', () => {
  if (drawings.drawings.length && confirm(`Remove all ${drawings.drawings.length} drawings on ${symbol}?`)) {
    drawings.clearAll();
  }
});

providerSelect.addEventListener('change', () => {
  provider = getProvider(providerSelect.value);
  settings.provider = provider.id;
  saveSettings();
  symbol = provider.freeSymbolInput ? (settings.symbols[provider.id] ?? '') : '';
  syncProviderUi();
  if (provider.freeSymbolInput && symbol) void load();
  else if (!provider.freeSymbolInput) {
    stopLive?.();
    stopLive = null;
    setStatus('Open a CSV file to start.');
  }
});

loadButton.addEventListener('click', () => submitSymbol());
symbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSymbol();
});

csvFile.addEventListener('change', async () => {
  const file = csvFile.files?.[0];
  csvFile.value = '';
  if (!file) return;
  try {
    setStatus(`Reading ${file.name}…`);
    symbol = await csv.loadFile(file);
    symbolInput.value = symbol;
    const base = csv.baseTimeframe(symbol);
    if (TF_SECONDS[timeframe] < TF_SECONDS[base]) timeframe = base;
    await load();
  } catch (err) {
    setStatus(errorMessage(err), true);
  }
});

function submitSymbol(): void {
  const s = symbolInput.value.trim().toUpperCase();
  if (!s) return;
  symbol = s;
  settings.symbols[provider.id] = s;
  saveSettings();
  void load();
}

function syncProviderUi(): void {
  providerSelect.value = provider.id;
  symbolInput.value = symbol;
  symbolInput.disabled = !provider.freeSymbolInput;
  loadButton.classList.toggle('hidden', !provider.freeSymbolInput);
  csvButton.classList.toggle('hidden', provider.id !== csv.id);
}

function syncTimeframeUi(): void {
  for (const [tf, b] of tfButtons) b.classList.toggle('active', tf === timeframe);
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function errorMessage(err: unknown): string {
  if (err instanceof TypeError) return 'Network error. Check your connection.';
  return err instanceof Error ? err.message : String(err);
}

// --- loading -------------------------------------------------------------------

async function load(): Promise<void> {
  if (!symbol) return;
  const seq = ++loadSeq;
  stopLive?.();
  stopLive = null;
  syncTimeframeUi();
  setStatus(`Loading ${symbol} ${timeframe}…`);

  try {
    const candles = await provider.getCandles(symbol, timeframe);
    if (seq !== loadSeq) return; // a newer request has started
    if (candles.length === 0) throw new Error(`No data for ${symbol}.`);

    cc.setData(candles, TF_SECONDS[timeframe]);
    drawings.setStorageKey(`${provider.id}:${symbol}`);
    showLegend(cc.lastCandle);
    setStatus(`${symbol} · ${timeframe} · ${candles.length} bars`);

    if (provider.subscribe) {
      stopLive = provider.subscribe(symbol, timeframe, (c) => {
        if (seq !== loadSeq) return;
        cc.update(c);
        if (!crosshairActive) showLegend(c);
      });
    }
  } catch (err) {
    if (seq === loadSeq) setStatus(errorMessage(err), true);
  }
}

// --- OHLC legend -------------------------------------------------------------------

let crosshairActive = false;

cc.chart.subscribeCrosshairMove((param) => {
  const bar = param.seriesData.get(cc.candles) as CandlestickData<Time> | undefined;
  crosshairActive = !!bar;
  showLegend(bar ? { time: bar.time as number, open: bar.open, high: bar.high, low: bar.low, close: bar.close } : cc.lastCandle);
});

function showLegend(c: Candle | undefined): void {
  if (!c) {
    legendEl.textContent = '';
    return;
  }
  const cls = c.close >= c.open ? 'up' : 'down';
  const f = (n: number) => cc.formatPrice(n);
  legendEl.innerHTML =
    `<b></b>O <span class="${cls}">${f(c.open)}</span>  H <span class="${cls}">${f(c.high)}</span>  ` +
    `L <span class="${cls}">${f(c.low)}</span>  C <span class="${cls}">${f(c.close)}</span>`;
  // Symbol names come from user input or file names, so set them as text, never as HTML.
  legendEl.querySelector('b')!.textContent = `${symbol} · ${timeframe}`;
}

// --- start ----------------------------------------------------------------------------

syncProviderUi();
syncTimeframeUi();
drawings.setTool('cursor');
if (provider.freeSymbolInput && symbol) void load();
else setStatus('Open a CSV file to start.');
