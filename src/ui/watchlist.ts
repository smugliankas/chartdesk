import { getProvider, type Quote } from '../providers';
import { attachSymbolSearch } from './symbolSearch';

export interface WatchItem {
  providerId: string;
  symbol: string;
}

interface Saved {
  open: boolean;
  items: WatchItem[];
  /** Panel width in pixels. */
  width?: number;
}

interface Options {
  /** Element the panel is added to (#body). */
  host: HTMLElement;
  /** Top bar button that shows and hides the panel. */
  toggleButton: HTMLButtonElement;
  /** Data source used for new entries and quotes. */
  providerId: string;
  /** The symbol on the chart, to highlight its row. */
  current: () => WatchItem;
  /** Switches the chart to a symbol. */
  onSelect: (item: WatchItem) => void;
  /** Called after the panel opens or closes (the chart resizes). */
  onToggle?: () => void;
}

const KEY = 'chartdesk:watchlist';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

function load(providerId: string): Saved {
  const fallback: Saved = { open: true, items: DEFAULT_SYMBOLS.map((symbol) => ({ providerId, symbol })) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Saved>;
    return {
      open: saved.open ?? true,
      items: Array.isArray(saved.items) ? saved.items : fallback.items,
      width: typeof saved.width === 'number' ? saved.width : undefined,
    };
  } catch {
    return fallback;
  }
}

/**
 * The market's own decimals when known (from the tick size), otherwise fixed decimals by
 * size, so prices don't jump around as trailing zeros come and go.
 */
function formatQuotePrice(p: number, decimals?: number): string {
  if (decimals !== undefined) return p.toFixed(decimals);
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  return p.toFixed(8);
}

/** Right-hand panel with live prices of a list of symbols. Click a row to open it on the chart. */
export function createWatchlist({ host, toggleButton, providerId, current, onSelect, onToggle }: Options): { sync: () => void } {
  const state = load(providerId);
  const quotes = new Map<string, Quote>();
  let stopQuotes: (() => void) | null = null;

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const panel = document.createElement('aside');
  panel.id = 'watchlist';
  panel.innerHTML = `
    <div class="wl-resize"></div>
    <div class="wl-header">
      <h3>Watchlist</h3>
      <div class="symbol-box wl-add"><input type="text" spellcheck="false" autocomplete="off" placeholder="Add symbol…" /></div>
    </div>
    <div class="wl-columns"><span>Symbol</span><span>Last</span><span>24h</span></div>
    <div class="wl-rows"></div>`;
  host.append(panel);
  const resizeEl = panel.querySelector<HTMLDivElement>('.wl-resize')!;
  const applyWidth = () => {
    panel.style.width = `${Math.round(state.width ?? DEFAULT_WIDTH)}px`;
  };
  applyWidth();

  // Drag the left edge to resize, like TradingView's right panel. Double-click resets it.
  resizeEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    panel.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const maxWidth = Math.min(MAX_WIDTH, window.innerWidth * 0.6);
      state.width = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + (startX - ev.clientX)));
      applyWidth();
    };
    const up = () => {
      resizeEl.removeEventListener('pointermove', move);
      resizeEl.removeEventListener('pointerup', up);
      resizeEl.removeEventListener('pointercancel', up);
      panel.classList.remove('resizing');
      save();
    };
    resizeEl.addEventListener('pointermove', move);
    resizeEl.addEventListener('pointerup', up);
    resizeEl.addEventListener('pointercancel', up);
  });
  // No text selection from (double-)clicking the edge.
  resizeEl.addEventListener('mousedown', (e) => e.preventDefault());
  resizeEl.addEventListener('dblclick', () => {
    window.getSelection()?.removeAllRanges();
    state.width = undefined;
    applyWidth();
    save();
  });

  const rowsEl = panel.querySelector<HTMLDivElement>('.wl-rows')!;
  const addInput = panel.querySelector<HTMLInputElement>('.wl-add input')!;

  const provider = getProvider(providerId);
  attachSymbolSearch(addInput, {
    search: (q) => provider.searchSymbols?.(q) ?? null,
    onPick: (symbol) => {
      addInput.value = '';
      const s = symbol.toUpperCase();
      if (!state.items.some((i) => i.providerId === providerId && i.symbol === s)) {
        state.items.push({ providerId, symbol: s });
        save();
        restartQuotes();
        render();
      }
    },
  });

  const rowEls = new Map<string, { row: HTMLElement; price: HTMLElement; change: HTMLElement }>();

  function render(): void {
    rowsEl.replaceChildren();
    rowEls.clear();
    const cur = current();
    for (const item of state.items) {
      const row = document.createElement('div');
      row.className = 'wl-row' + (item.providerId === cur.providerId && item.symbol === cur.symbol ? ' current' : '');
      row.addEventListener('click', () => onSelect(item));

      const name = document.createElement('span');
      name.className = 'wl-symbol';
      name.textContent = item.symbol;
      const price = document.createElement('span');
      price.className = 'wl-price';
      const change = document.createElement('span');
      change.className = 'wl-change';
      const remove = document.createElement('button');
      remove.className = 'wl-remove';
      remove.title = 'Remove from watchlist';
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        state.items = state.items.filter((i) => i !== item);
        save();
        restartQuotes();
        render();
      });

      row.append(name, price, change, remove);
      rowsEl.append(row);
      rowEls.set(item.symbol, { row, price, change });
      const q = quotes.get(item.symbol);
      if (q) showQuote(q, false);
    }
    if (state.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted wl-empty';
      empty.textContent = 'Add symbols with the box above.';
      rowsEl.append(empty);
    }
  }

  function showQuote(q: Quote, animate = true): void {
    const el = rowEls.get(q.symbol);
    if (!el) return;
    const prev = quotes.get(q.symbol);
    quotes.set(q.symbol, q);
    el.price.textContent = formatQuotePrice(q.price, q.decimals);
    el.change.textContent = `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`;
    el.change.classList.toggle('up', q.changePct >= 0);
    el.change.classList.toggle('down', q.changePct < 0);
    // A short flash in the direction of the move.
    if (animate && prev && prev.price !== q.price) {
      el.price.classList.remove('flash-up', 'flash-down');
      void el.price.offsetWidth; // restart the animation
      el.price.classList.add(q.price > prev.price ? 'flash-up' : 'flash-down');
    }
  }

  function restartQuotes(): void {
    stopQuotes?.();
    stopQuotes = null;
    if (!state.open || !provider.watchQuotes) return;
    const symbols = state.items.filter((i) => i.providerId === providerId).map((i) => i.symbol);
    stopQuotes = provider.watchQuotes(symbols, (q) => showQuote(q));
  }

  function applyOpen(): void {
    panel.classList.toggle('hidden', !state.open);
    toggleButton.classList.toggle('active', state.open);
    restartQuotes();
    onToggle?.();
  }

  toggleButton.addEventListener('click', () => {
    state.open = !state.open;
    save();
    applyOpen();
  });

  render();
  applyOpen();

  return {
    /** Re-highlights the current symbol. */
    sync: () => {
      const cur = current();
      for (const item of state.items) {
        rowEls.get(item.symbol)?.row.classList.toggle('current', item.providerId === cur.providerId && item.symbol === cur.symbol);
      }
    },
  };
}
