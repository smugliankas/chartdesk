import type { DrawingManager } from '../drawings/DrawingManager';
import { shownOn, type Drawing } from '../drawings/model';
import { TF_LABELS } from '../types';
import { ICONS, toolDef } from './tools';

interface Options {
  drawings: DrawingManager;
  formatPrice: (p: number) => string;
  /** "BTCUSDT", shown in the header. */
  symbol: () => string;
}

/** A short detail for a drawing's row: its price, its text, its levels… */
function detailOf(d: Drawing, formatPrice: (p: number) => string): string {
  switch (d.type) {
    case 'hline':
      return formatPrice(d.price);
    case 'hray':
    case 'cross':
      return formatPrice(d.p.price);
    case 'text':
      return d.text.split('\n')[0];
    case 'long':
    case 'short':
      return `Entry ${formatPrice(d.entry.price)}`;
    case 'pricerange': {
      const diff = d.p2.price - d.p1.price;
      return `${diff >= 0 ? '+' : '−'}${formatPrice(Math.abs(diff))}`;
    }
    default:
      return '';
  }
}

/**
 * The drawings on the current symbol, front first, like TradingView's object tree.
 * Click a row to select the drawing; hover for hide, lock and delete.
 */
export function createDrawingsList({ drawings, formatPrice, symbol }: Options): {
  element: HTMLElement;
  show: () => void;
  hide: () => void;
} {
  const view = document.createElement('section');
  view.className = 'panel-view';
  view.id = 'drawingsList';
  view.innerHTML = `
    <div class="wl-header dl-header">
      <h3>Drawings</h3>
      <span class="muted dl-count"></span>
    </div>
    <div class="dl-rows"></div>`;
  const countEl = view.querySelector<HTMLElement>('.dl-count')!;
  const rowsEl = view.querySelector<HTMLElement>('.dl-rows')!;
  let visible = false;

  const iconButton = (icon: string, tip: string, onClick: () => void, extra = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = `dl-action ${extra}`;
    b.innerHTML = icon;
    b.dataset.tip = tip;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  function render(): void {
    if (!visible) return;
    const list = [...drawings.drawings].reverse(); // front first
    countEl.textContent = list.length ? `${symbol()} · ${list.length}` : symbol();
    rowsEl.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted wl-empty';
      empty.textContent = 'No drawings on this symbol yet.';
      rowsEl.append(empty);
      return;
    }
    for (const d of list) {
      const offTimeframe = !shownOn(d, drawings.timeframe);
      const row = document.createElement('div');
      row.className =
        'dl-row' +
        (drawings.isSelected(d.id) ? ' current' : '') +
        (d.hidden || offTimeframe ? ' is-hidden' : '') +
        (d.locked ? ' is-locked' : '');
      if (offTimeframe && drawings.timeframe) {
        row.dataset.tip = `Not shown on ${TF_LABELS[drawings.timeframe]}. It shows on ${d.timeframes!.map((t) => TF_LABELS[t]).join(', ')}.`;
      }
      row.addEventListener('click', () => drawings.select(d.id === drawings.selectedId ? null : d.id));

      const icon = document.createElement('span');
      icon.className = 'dl-icon';
      icon.innerHTML = ICONS[d.type];
      icon.style.color = d.type === 'long' || d.type === 'short' ? '' : d.color;

      const name = document.createElement('span');
      name.className = 'dl-name';
      name.textContent = toolDef(d.type).title;
      const detail = detailOf(d, formatPrice);
      if (detail) {
        const small = document.createElement('span');
        small.className = 'dl-detail';
        small.textContent = detail; // text notes are user input: set as text, never HTML
        name.append(small);
      }

      const actions = document.createElement('span');
      actions.className = 'dl-actions';
      actions.append(
        iconButton(d.hidden ? ICONS.eyeOff : ICONS.eye, d.hidden ? 'Show' : 'Hide', () => drawings.toggleVisibility(d.id), d.hidden ? 'on' : ''),
        iconButton(d.locked ? ICONS.lock : ICONS.unlock, d.locked ? 'Unlock' : 'Lock', () => drawings.toggleLock(d.id), d.locked ? 'on' : ''),
        iconButton(ICONS.trash, 'Delete', () => drawings.remove(d.id), 'danger'),
      );

      row.append(icon, name, actions);
      rowsEl.append(row);
    }
  }

  drawings.onChange(render);

  return {
    element: view,
    show: () => {
      visible = true;
      render();
    },
    hide: () => {
      visible = false;
    },
  };
}
