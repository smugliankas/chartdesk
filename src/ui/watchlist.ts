import { getProvider, type DataProvider, type Quote } from '../providers';
import { attachSymbolSearch } from './symbolSearch';

export interface WatchItem {
  providerId: string;
  symbol: string;
}

interface Saved {
  items: WatchItem[];
}

interface Options {
  /** Data source of the default list (for a first visit). */
  providerId: string;
  /** Data source new entries come from: the chart's, when it can list prices. */
  addProvider: () => DataProvider;
  /** The symbol on the chart, to highlight its row. */
  current: () => WatchItem;
  /** Switches the chart to a symbol. */
  onSelect: (item: WatchItem) => void;
}

const KEY = 'chartdesk:watchlist';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

function load(providerId: string): Saved {
  const fallback: Saved = { items: DEFAULT_SYMBOLS.map((symbol) => ({ providerId, symbol })) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Saved>;
    return { items: Array.isArray(saved.items) ? saved.items : fallback.items };
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

/** Watchlist view for the right panel: live prices of a list of symbols. Click a row to open it on the chart. */
export function createWatchlist({ providerId, addProvider, current, onSelect }: Options): {
  element: HTMLElement;
  show: () => void;
  hide: () => void;
  sync: () => void;
} {
  const state = load(providerId);
  /** Quotes and rows by "provider:symbol": the same symbol can come from two sources. */
  const quotes = new Map<string, Quote>();
  const keyOf = (providerId: string, symbol: string) => `${providerId}:${symbol}`;
  let stopQuotes: (() => void)[] = [];
  let visible = false;

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const panel = document.createElement('section');
  panel.className = 'panel-view';
  panel.id = 'watchlist';
  panel.innerHTML = `
    <div class="wl-header">
      <h3>Watchlist</h3>
      <div class="symbol-box wl-add"><input type="text" spellcheck="false" autocomplete="off" placeholder="Add symbol…" /></div>
    </div>
    <div class="wl-columns"><span>Symbol</span><span>Last</span><span>24h</span></div>
    <div class="wl-rows"></div>`;

  const rowsEl = panel.querySelector<HTMLDivElement>('.wl-rows')!;
  const addInput = panel.querySelector<HTMLInputElement>('.wl-add input')!;

  // New symbols come from the chart's data source (so a Bybit chart adds Bybit symbols).
  const syncPlaceholder = () => {
    addInput.placeholder = `Add symbol (${addProvider().name.replace(/\s*\(.*\)$/, '')})…`;
  };
  addInput.addEventListener('focus', syncPlaceholder);
  attachSymbolSearch(addInput, {
    search: (q) => addProvider().searchSymbols?.(q) ?? null,
    onPick: (symbol) => {
      addInput.value = '';
      const s = symbol.toUpperCase();
      const pid = addProvider().id;
      if (!state.items.some((i) => i.providerId === pid && i.symbol === s)) {
        state.items.push({ providerId: pid, symbol: s });
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
      const code = document.createElement('span');
      code.textContent = item.symbol;
      name.append(code);
      const source = getProvider(item.providerId);
      if (item.providerId !== providerId) {
        // Symbols from another source carry a small line with its name.
        const tag = document.createElement('small');
        tag.className = 'wl-source';
        tag.textContent = source.name.replace(/\s*\(.*\)$/, '');
        name.append(tag);
      }
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
      const key = keyOf(item.providerId, item.symbol);
      rowEls.set(key, { row, price, change });
      const q = quotes.get(key);
      if (q) showQuote(key, q, false);
    }
    if (state.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted wl-empty';
      empty.textContent = 'Add symbols with the box above.';
      rowsEl.append(empty);
    }
  }

  function showQuote(key: string, q: Quote, animate = true): void {
    const el = rowEls.get(key);
    if (!el) return;
    const prev = quotes.get(key);
    quotes.set(key, q);
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

  /** Prices stream only while the watchlist is on screen. */
  function restartQuotes(): void {
    stopQuotes.forEach((stop) => stop());
    stopQuotes = [];
    if (!visible) return;
    // One stream per data source.
    const bySource = new Map<string, string[]>();
    for (const i of state.items) bySource.set(i.providerId, [...(bySource.get(i.providerId) ?? []), i.symbol]);
    for (const [pid, symbols] of bySource) {
      const p = getProvider(pid);
      if (p.id !== pid || !p.watchQuotes) continue;
      stopQuotes.push(p.watchQuotes(symbols, (q) => showQuote(keyOf(pid, q.symbol), q)));
    }
  }

  render();

  return {
    element: panel,
    show: () => {
      visible = true;
      restartQuotes();
    },
    hide: () => {
      visible = false;
      restartQuotes();
    },
    /** Re-highlights the current symbol and names the source new symbols come from. */
    sync: () => {
      syncPlaceholder();
      const cur = current();
      for (const item of state.items) {
        rowEls.get(keyOf(item.providerId, item.symbol))?.row.classList.toggle('current', item.providerId === cur.providerId && item.symbol === cur.symbol);
      }
    },
  };
}
