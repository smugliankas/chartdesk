import './style.css';
import type { CandlestickData, Time } from 'lightweight-charts';
import { effectiveTextColor, loadAppearance, saveAppearance, type Appearance } from './chart/appearance';
import { ChartController } from './chart/ChartController';
import { BarCountdown } from './chart/countdown';
import { DrawingManager } from './drawings/DrawingManager';
import type { ToolId } from './drawings/model';
import { csv, getProvider, PROVIDERS, type DataProvider } from './providers';
import { TF_LABELS, TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from './types';
import { createSettingsDialog } from './ui/settingsDialog';
import { createStyleBar } from './ui/styleBar';
import { attachSymbolSearch } from './ui/symbolSearch';
import { ALT, ICONS, MOD, TOOLBAR, toolTitle } from './ui/tools';

// --- elements ----------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSelect = $<HTMLSelectElement>('provider');
const symbolInput = $<HTMLInputElement>('symbol');
const csvButton = $<HTMLLabelElement>('csvButton');
const csvFile = $<HTMLInputElement>('csvFile');
const tfGroup = $<HTMLDivElement>('timeframes');
const sidebar = $<HTMLElement>('sidebar');
const undoButton = $<HTMLButtonElement>('undo');
const redoButton = $<HTMLButtonElement>('redo');
const statusEl = $<HTMLSpanElement>('status');
const legendEl = $<HTMLDivElement>('legend');
const chartWrap = $<HTMLElement>('chartWrap');
const chartEl = $<HTMLDivElement>('chart');
const controlsEl = $<HTMLDivElement>('chartControls');
const toLatestButton = $<HTMLButtonElement>('toLatest');
const logButton = $<HTMLButtonElement>('logScale');
const volumeButton = $<HTMLButtonElement>('volume');
const autoButton = $<HTMLButtonElement>('autoScale');

// --- settings (remembered between visits) -------------------------------------

interface Settings {
  provider: string;
  timeframe: Timeframe;
  symbols: Record<string, string>;
  magnet: boolean;
}

const SETTINGS_KEY = 'chartdesk:settings';
const OLD_SETTINGS_KEY = 'chart-app:settings'; // before the project was named ChartDesk

function loadSettings(): Settings {
  const fallback: Settings = { provider: 'binance', timeframe: '1h', symbols: { binance: 'BTCUSDT' }, magnet: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(OLD_SETTINGS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) } : fallback;
  } catch {
    return fallback;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.removeItem(OLD_SETTINGS_KEY);
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
let historyLoading = false;
let historyDone = false;

const cc = new ChartController(chartEl);
const drawings = new DrawingManager(cc, chartEl);
const countdown = new BarCountdown(cc);
cc.candles.attachPrimitive(countdown);
/** Timeframe of the live (still forming) bars on screen, or null for static data like a CSV file. */
let liveTimeframe: Timeframe | null = null;

function syncCountdown(): void {
  countdown.setTimeframe(cc.appearance.countdown ? liveTimeframe : null);
}
drawings.setMagnet(settings.magnet);

// --- appearance ---------------------------------------------------------------

function applyAppearance(a: Appearance): void {
  cc.applyAppearance(a);
  saveAppearance(a);
  document.body.classList.toggle('light', a.theme === 'light');
  document.body.style.setProperty('--up', a.upColor);
  document.body.style.setProperty('--down', a.downColor);
  document.body.style.setProperty('--chart-text', effectiveTextColor(a));
  volumeButton.classList.toggle('active', a.showVolume);
  drawings.redraw();
  syncCountdown();
}

const settingsDialog = createSettingsDialog(() => cc.appearance, applyAppearance);
applyAppearance(loadAppearance());

// --- top bar ---------------------------------------------------------------------

for (const p of PROVIDERS) providerSelect.append(new Option(p.name, p.id));

const tfButtons = new Map<Timeframe, HTMLButtonElement>();
for (const tf of TIMEFRAMES) {
  const b = document.createElement('button');
  b.textContent = TF_LABELS[tf];
  b.addEventListener('click', () => {
    timeframe = tf;
    settings.timeframe = tf;
    saveSettings();
    void load();
  });
  tfButtons.set(tf, b);
  tfGroup.append(b);
}

undoButton.innerHTML = ICONS.undo;
undoButton.title = `Undo (${MOD}Z)`;
undoButton.addEventListener('click', () => drawings.undo());
redoButton.innerHTML = ICONS.redo;
redoButton.title = `Redo (${MOD}⇧Z)`;
redoButton.addEventListener('click', () => drawings.redo());

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
    liveTimeframe = null;
    syncCountdown();
    setStatus('Open a CSV file to start.');
  }
});

attachSymbolSearch(symbolInput, {
  search: (q) => provider.searchSymbols?.(q) ?? null,
  onPick: (s) => {
    symbol = s.toUpperCase();
    settings.symbols[provider.id] = symbol;
    saveSettings();
    void load();
  },
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

function syncProviderUi(): void {
  providerSelect.value = provider.id;
  symbolInput.value = symbol;
  symbolInput.disabled = !provider.freeSymbolInput;
  csvButton.classList.toggle('hidden', provider.id !== csv.id);
}

function syncTimeframeUi(): void {
  for (const [tf, b] of tfButtons) b.classList.toggle('active', tf === timeframe);
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function showReadyStatus(): void {
  setStatus(`${symbol} · ${TF_LABELS[timeframe]} · ${cc.barCount.toLocaleString()} bars`);
}

function errorMessage(err: unknown): string {
  if (err instanceof TypeError) return 'Network error. Check your connection.';
  return err instanceof Error ? err.message : String(err);
}

// --- left toolbar ------------------------------------------------------------------

const toolButtons = new Map<ToolId, HTMLButtonElement>();

function sidebarButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'tool';
  b.innerHTML = icon;
  b.title = title;
  b.addEventListener('click', onClick);
  sidebar.append(b);
  return b;
}

function separator(): void {
  sidebar.append(Object.assign(document.createElement('div'), { className: 'sep' }));
}

for (const t of TOOLBAR) {
  if (!t) {
    separator();
    continue;
  }
  const b = sidebarButton(ICONS[t.id], toolTitle(t), () =>
    drawings.setTool(drawings.currentTool === t.id && t.id !== 'cursor' ? 'cursor' : t.id),
  );
  toolButtons.set(t.id, b);
}
separator();
const magnetButton = sidebarButton(ICONS.magnet, 'Magnet: snap to open/high/low/close', () => {
  drawings.setMagnet(!drawings.magnetOn);
  settings.magnet = drawings.magnetOn;
  saveSettings();
});
const deleteButton = sidebarButton(ICONS.trash, 'Delete selected drawing (Del)', () => drawings.deleteSelected());
const clearButton = sidebarButton(ICONS.trashAll, 'Remove all drawings on this symbol', () => {
  if (drawings.drawings.length && confirm(`Remove all ${drawings.drawings.length} drawings on ${symbol}?`)) {
    drawings.clearAll();
  }
});
clearButton.classList.add('danger');

const syncStyleBar = createStyleBar(chartWrap, drawings);

drawings.onToolChange((tool) => {
  for (const [id, b] of toolButtons) b.classList.toggle('active', id === tool);
});
drawings.onChange(() => {
  syncStyleBar();
  undoButton.disabled = !drawings.canUndo;
  redoButton.disabled = !drawings.canRedo;
  deleteButton.disabled = !drawings.selectedId;
  clearButton.disabled = drawings.drawings.length === 0;
  magnetButton.classList.toggle('active', drawings.magnetOn);
});

// Alt/Option + key selects a tool.
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (!e.altKey || e.metaKey || e.ctrlKey) return;
  const t = TOOLBAR.find((d) => d?.key === e.code);
  if (t) {
    e.preventDefault();
    drawings.setTool(t.id);
  }
});

// --- chart controls (bottom right of the chart) -----------------------------------------

toLatestButton.innerHTML = ICONS.toLatest;
toLatestButton.addEventListener('click', () => cc.scrollToRealtime());
logButton.addEventListener('click', () => {
  cc.setLogScale(!cc.isLogScale());
  syncControls();
});
volumeButton.addEventListener('click', () => {
  applyAppearance({ ...cc.appearance, showVolume: !cc.appearance.showVolume });
  settingsDialog.sync();
});
autoButton.addEventListener('click', () => {
  cc.setAutoScale(!cc.isAutoScale());
  syncControls();
});

function syncControls(): void {
  controlsEl.style.right = `${cc.priceScaleWidth() + 8}px`;
  controlsEl.style.bottom = `${cc.timeScaleHeight() + 8}px`;
  toLatestButton.classList.toggle('hidden', cc.barCount === 0 || cc.isLastBarVisible());
  logButton.classList.toggle('active', cc.isLogScale());
  autoButton.classList.toggle('active', cc.isAutoScale());
}

// Dragging or wheeling the price scale turns auto-scale off; refresh the button afterwards.
chartWrap.addEventListener('mouseup', () => requestAnimationFrame(syncControls));
chartWrap.addEventListener('wheel', () => requestAnimationFrame(syncControls), { passive: true });
new ResizeObserver(() => requestAnimationFrame(syncControls)).observe(chartWrap);

cc.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  syncControls();
  if (range && range.from < 30) void loadOlder();
});

// --- loading -------------------------------------------------------------------

async function load(): Promise<void> {
  if (!symbol) return;
  const seq = ++loadSeq;
  stopLive?.();
  stopLive = null;
  liveTimeframe = null;
  syncCountdown();
  historyLoading = false;
  historyDone = false;
  syncTimeframeUi();
  setStatus(`Loading ${symbol} ${TF_LABELS[timeframe]}…`);

  try {
    const candles = await provider.getCandles(symbol, timeframe);
    if (seq !== loadSeq) return; // a newer request has started
    if (candles.length === 0) throw new Error(`No data for ${symbol}.`);

    cc.setData(candles, TF_SECONDS[timeframe]);
    drawings.setStorageKey(`${provider.id}:${symbol}`);
    showLegend(cc.lastCandle);
    showReadyStatus();
    syncControls();

    if (provider.subscribe) {
      liveTimeframe = timeframe;
      syncCountdown();
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

/** Loads the page of history before the first bar when the user scrolls to the left edge. */
async function loadOlder(): Promise<void> {
  const before = cc.firstTime;
  if (historyLoading || historyDone || !provider.getCandlesBefore || before === undefined) return;
  const seq = loadSeq;
  historyLoading = true;
  setStatus('Loading older bars…');
  try {
    const older = await provider.getCandlesBefore(symbol, timeframe, before);
    if (seq !== loadSeq) return;
    if (cc.prependData(older) === 0) historyDone = true;
    showReadyStatus();
  } catch (err) {
    if (seq === loadSeq) setStatus(errorMessage(err), true);
  } finally {
    if (seq === loadSeq) historyLoading = false;
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
  legendEl.querySelector('b')!.textContent = `${symbol} · ${TF_LABELS[timeframe]}`;
}

// --- About dialog ------------------------------------------------------------------

const aboutDialog = $<HTMLDialogElement>('aboutDialog');
const settingsButton = $<HTMLButtonElement>('settings');
settingsButton.innerHTML = ICONS.settings;
settingsButton.addEventListener('click', () => settingsDialog.open());

const aboutButton = $<HTMLButtonElement>('about');
aboutButton.innerHTML = ICONS.info;
aboutButton.addEventListener('click', () => aboutDialog.showModal());
aboutDialog.addEventListener('click', (e) => {
  if (e.target === aboutDialog) aboutDialog.close(); // click on the backdrop
});

const shortcuts: [string, string][] = [
  ...TOOLBAR.filter((t) => t?.key).map((t) => [`${ALT}${t!.key!.replace('Key', '')}`, t!.title] as [string, string]),
  ['Shift + click', 'Measure'],
  ['Esc', 'Cursor / cancel'],
  ['Del', 'Delete selected drawing'],
  [`${MOD}Z`, 'Undo'],
  [`${MOD}⇧Z`, 'Redo'],
  ['Double-click text', 'Edit text'],
];
const shortcutTable = $<HTMLTableElement>('shortcutTable');
for (const [key, what] of shortcuts) {
  const row = shortcutTable.insertRow();
  row.insertCell().append(Object.assign(document.createElement('kbd'), { textContent: key }));
  row.insertCell().textContent = what;
}

// --- start ----------------------------------------------------------------------------

syncProviderUi();
syncTimeframeUi();
drawings.setTool('cursor');
if (provider.freeSymbolInput && symbol) void load();
else setStatus('Open a CSV file to start.');
