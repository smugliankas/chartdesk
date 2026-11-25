import type { SymbolInfo } from '../providers';

interface Options {
  /** Returns matches for the query, or null if the current provider has no search. */
  search: (query: string) => Promise<SymbolInfo[]> | null;
  /** Called with the chosen symbol (from the list, or typed and confirmed with Enter). */
  onPick: (symbol: string) => void;
}

/** Turns a text input into a symbol box with a searchable dropdown. */
export function attachSymbolSearch(input: HTMLInputElement, { search, onPick }: Options): void {
  const list = document.createElement('div');
  list.className = 'symbol-list hidden';
  input.insertAdjacentElement('afterend', list);

  let items: SymbolInfo[] = [];
  let active = -1;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    list.classList.add('hidden');
    active = -1;
  };

  const render = () => {
    list.replaceChildren(
      ...items.map((it, i) => {
        const row = document.createElement('div');
        row.className = 'symbol-item' + (i === active ? ' active' : '');
        const name = document.createElement('span');
        name.className = 'symbol-name';
        appendHighlighted(name, it.symbol, input.value.trim());
        if (it.name) {
          const plain = document.createElement('small');
          plain.textContent = it.name; // from the data source: text, never HTML
          name.append(plain);
        }
        row.append(name);
        if (it.detail) {
          const detail = document.createElement('span');
          detail.className = 'detail' + (it.detail.startsWith('-') ? ' down' : it.detail.startsWith('+') ? ' up' : '');
          detail.textContent = it.detail;
          row.append(detail);
        }
        // mousedown (not click) so the input keeps focus until we're done.
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(it.symbol);
        });
        return row;
      }),
    );
    list.classList.toggle('hidden', items.length === 0);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const showMessage = (text: string) => {
    const row = document.createElement('div');
    row.className = 'symbol-item muted';
    row.textContent = text;
    list.replaceChildren(row);
    list.classList.remove('hidden');
  };

  const update = () => {
    const pending = search(input.value);
    if (!pending) return close();
    const mine = ++seq;
    pending
      .then((res) => {
        if (mine !== seq || document.activeElement !== input) return;
        items = res;
        active = -1;
        if (res.length === 0) showMessage('No matches');
        else render();
      })
      .catch(() => {
        if (mine === seq && document.activeElement === input) showMessage('Could not load the symbol list');
      });
  };

  const pick = (symbol: string) => {
    input.value = symbol;
    close();
    input.blur();
    onPick(symbol);
  };

  input.addEventListener('focus', () => {
    input.select();
    update();
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 80);
  });
  input.addEventListener('blur', () => setTimeout(close, 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      active = e.key === 'ArrowDown' ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = active >= 0 ? items[active]?.symbol : input.value.trim().toUpperCase();
      if (chosen) pick(chosen);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
}

/** Appends `text`, with the first case-insensitive match of `query` wrapped in <mark>. */
function appendHighlighted(parent: HTMLElement, text: string, query: string): void {
  const i = query ? text.toUpperCase().indexOf(query.toUpperCase()) : -1;
  if (i < 0) {
    parent.textContent = text;
    return;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(i, i + query.length);
  parent.append(text.slice(0, i), mark, text.slice(i + query.length));
}
