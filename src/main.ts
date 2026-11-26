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
import { chooseAndRestoreBackup, downloadBackup } from './backup';
import { openLinksInBrowser, saveFile } from './desktop';
import { contrastText, effectiveTextColor, loadAppearance, readable, saveAppearance, withAlpha, type Appearance } from './chart/appearance';
import { ChartController } from './chart/ChartController';
import { BarCountdown } from './chart/countdown';
import { DrawingManager } from './drawings/DrawingManager';
import { initDrawingStorage } from './drawings/storage';
import { formatCount } from './format';
import { Replay, REPLAY_STEP_KEYS } from './replay';
import type { Drawing, ToolId } from './drawings/model';
import { csv, getProvider, PROVIDERS, type DataProvider } from './providers';
import { TF_LABELS, TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from './types';
import { createAlertsPanel } from './ui/alertsPanel';
import { showContextMenu, type MenuEntry } from './ui/contextMenu';
import { createSettingsDialog } from './ui/settingsDialog';
import { createStyleBar } from './ui/styleBar';
import { attachSymbolSearch } from './ui/symbolSearch';
import { searchAll } from './providers/search';
import { canvasToBlob, copyImage, renderSnapshot, snapshotFileName } from './ui/snapshot';
import { createDrawingsList } from './ui/drawingsList';
import { makeDraggable } from './ui/draggable';
import { AUTO_SCALE_KEYS, FULLSCREEN_KEYS, setupFullscreen } from './ui/fullscreen';
import { createRightPanel } from './ui/rightPanel';
import { createWatchlist } from './ui/watchlist';
import { enhanceSelect } from './ui/selectMenu';
import { confirmDialog } from './ui/confirmDialog';
import { installTooltips } from './ui/tooltips';
import { ALT, HOLD, ICONS, MOD, TOOL_GROUPS, TOOLS, toolDef, toolTitle } from './ui/tools';

// --- elements ----------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSelect = $<HTMLSelectElement>('provider');
const symbolInput = $<HTMLInputElement>('symbol');
const csvButton = $<HTMLLabelElement>('csvButton');
const accountButton = $<HTMLButtonElement>('accountButton');
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
let symbol = provider.freeSymbolInput ? (settings.symbols[provider.id] ?? provider.defaultSymbol ?? '') : '';
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
  // No countdown in a replay: the bar on screen is not the live one.
  countdown.setTimeframe(cc.appearance.countdown && !replay.active ? liveTimeframe : null);
}

// --- bar replay ----------------------------------------------------------------------

const replay = new Replay({
  cc,
  wrap: chartWrap,
  timeframe: () => timeframe,
  onChange: syncReplay,
  onExit: () => void load(),
});

const replayButton = $<HTMLButtonElement>('replay');
replayButton.innerHTML = ICONS.replay;
replayButton.title = 'Bar replay: pick a bar, then play the chart forward from there';
replayButton.addEventListener('click', () => {
  if (replay.isSelecting) replay.cancelSelecting();
  else replay.startSelecting();
});

function syncReplay(): void {
  replayButton.classList.toggle('active', replay.active || replay.isSelecting);
  syncCountdown();
  if (!crosshairActive) showLegend(cc.lastCandle);
  if (replay.active) showReadyStatus();
  syncControls();
}

// Shift + → shows the next bar (when no drawing is selected; then the arrows move the drawing).
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (!replay.active || drawings.selectedIds.length || !e.shiftKey || e.key !== 'ArrowRight' || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  replay.pause();
  replay.step();
});
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
  document.body.style.setProperty('--chart-bg', a.background);
  document.body.style.setProperty('--crosshair', withAlpha(contrastText(a.background), 0.3));
  volumeButton.classList.toggle('active', a.showVolume);
  drawings.redraw();
  syncCountdown();
}

const settingsDialog = createSettingsDialog(() => cc.appearance, applyAppearance, {
  onExport: async () => {
    const s = await downloadBackup();
    if (!s) return; // "Save as" cancelled
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    setStatus(`Backup saved: ${n(s.drawings, 'drawing')} on ${n(s.drawingSymbols.length, 'symbol')}, ${n(s.alerts, 'alert')}.`);
  },
  onImport: () => chooseAndRestoreBackup((message) => setStatus(message, true)),
});
applyAppearance(loadAppearance());

// --- top bar ---------------------------------------------------------------------

for (const p of PROVIDERS) {
  // "Bybit TradFi (forex, gold, stocks)": the part in brackets goes on the menu's second line.
  const [, main, detail] = /^(.*?)(?:\s*\((.*)\))?$/.exec(p.name)!;
  const option = new Option(main, p.id);
  if (detail) option.dataset.detail = detail;
  if (p.description) option.title = p.description;
  providerSelect.append(option);
}
enhanceSelect(providerSelect);

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
  symbol = provider.freeSymbolInput ? (settings.symbols[provider.id] ?? provider.defaultSymbol ?? '') : '';
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

// The symbol box searches every source; picking a result from another source switches to it.
attachSymbolSearch(symbolInput, {
  search: (q, partial) => (provider.searchSymbols ? searchAll(q, provider.id, partial) : null),
  onPick: (s, item) => selectSymbol(item?.providerId ?? provider.id, s.toUpperCase()),
});
// Leaving the box without picking puts the chart's symbol back.
symbolInput.addEventListener('blur', () => setTimeout(() => (symbolInput.value = symbol), 0));

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
  providerSelect.title = provider.description ?? 'Data source';
  syncAccountUi();
}

// --- sources that need signing in (cTrader) -------------------------------------------

/** Name of the current source without the part in brackets: "cTrader". */
const sourceName = () => provider.name.replace(/\s*\(.*\)$/, '');

function syncAccountUi(): void {
  const account = provider.account;
  accountButton.classList.toggle('hidden', !account);
  if (!account) return;
  const connected = account.isConnected();
  accountButton.textContent = connected ? (account.label() ?? sourceName()) : `Connect ${sourceName()}`;
  accountButton.classList.toggle('account-chip', connected);
  accountButton.classList.toggle('account-connect', !connected);
  accountButton.dataset.tip = connected
    ? `Signed in to ${sourceName()}. Click to disconnect.`
    : `Sign in with your ${sourceName()} ID in your browser`;
  accountButton.removeAttribute('title');
}

async function connectAccount(): Promise<void> {
  const account = provider.account;
  if (!account) return;
  accountButton.disabled = true;
  setStatus(`Sign in to ${sourceName()} in your browser, then come back here…`);
  try {
    await account.connect();
    syncAccountUi();
    setStatus(`Connected: ${account.label() ?? sourceName()}`);
    void load();
  } catch (err) {
    setStatus(errorMessage(err), true);
  } finally {
    accountButton.disabled = false;
  }
}

accountButton.addEventListener('click', () => {
  const account = provider.account;
  if (!account) return;
  if (!account.isConnected()) return void connectAccount();
  void confirmDialog({
    title: `Disconnect ${account.label() ?? sourceName()}?`,
    message: `ChartDesk will forget this sign-in. Your drawings stay; connect again any time to see these charts.`,
    confirmLabel: 'Disconnect',
  }).then((ok) => {
    if (ok) account.disconnect();
  });
});

for (const p of PROVIDERS) {
  p.account?.onChange(() => {
    if (p !== provider) return;
    syncAccountUi();
    if (!p.account!.isConnected()) void load(); // shows the "connect" message
  });
}

function syncTimeframeUi(): void {
  for (const [tf, b] of tfButtons) b.classList.toggle('active', tf === timeframe);
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function showReadyStatus(): void {
  if (replay.active) {
    // The date is on the replay bar; the status line only says that this is a replay.
    setStatus(`${symbol} · ${TF_LABELS[timeframe]} · Replay${replay.atEnd ? ' · end of the data' : ''}`);
    return;
  }
  setStatus(`${symbol} · ${TF_LABELS[timeframe]} · ${formatCount(cc.barCount)} bars`);
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
/** Asks in the app's own dialog, then removes every drawing on this symbol (undo brings them back). */
async function confirmClearAll(): Promise<void> {
  const n = drawings.drawings.length;
  if (n === 0) return;
  const ok = await confirmDialog({
    title: `Remove all drawings on ${symbol}?`,
    message: `${n} drawing${n === 1 ? '' : 's'} will be removed from this symbol on every timeframe. Undo (${MOD}Z) brings them back.`,
    confirmLabel: 'Remove all',
    danger: true,
  });
  if (ok) drawings.clearAll();
}

const magnetButton = sidebarButton(ICONS.magnet, `Magnet: drawings snap to open/high/low/close (hold ${HOLD})`, () => {
  drawings.setMagnet(!drawings.magnetOn);
  settings.magnet = drawings.magnetOn;
  saveSettings();
});
const hideButton = sidebarButton(ICONS.eye, 'Hide all drawings', () => drawings.setHidden(!drawings.hidden));
const deleteButton = sidebarButton(ICONS.trash, 'Delete selected drawing (Del)', () => drawings.deleteSelected());
const clearButton = sidebarButton(ICONS.trashAll, 'Remove all drawings on this symbol', () => void confirmClearAll());
clearButton.classList.add('danger');

// --- alerts -------------------------------------------------------------------------

const alerts = new AlertManager();
const alertsPrimitive = new AlertsPrimitive(cc, () => alerts.forSymbol(provider.id, symbol));
cc.candles.attachPrimitive(alertsPrimitive);
unlockAudioOnFirstInteraction();

/** Price under the mouse on the chart, for ⌥A, and its height on the chart. */
let crosshairPrice: number | null = null;
let crosshairY: number | null = null;

function canAlert(): boolean {
  if (provider.subscribe) return true;
  setStatus('Alerts need live data, e.g. Binance.', true);
  return false;
}

// "Alert set: …" in the status line is a short confirmation: it goes back to the usual line
// after a few seconds, or right away when that alert is deleted or moved.
let alertNote: { id: string; priceText: string; text: string } | null = null;
let alertNoteTimer: ReturnType<typeof setTimeout> | undefined;

function noteAlertSet(a: PriceAlert, text: string): void {
  setStatus(text);
  alertNote = { id: a.id, priceText: a.priceText, text };
  clearTimeout(alertNoteTimer);
  alertNoteTimer = setTimeout(endAlertNote, 4000);
}

function endAlertNote(): void {
  clearTimeout(alertNoteTimer);
  // Only if the line still shows the note (not an error or another message since).
  if (alertNote && statusEl.textContent === alertNote.text) showReadyStatus();
  alertNote = null;
}

/** Alert at a fixed price. */
function addAlertAt(price: number, drawingId?: string): void {
  if (!canAlert()) return;
  const a = alerts.add({ providerId: provider.id, symbol, price, priceText: cc.formatPrice(price), currentPrice: cc.lastCandle?.close, drawingId });
  void requestNotificationPermission();
  noteAlertSet(a, `Alert set: ${symbol} crossing ${a.priceText}`);
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
  noteAlertSet(a, `Alert set: ${symbol} crossing the ${alertTarget(a)}`);
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
makeDraggable($('styleBar'), chartWrap, 'chartdesk:styleBarPos');

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

/** Gone at once, like TradingView's: the moment the mouse reaches the price scale. */
function hidePriceAlertButtonNow(): void {
  clearTimeout(priceAlertHideTimer);
  priceAlertButton.classList.add('hidden');
}

function placePriceAlertButton(y: number | null): void {
  const price = y === null ? null : cc.yToPrice(y);
  if (y === null || price === null || !provider.subscribe || drawings.currentTool !== 'cursor' || hoveringAlertLine) {
    hidePriceAlertButtonSoon();
    return;
  }
  clearTimeout(priceAlertHideTimer);
  priceAlertPrice = price;
  priceAlertButton.style.top = `${Math.round(y) - 13}px`;
  priceAlertButton.style.right = `${cc.priceScaleWidth() + 4}px`;
  priceAlertButton.setAttribute('aria-label', `Add alert at ${cc.formatPrice(price)}`);
  priceAlertButton.classList.remove('hidden');
}

// The mouse passes through the bell (pointer-events: none in CSS), so the chart keeps getting
// every move: the bell and the crosshair glide with the mouse instead of the bell sitting still
// under it and jumping once the mouse comes out. Hover and clicks are worked out here instead.
function overPriceAlertButton(e: MouseEvent): boolean {
  if (priceAlertButton.classList.contains('hidden')) return false;
  const r = priceAlertButton.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
}
function setPriceAlertHover(on: boolean): void {
  if (on === priceAlertHover) return;
  priceAlertHover = on;
  priceAlertButton.classList.toggle('hover', on);
  chartWrap.classList.toggle('over-alert-button', on);
  if (!on) hidePriceAlertButtonSoon();
}
let priceAlertPress = false;
chartWrap.addEventListener(
  'mousemove',
  (e) => {
    const x = e.clientX - chartEl.getBoundingClientRect().left;
    if (x > cc.paneSize().width) {
      setPriceAlertHover(false);
      hidePriceAlertButtonNow();
      return;
    }
    setPriceAlertHover(overPriceAlertButton(e));
  },
  true,
);
chartWrap.addEventListener('mouseleave', () => setPriceAlertHover(false));
chartWrap.addEventListener(
  'mousedown',
  (e) => {
    if (e.button !== 0 || !overPriceAlertButton(e)) return;
    // Ours: the chart must not start a pan, a selection or a drawing, and the new alert line
    // under the mouse must not start a drag (its handler sits on this same element).
    e.preventDefault();
    e.stopImmediatePropagation();
    priceAlertPress = true;
    if (priceAlertPrice !== null) addAlertAt(priceAlertPrice);
  },
  true,
);
chartWrap.addEventListener(
  'click',
  (e) => {
    if (!priceAlertPress) return;
    priceAlertPress = false;
    e.stopImmediatePropagation();
  },
  true,
);
// Keyboard: Tab to the bell and press Enter.
priceAlertButton.addEventListener('click', (e) => {
  if (e.detail === 0 && priceAlertPrice !== null) addAlertAt(priceAlertPrice);
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
    else placePriceAlertButton(crosshairY); // the crosshair may have moved before this ran
  },
});

alerts.onChange(() => {
  if (alertNote) {
    const a = alerts.all.find((x) => x.id === alertNote!.id);
    if (!a || a.priceText !== alertNote.priceText) endAlertNote();
  }
  alertsPrimitive.requestUpdate();
  alertsPanel.sync();
  syncStyleBar();
});

drawings.onToolChange((tool) => {
  // A tool picked by shortcut becomes its group's tool, like picking it from the menu.
  showInGroup(tool);
  for (const x of toolGroups) x.button.classList.toggle('active', x.current === tool);
});
// Several drawings selected (⌘/Ctrl): the status line says how many and what can be done.
let selectionNote: string | null = null;
function syncSelectionNote(): void {
  const n = drawings.selectedIds.length;
  if (n > 1) {
    selectionNote = `${n} drawings selected · drag one to move them all, ${IS_MAC ? 'Delete' : 'Del'} removes them`;
    setStatus(selectionNote);
  } else if (selectionNote) {
    if (statusEl.textContent === selectionNote) showReadyStatus();
    selectionNote = null;
  }
}

drawings.onChange(() => {
  syncLineAlerts();
  syncStyleBar();
  undoButton.disabled = !drawings.canUndo;
  redoButton.disabled = !drawings.canRedo;
  deleteButton.disabled = drawings.selectedIds.length === 0;
  syncSelectionNote();
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
      action: () => void confirmClearAll(),
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
  if (provider.account && !provider.account.isConnected()) {
    cc.setData([], TF_SECONDS[timeframe]);
    showLegend(undefined);
    setStatus(`Connect your ${sourceName()} account to see its charts: the button next to the symbol.`);
    return;
  }
  setStatus(`Loading ${symbol} ${TF_LABELS[timeframe]}…`);
  const done = startLoading();
  if (cc.barCount > 0) chartEl.classList.add('loading');

  try {
    let candles = await provider.getCandles(symbol, timeframe);
    if (seq !== loadSeq) return; // a newer request has started
    if (candles.length === 0) throw new Error(`No data for ${symbol}.`);

    if (replay.active) {
      // Keep the replay's date: fetch older bars until it is covered, then show up to it.
      for (let page = 0; page < 40 && !replay.covers(candles) && provider.getCandlesBefore; page++) {
        const older = await provider.getCandlesBefore(symbol, timeframe, candles[0].time);
        if (seq !== loadSeq) return;
        const add = older.filter((c) => c.time < candles[0].time);
        if (add.length === 0) break;
        candles = [...add, ...candles];
      }
      replay.resume(candles, TF_SECONDS[timeframe]);
    } else {
      cc.setData(candles, TF_SECONDS[timeframe]);
    }
    drawings.setStorageKey(`${provider.id}:${symbol}`);
    drawings.setTimeframe(timeframe);
    watchlist.sync();
    showLegend(cc.lastCandle);
    showReadyStatus();
    syncControls();

    if (provider.subscribe) {
      liveTimeframe = timeframe;
      syncCountdown();
      stopLive = provider.subscribe(symbol, timeframe, (c) => {
        if (seq !== loadSeq) return;
        if (replay.active) {
          // Alerts keep watching the live price; the chart stays in the past.
          alerts.observe(provider.id, symbol, c.close);
          return;
        }
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
    const added = cc.prependData(older);
    if (replay.active) replay.prepend(older);
    if (added === 0) historyDone = true;
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
  crosshairY = param.point ? param.point.y : null;
  crosshairPrice = crosshairY === null ? null : cc.yToPrice(crosshairY);
  placePriceAlertButton(crosshairY);
  showLegend(bar ? { time: bar.time as number, open: bar.open, high: bar.high, low: bar.low, close: bar.close } : cc.lastCandle);
});

// The crosshair and the cursor, drawn by us rather than by the chart library: the library moves
// its lines in its own drawing loop and snaps the vertical one to whole bars, which felt jumpy
// (worst when sweeping the mouse to a corner). Ours follow every mouse move as it happens, the
// vertical one included. The cross is the cursor (the system pointer is hidden over the chart)
// and always sits on the mouse; with the magnet on, the lines jump to the bar and its nearest
// open/high/low/close while the cross stays with the mouse. The chart still draws the price and
// time labels on the scales.
const crosshairV = $<HTMLDivElement>('crosshairV');
const crosshairH = $<HTMLDivElement>('crosshairH');
const crossCursor = $<HTMLDivElement>('crossCursor');
crossCursor.innerHTML =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M10 0v20M0 10h20" stroke="var(--cross-halo)" stroke-width="4"/>' +
  '<path d="M10 0v20M0 10h20" stroke="currentColor" stroke-width="2"/></svg>';

function hideCrosshair(): void {
  crosshairV.classList.add('hidden');
  crosshairH.classList.add('hidden');
  crossCursor.classList.add('hidden');
}

function placeCrosshair(e: PointerEvent): void {
  const r = chartEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const pane = cc.paneSize();
  if (x < 0 || y < 0 || x >= pane.width || y >= pane.height || cc.barCount === 0) return hideCrosshair();
  let lx = x;
  let ly = y;
  if (cc.magnetOn) {
    const logical = cc.xToLogical(x);
    const snapped = logical === null ? null : cc.crosshairCenter({ x, y }, Math.round(logical));
    if (snapped) ({ x: lx, y: ly } = snapped);
  }
  // The 1px lines are centered on the 2px cross; on a 1x screen half a pixel would blur them.
  const half = window.devicePixelRatio >= 2 ? 0.5 : 0;
  crosshairV.style.height = `${pane.height}px`;
  crosshairV.style.transform = `translateX(${Math.round(lx) - half}px)`;
  crosshairH.style.width = `${pane.width}px`;
  crosshairH.style.transform = `translateY(${Math.round(ly) - half}px)`;
  crosshairV.classList.remove('hidden');
  crosshairH.classList.remove('hidden');
  // Over a drawing or an alert line the mouse shows its own cursor (move, resize) instead.
  const overSomething = chartEl.style.cursor !== '' || priceAlertHover;
  crossCursor.classList.toggle('hidden', overSomething);
  crossCursor.style.transform = `translate(${Math.round(x) - 10}px, ${Math.round(y) - 10}px)`;
}

chartWrap.addEventListener('pointermove', placeCrosshair);
chartWrap.addEventListener('pointerleave', hideCrosshair);

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
    if (await saveFile(blob, snapshotFileName(symbol, TF_LABELS[timeframe]))) setStatus('Chart image saved.');
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
  if (drawings.hasEscapable || replay.isSelecting) return true;
  const open = document.querySelector(
    '.context-menu, dialog[open], #alertsPanel:not(.hidden), .symbol-list:not(.hidden), .select-menu:not(.hidden), .palette:not(.hidden), .levels-menu:not(.hidden)',
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
  addProvider: () => (provider.searchSymbols && provider.watchQuotes ? provider : getProvider('binance')),
  search: (q, partial) => searchAll(q, provider.id, partial),
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
  [`Hold ${HOLD}`, 'Magnet while drawing (snap to open/high/low/close)'],
  [`${HOLD} + click`, 'Add a drawing to the selection, or take it out'],
  [`${HOLD} + drag`, 'Select the drawings in an area'],
  [`${MOD}A`, 'Select all drawings'],
  ['Shift while drawing', 'Keep a line horizontal, vertical or at 45°'],
  [`${MOD}C / ${MOD}V / ${MOD}D`, 'Copy, paste, duplicate drawing'],
  ['Arrow keys', 'Move the selected drawings (Shift: faster)'],
  ['Right-click', 'Drawing and chart menu'],
  [REPLAY_STEP_KEYS, 'Replay: next bar'],
  ['Space', 'Replay: play / pause'],
  [SNAPSHOT_DOWNLOAD_KEYS, 'Download chart image'],
  [SNAPSHOT_COPY_KEYS, 'Copy chart image'],
  ['Esc', 'Cursor / cancel; in full screen, exits when there is nothing to cancel'],
  [FULLSCREEN_KEYS, 'Full screen'],
  [AUTO_SCALE_KEYS, 'Auto-fit the price scale on / off'],
  ['Del', 'Delete the selected drawings'],
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

openLinksInBrowser();
installTooltips();

syncProviderUi();
syncTimeframeUi();
drawings.setTool('cursor');
// Drawings are read from the browser's database first, then the chart loads.
void initDrawingStorage().then(() => {
  if (provider.freeSymbolInput && symbol) void load();
  else setStatus('Open a CSV file to start.');
});
