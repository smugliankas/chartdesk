import './style.css';
import { IS_MAC, modifierHeld } from './platform';
import type { CandlestickData, Time } from 'lightweight-charts';
import { AlertManager, alertTarget, type PriceAlert } from './alerts/AlertManager';
import { AlertsPrimitive } from './alerts/AlertsPrimitive';
import { attachAlertInteraction } from './alerts/alertInteraction';
import {
  flashTitle,
  playAlertSound,
  requestNotificationPermission,
  showBrowserNotification,
  showToast,
  unlockAudioOnFirstInteraction,
} from './alerts/notify';
import { chooseAndRestoreBackup, downloadBackup, downloadBlob } from './backup';
import { effectiveTextColor, loadAppearance, readable, saveAppearance, type Appearance } from './chart/appearance';
import { ChartController } from './chart/ChartController';
import { BarCountdown } from './chart/countdown';
import { DrawingManager } from './drawings/DrawingManager';
import type { Drawing, ToolId } from './drawings/model';
import { csv, getProvider, PROVIDERS, type DataProvider } from './providers';
import { TF_LABELS, TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from './types';
import { createAlertsPanel } from './ui/alertsPanel';
import { showContextMenu, type MenuEntry } from './ui/contextMenu';
import { createSettingsDialog } from './ui/settingsDialog';
import { createStyleBar } from './ui/styleBar';
import { attachSymbolSearch } from './ui/symbolSearch';
import { canvasToBlob, copyImage, renderSnapshot, snapshotFileName } from './ui/snapshot';
import { createDrawingsList } from './ui/drawingsList';
import { AUTO_SCALE_KEYS, FULLSCREEN_KEYS, setupFullscreen } from './ui/fullscreen';
import { createRightPanel } from './ui/rightPanel';
import { createWatchlist } from './ui/watchlist';
import { installTooltips } from './ui/tooltips';
import { ALT, HOLD, ICONS, MOD, TOOL_GROUPS, TOOLS, toolDef, toolTitle } from './ui/tools';

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
  drawingsHidden: boolean;
  /** The tool each toolbar group shows, by the group's first tool. */
  toolGroups: Partial<Record<ToolId, ToolId>>;
}

const SETTINGS_KEY = 'chartdesk:settings';
const OLD_SETTINGS_KEY = 'chart-app:settings'; // before the project was named ChartDesk

function loadSettings(): Settings {
  const fallback: Settings = { provider: 'binance', timeframe: '1h', symbols: { binance: 'BTCUSDT' }, magnet: false, drawingsHidden: false, toolGroups: {} };
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
drawings.setHidden(settings.drawingsHidden);

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

const settingsDialog = createSettingsDialog(() => cc.appearance, applyAppearance, {
  onExport: () => {
    const s = downloadBackup();
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    setStatus(`Backup saved: ${n(s.drawings, 'drawing')} on ${n(s.drawingSymbols.length, 'symbol')}, ${n(s.alerts, 'alert')}.`);
  },
  onImport: () => chooseAndRestoreBackup((message) => setStatus(message, true)),
});
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

/** One toolbar button per group of tools; it shows the group's last-used tool. */
interface ToolGroupButton {
  tools: readonly ToolId[];
  current: ToolId;
  button: HTMLButtonElement;
  more: HTMLButtonElement | null;
}

const toolGroups: ToolGroupButton[] = [];

function showGroupTool(g: ToolGroupButton): void {
  const def = toolDef(g.current);
  g.button.innerHTML = ICONS[def.id];
  g.button.dataset.tip = toolTitle(def);
  g.button.removeAttribute('title');
}

/** Makes `id` the tool its group's button shows (and remembers it). */
function showInGroup(id: ToolId): void {
  const g = toolGroups.find((x) => x.tools.includes(id));
  if (!g || g.current === id) return;
  g.current = id;
  showGroupTool(g);
  settings.toolGroups[g.tools[0]] = id;
  saveSettings();
}

function pickTool(id: ToolId): void {
  showInGroup(id);
  drawings.setTool(id);
}

for (const [i, tools] of TOOL_GROUPS.entries()) {
  const saved = settings.toolGroups[tools[0]];
  const g: ToolGroupButton = {
    tools,
    current: saved && tools.includes(saved) ? saved : tools[0],
    button: document.createElement('button'),
    more: null,
  };
  const wrap = document.createElement('div');
  wrap.className = 'tool-group' + (tools.length > 1 ? '' : ' single');
  g.button.className = 'tool';
  let suppressClick = false;
  g.button.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    drawings.setTool(drawings.currentTool === g.current && g.current !== 'cursor' ? 'cursor' : g.current);
  });
  wrap.append(g.button);

  if (tools.length > 1) {
    // A strip beside the button opens the group's other tools; so do a right-click and a long press.
    const more = document.createElement('button');
    more.className = 'tool-more';
    more.innerHTML = ICONS.more;
    more.dataset.tip = 'More tools';
    const openMenu = () => {
      const r = more.getBoundingClientRect();
      more.classList.add('open');
      showContextMenu(
        r.right + 6,
        r.top,
        tools.map((id) => {
          const def = toolDef(id);
          const keys = [def.key && `${ALT}${def.key.replace('Key', '')}`, def.keyLabel].filter(Boolean).join(', ');
          return { label: def.title, icon: ICONS[id], shortcut: keys || undefined, checked: id === drawings.currentTool, action: () => pickTool(id) };
        }),
        () => more.classList.remove('open'),
      );
    };
    // A second click on the strip closes the menu instead of opening it again.
    let wasOpen = false;
    more.addEventListener('mousedown', () => (wasOpen = more.classList.contains('open')));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!wasOpen) openMenu();
    });
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu();
    });
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    g.button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pressTimer = setTimeout(() => {
        suppressClick = true;
        openMenu();
      }, 450);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) g.button.addEventListener(ev, () => clearTimeout(pressTimer));
    wrap.append(more);
    g.more = more;
  }
  sidebar.append(wrap);
  showGroupTool(g);
  toolGroups.push(g);
  if (i === 0) separator();
}
separator();
const magnetButton = sidebarButton(ICONS.magnet, `Magnet: snap to open/high/low/close (hold ${HOLD})`, () => {
  drawings.setMagnet(!drawings.magnetOn);
  settings.magnet = drawings.magnetOn;
  saveSettings();
});
const hideButton = sidebarButton(ICONS.eye, 'Hide all drawings', () => drawings.setHidden(!drawings.hidden));
const deleteButton = sidebarButton(ICONS.trash, 'Delete selected drawing (Del)', () => drawings.deleteSelected());
const clearButton = sidebarButton(ICONS.trashAll, 'Remove all drawings on this symbol', () => {
  if (drawings.drawings.length && confirm(`Remove all ${drawings.drawings.length} drawings on ${symbol}?`)) {
    drawings.clearAll();
  }
});
clearButton.classList.add('danger');

// --- alerts -------------------------------------------------------------------------

const alerts = new AlertManager();
const alertsPrimitive = new AlertsPrimitive(cc, () => alerts.forSymbol(provider.id, symbol));
cc.candles.attachPrimitive(alertsPrimitive);
unlockAudioOnFirstInteraction();

/** Price under the mouse on the chart, for ⌥A. */
let crosshairPrice: number | null = null;

function canAlert(): boolean {
  if (provider.subscribe) return true;
  setStatus('Alerts need live data, e.g. Binance.', true);
  return false;
}

/** Alert at a fixed price. */
function addAlertAt(price: number, drawingId?: string): void {
  if (!canAlert()) return;
  alerts.add({ providerId: provider.id, symbol, price, priceText: cc.formatPrice(price), currentPrice: cc.lastCandle?.close, drawingId });
  void requestNotificationPermission();
  setStatus(`Alert set: ${symbol} crossing ${cc.formatPrice(price)}`);
}

const ALERTABLE: readonly Drawing['type'][] = ['hline', 'hray', 'cross', 'trend', 'ray', 'extended', 'arrow'];

/** The fixed alert level of a horizontal drawing, if it is one. */
function levelOf(d: Drawing): number | null {
  if (d.type === 'hline') return d.price;
  if (d.type === 'hray' || d.type === 'cross') return d.p.price;
  return null;
}

/** Alert on a drawing: a fixed level for a horizontal line, a moving level for a sloped line. */
function addDrawingAlert(d: Drawing): void {
  if (!canAlert()) return;
  const level = levelOf(d);
  if (level !== null) return addAlertAt(level, d.id);
  if (d.type !== 'trend' && d.type !== 'ray' && d.type !== 'extended' && d.type !== 'arrow') return;
  const line = { kind: d.type, p1: d.p1, p2: d.p2 };
  const a = alerts.add({
    providerId: provider.id,
    symbol,
    price: d.p2.price,
    priceText: cc.formatPrice(d.p2.price),
    currentPrice: cc.lastCandle?.close,
    drawingId: d.id,
    line,
  });
  void requestNotificationPermission();
  setStatus(`Alert set: ${symbol} crossing the ${alertTarget(a)}`);
}

/** Opens a symbol on the chart, switching the data source if needed. */
function selectSymbol(providerId: string, newSymbol: string): void {
  if (providerId !== provider.id) {
    provider = getProvider(providerId);
    settings.provider = provider.id;
  }
  symbol = newSymbol;
  if (provider.freeSymbolInput) settings.symbols[provider.id] = symbol;
  saveSettings();
  syncProviderUi();
  void load();
}

const alertsPanel = createAlertsPanel({
  button: $<HTMLButtonElement>('alerts'),
  manager: alerts,
  context: () => ({ canAlert: !!provider.subscribe && cc.barCount > 0, price: cc.lastCandle?.close, format: (p) => cc.formatPrice(p) }),
  onAdd: (price) => addAlertAt(price),
  onSelect: (a: PriceAlert) => selectSymbol(a.providerId, a.symbol),
});

alerts.onTrigger((a, price) => {
  const decimals = a.priceText.split('.')[1]?.length ?? 2;
  const title = `${a.symbol} crossed ${a.line ? 'the ' : ''}${alertTarget(a)}`;
  const body = `Price is now ${price.toFixed(decimals)}`;
  playAlertSound();
  showToast(title, body);
  showBrowserNotification(title, body);
  flashTitle(title);
});

/** Keeps alerts that sit on a drawing in step with it (moved or deleted). */
function syncLineAlerts(): void {
  for (const a of [...alerts.all]) {
    if (!a.drawingId || `${a.providerId}:${a.symbol}` !== drawings.currentKey) continue;
    const d = drawings.drawings.find((x) => x.id === a.drawingId);
    if (!d || !ALERTABLE.includes(d.type)) {
      alerts.remove(a.id);
    } else if (levelOf(d) !== null) {
      const level = levelOf(d)!;
      if (level !== a.price) alerts.update(a.id, { price: level, priceText: cc.formatPrice(level) });
    } else if (d.type === 'trend' || d.type === 'ray' || d.type === 'extended' || d.type === 'arrow') {
      const l = a.line;
      const moved = !l || l.p1.time !== d.p1.time || l.p1.price !== d.p1.price || l.p2.time !== d.p2.time || l.p2.price !== d.p2.price;
      if (moved) {
        alerts.update(a.id, {
          price: d.p2.price,
          priceText: cc.formatPrice(d.p2.price),
          line: { kind: d.type, p1: d.p1, p2: d.p2 },
        });
      }
    }
  }
}

const syncStyleBar = createStyleBar(chartWrap, drawings, {
  supports: (d) => ALERTABLE.includes(d.type),
  has: (id) => alerts.all.some((a) => a.drawingId === id && !a.triggeredAt),
  toggle: (d) => {
    const existing = alerts.all.filter((a) => a.drawingId === d.id);
    const hadActive = existing.some((a) => !a.triggeredAt);
    existing.forEach((a) => alerts.remove(a.id));
    if (!hadActive) addDrawingAlert(d);
  },
});

// Bell next to the price scale, following the cursor: click to add an alert at that price.
const priceAlertButton = $<HTMLButtonElement>('priceAlertButton');
priceAlertButton.innerHTML = ICONS.bell;
let priceAlertPrice: number | null = null;
let priceAlertHover = false;
let priceAlertHideTimer: ReturnType<typeof setTimeout> | undefined;

function hidePriceAlertButtonSoon(): void {
  clearTimeout(priceAlertHideTimer);
  priceAlertHideTimer = setTimeout(() => {
    if (!priceAlertHover) priceAlertButton.classList.add('hidden');
  }, 400);
}

function placePriceAlertButton(y: number | null): void {
  const price = y === null ? null : cc.yToPrice(y);
  if (y === null || price === null || !provider.subscribe || drawings.currentTool !== 'cursor' || hoveringAlertLine) {
    hidePriceAlertButtonSoon();
    return;
  }
  clearTimeout(priceAlertHideTimer);
  priceAlertPrice = price;
  priceAlertButton.style.top = `${Math.round(y) - 11}px`;
  priceAlertButton.style.right = `${cc.priceScaleWidth() + 4}px`;
  priceAlertButton.title = `Add alert at ${cc.formatPrice(price)}`;
  priceAlertButton.classList.remove('hidden');
}

priceAlertButton.addEventListener('mouseenter', () => (priceAlertHover = true));
priceAlertButton.addEventListener('mouseleave', () => {
  priceAlertHover = false;
  hidePriceAlertButtonSoon();
});
priceAlertButton.addEventListener('click', () => {
  if (priceAlertPrice !== null) addAlertAt(priceAlertPrice);
});

// Hover an alert line for its price and a × to delete it; drag it to move the alert.
let hoveringAlertLine = false;
attachAlertInteraction({
  host: chartWrap,
  chartEl,
  cc,
  manager: alerts,
  primitive: alertsPrimitive,
  isCursor: () => drawings.currentTool === 'cursor',
  onHoverChange: (h) => {
    hoveringAlertLine = h;
    if (h) priceAlertButton.classList.add('hidden');
  },
});

alerts.onChange(() => {
  alertsPrimitive.requestUpdate();
  alertsPanel.sync();
  syncStyleBar();
});

drawings.onToolChange((tool) => {
  // A tool picked by shortcut becomes its group's tool, like picking it from the menu.
  showInGroup(tool);
  for (const x of toolGroups) x.button.classList.toggle('active', x.current === tool);
});
drawings.onChange(() => {
  syncLineAlerts();
  syncStyleBar();
  undoButton.disabled = !drawings.canUndo;
  redoButton.disabled = !drawings.canRedo;
  deleteButton.disabled = !drawings.selectedId;
  hideButton.innerHTML = drawings.hidden ? ICONS.eyeOff : ICONS.eye;
  hideButton.classList.toggle('active', drawings.hidden);
  hideButton.dataset.tip = drawings.hidden ? 'Show drawings' : 'Hide all drawings';
  hideButton.removeAttribute('title');
  if (settings.drawingsHidden !== drawings.hidden) {
    settings.drawingsHidden = drawings.hidden;
    saveSettings();
  }
  clearButton.disabled = drawings.drawings.length === 0;
  magnetButton.classList.toggle('active', drawings.magnetOn);
});

// Alt/Option + key selects a tool.
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (!e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.code === 'KeyA') {
    e.preventDefault();
    const price = crosshairPrice ?? cc.lastCandle?.close;
    if (price !== undefined) addAlertAt(price);
    return;
  }
  const t = TOOLS.find((d) => d.key === e.code);
  if (t) {
    e.preventDefault();
    drawings.setTool(t.id);
  }
});

// --- right-click menu ------------------------------------------------------------------

chartEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { clientX, clientY } = e;
  const d = drawings.currentTool === 'cursor' ? drawings.selectAt(clientX, clientY) : null;

  if (d) {
    const alertable = ALERTABLE.includes(d.type);
    const hasAlert = alerts.all.some((a) => a.drawingId === d.id && !a.triggeredAt);
    const entries: MenuEntry[] = [
      { label: 'Duplicate', shortcut: `${MOD}D`, action: () => drawings.duplicateSelected() },
      { label: 'Copy', shortcut: `${MOD}C`, action: () => drawings.copySelected() },
      { label: d.locked ? 'Unlock' : 'Lock', action: () => drawings.toggleLock(d.id) },
      null,
      { label: 'Bring to front', action: () => drawings.bringToFront(d.id) },
      { label: 'Send to back', action: () => drawings.sendToBack(d.id) },
    ];
    if (alertable) {
      entries.push(null, {
        label: hasAlert ? 'Remove alert' : 'Add alert on this line',
        disabled: !provider.subscribe,
        action: () => {
          const existing = alerts.all.filter((a) => a.drawingId === d.id);
          existing.forEach((a) => alerts.remove(a.id));
          if (!hasAlert) addDrawingAlert(d);
        },
      });
    }
    entries.push(null, { label: 'Delete', shortcut: 'Del', danger: true, action: () => drawings.deleteSelected() });
    showContextMenu(clientX, clientY, entries);
    return;
  }

  const rect = chartEl.getBoundingClientRect();
  const price = cc.yToPrice(clientY - rect.top);
  showContextMenu(clientX, clientY, [
    {
      label: price === null ? 'Add alert' : `Add alert at ${cc.formatPrice(price)}`,
      shortcut: `${ALT}A`,
      disabled: price === null || !provider.subscribe,
      action: () => price !== null && addAlertAt(price),
    },
    { label: 'Paste', shortcut: `${MOD}V`, disabled: !drawings.canPaste, action: () => drawings.paste() },
    null,
    { label: drawings.hidden ? 'Show drawings' : 'Hide all drawings', action: () => drawings.setHidden(!drawings.hidden) },
    {
      label: 'Reset chart view',
      action: () => {
        cc.setAutoScale(true);
        cc.scrollToRealtime();
        syncControls();
      },
    },
    null,
    {
      label: 'Remove all drawings',
      danger: true,
      disabled: drawings.drawings.length === 0,
      action: () => {
        if (confirm(`Remove all ${drawings.drawings.length} drawings on ${symbol}?`)) drawings.clearAll();
      },
    },
  ]);
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
function toggleAutoScale(): void {
  cc.setAutoScale(!cc.isAutoScale());
  syncControls();
}
autoButton.addEventListener('click', toggleAutoScale);
autoButton.title = `Auto-fit the price scale (${AUTO_SCALE_KEYS})`;

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

const loadingBar = document.createElement('div');
loadingBar.id = 'loadingBar';
chartWrap.append(loadingBar);
let pendingLoads = 0;

/** Shows the loading bar until the returned function is called. */
function startLoading(): () => void {
  pendingLoads++;
  loadingBar.classList.add('active');
  return () => {
    pendingLoads = Math.max(0, pendingLoads - 1);
    if (pendingLoads === 0) loadingBar.classList.remove('active');
  };
}

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
  const done = startLoading();
  if (cc.barCount > 0) chartEl.classList.add('loading');

  try {
    const candles = await provider.getCandles(symbol, timeframe);
    if (seq !== loadSeq) return; // a newer request has started
    if (candles.length === 0) throw new Error(`No data for ${symbol}.`);

    cc.setData(candles, TF_SECONDS[timeframe]);
    drawings.setStorageKey(`${provider.id}:${symbol}`);
    watchlist.sync();
    showLegend(cc.lastCandle);
    showReadyStatus();
    syncControls();

    if (provider.subscribe) {
      liveTimeframe = timeframe;
      syncCountdown();
      stopLive = provider.subscribe(symbol, timeframe, (c) => {
        if (seq !== loadSeq) return;
        cc.update(c);
        alerts.observe(provider.id, symbol, c.close);
        if (!crosshairActive) showLegend(c);
      });
    }
  } catch (err) {
    if (seq === loadSeq) setStatus(errorMessage(err), true);
  } finally {
    done();
    if (seq === loadSeq) chartEl.classList.remove('loading');
  }
}

/** Loads the page of history before the first bar when the user scrolls to the left edge. */
async function loadOlder(): Promise<void> {
  const before = cc.firstTime;
  if (historyLoading || historyDone || !provider.getCandlesBefore || before === undefined) return;
  const seq = loadSeq;
  historyLoading = true;
  setStatus('Loading older bars…');
  const done = startLoading();
  try {
    const older = await provider.getCandlesBefore(symbol, timeframe, before);
    if (seq !== loadSeq) return;
    if (cc.prependData(older) === 0) historyDone = true;
    showReadyStatus();
  } catch (err) {
    if (seq === loadSeq) setStatus(errorMessage(err), true);
  } finally {
    done();
    if (seq === loadSeq) historyLoading = false;
  }
}

// --- OHLC legend -------------------------------------------------------------------

let crosshairActive = false;

cc.chart.subscribeCrosshairMove((param) => {
  const bar = param.seriesData.get(cc.candles) as CandlestickData<Time> | undefined;
  crosshairActive = !!bar;
  crosshairPrice = param.point ? cc.yToPrice(param.point.y) : null;
  placePriceAlertButton(param.point ? param.point.y : null);
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

// --- chart image ---------------------------------------------------------------------

const SNAPSHOT_DOWNLOAD_KEYS = IS_MAC ? '⌥⌘S' : 'Ctrl+Alt+S';
const SNAPSHOT_COPY_KEYS = IS_MAC ? '⇧⌘S' : 'Ctrl+Shift+S';

function makeSnapshot(): HTMLCanvasElement {
  const a = cc.appearance;
  const text = effectiveTextColor(a);
  return drawings.whileUnselected(() =>
    renderSnapshot(cc.chart, {
      title: `${symbol} · ${TF_LABELS[timeframe]} · ${provider.name.replace(/\s*\(.*\)$/, '')}`,
      candle: cc.lastCandle,
      formatPrice: (p) => cc.formatPrice(p),
      background: a.background,
      text,
      up: readable(a.upColor, a.background, text),
      down: readable(a.downColor, a.background, text),
    }),
  );
}

async function downloadSnapshot(): Promise<void> {
  if (cc.barCount === 0) return;
  try {
    const blob = await canvasToBlob(makeSnapshot());
    downloadBlob(blob, snapshotFileName(symbol, TF_LABELS[timeframe]));
    setStatus('Chart image saved.');
  } catch (err) {
    setStatus(errorMessage(err), true);
  }
}

async function copySnapshot(): Promise<void> {
  if (cc.barCount === 0) return;
  try {
    await copyImage(canvasToBlob(makeSnapshot()));
    setStatus('Chart image copied. Paste it anywhere.');
  } catch (err) {
    setStatus(errorMessage(err), true);
  }
}

const snapshotButton = $<HTMLButtonElement>('snapshot');
snapshotButton.innerHTML = ICONS.camera;
snapshotButton.addEventListener('click', () => {
  const r = snapshotButton.getBoundingClientRect();
  showContextMenu(r.left, r.bottom + 4, [
    { label: 'Download image', shortcut: SNAPSHOT_DOWNLOAD_KEYS, disabled: cc.barCount === 0, action: () => void downloadSnapshot() },
    { label: 'Copy image', shortcut: SNAPSHOT_COPY_KEYS, disabled: cc.barCount === 0, action: () => void copySnapshot() },
  ]);
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyS' || !modifierHeld(e)) return;
  if (e.altKey && !e.shiftKey) {
    e.preventDefault();
    void downloadSnapshot();
  } else if (e.shiftKey && !e.altKey) {
    e.preventDefault();
    void copySnapshot();
  }
});

// --- full screen and view shortcuts -------------------------------------------------------

/** Whether Esc has something to cancel before it may leave full screen. */
function escHasWork(): boolean {
  if (drawings.hasEscapable) return true;
  const open = document.querySelector(
    '.context-menu, dialog[open], #alertsPanel:not(.hidden), .symbol-list:not(.hidden), .palette:not(.hidden), .levels-menu:not(.hidden)',
  );
  if (open) return true;
  // A focused text box: Esc leaves the box first.
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    active.blur();
    return true;
  }
  return false;
}

const fullscreen = setupFullscreen($<HTMLButtonElement>('fullscreen'), escHasWork);

// Shift + letter toggles a view setting, like TradingView: Shift+F full screen, Shift+A auto-scale.
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (!e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.repeat) return;
  if (e.code === 'KeyF') {
    e.preventDefault();
    fullscreen.toggle();
  } else if (e.code === 'KeyA') {
    e.preventDefault();
    toggleAutoScale();
  }
});

// --- About dialog ------------------------------------------------------------------

const aboutDialog = $<HTMLDialogElement>('aboutDialog');
const settingsButton = $<HTMLButtonElement>('settings');
settingsButton.innerHTML = ICONS.settings;
settingsButton.addEventListener('click', () => settingsDialog.open());

// --- right panel: watchlist and drawings list ---------------------------------------

const watchlistButton = $<HTMLButtonElement>('watchlistToggle');
watchlistButton.innerHTML = ICONS.list;
const drawingsListButton = $<HTMLButtonElement>('drawingsToggle');
drawingsListButton.innerHTML = ICONS.layers;
const watchlist = createWatchlist({
  providerId: 'binance',
  current: () => ({ providerId: provider.id, symbol }),
  onSelect: (item) => selectSymbol(item.providerId, item.symbol),
});
const drawingsList = createDrawingsList({ drawings, formatPrice: (p) => cc.formatPrice(p), symbol: () => symbol });
createRightPanel(
  $('body'),
  [
    { id: 'watchlist', button: watchlistButton, ...watchlist },
    { id: 'drawings', button: drawingsListButton, ...drawingsList },
  ],
  () => requestAnimationFrame(syncControls),
);

const aboutButton = $<HTMLButtonElement>('about');
aboutButton.innerHTML = ICONS.info;
aboutButton.addEventListener('click', () => aboutDialog.showModal());
aboutDialog.addEventListener('click', (e) => {
  if (e.target === aboutDialog) aboutDialog.close(); // click on the backdrop
});

const shortcuts: [string, string][] = [
  ...TOOLS.filter((t) => t.key).map((t) => [`${ALT}${t.key!.replace('Key', '')}`, t.title] as [string, string]),
  ['Shift + click', 'Measure'],
  [`${ALT}A`, 'Alert at the cursor price'],
  [`Hold ${HOLD}`, 'Magnet while held (snap to open/high/low/close)'],
  ['Shift while drawing', 'Keep a line horizontal, vertical or at 45°'],
  [`${MOD}C / ${MOD}V / ${MOD}D`, 'Copy, paste, duplicate drawing'],
  ['Arrow keys', 'Move the selected drawing (Shift: faster)'],
  ['Right-click', 'Drawing and chart menu'],
  [SNAPSHOT_DOWNLOAD_KEYS, 'Download chart image'],
  [SNAPSHOT_COPY_KEYS, 'Copy chart image'],
  ['Esc', 'Cursor / cancel; in full screen, exits when there is nothing to cancel'],
  [FULLSCREEN_KEYS, 'Full screen'],
  [AUTO_SCALE_KEYS, 'Auto-fit the price scale on / off'],
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

installTooltips();

syncProviderUi();
syncTimeframeUi();
drawings.setTool('cursor');
if (provider.freeSymbolInput && symbol) void load();
else setStatus('Open a CSV file to start.');
