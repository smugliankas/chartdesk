import { alertTarget, type AlertManager, type PriceAlert } from '../alerts/AlertManager';
import { notificationPermission, requestNotificationPermission } from '../alerts/notify';
import { ICONS } from './tools';

export interface AlertsPanelContext {
  /** Whether the current data source has live prices (alerts need them). */
  canAlert: boolean;
  /** Current price of the symbol on the chart, to prefill the price box. */
  price?: number;
  format: (price: number) => string;
}

interface Options {
  button: HTMLButtonElement;
  manager: AlertManager;
  context: () => AlertsPanelContext;
  /** Adds an alert for the symbol on the chart. */
  onAdd: (price: number) => void;
  /** Switches the chart to an alert's symbol. */
  onSelect: (alert: PriceAlert) => void;
}

/** The bell button's dropdown: add an alert, see all alerts, re-arm or delete them. */
export function createAlertsPanel({ button, manager, context, onAdd, onSelect }: Options): { sync: () => void } {
  button.innerHTML = `${ICONS.bell}<span class="badge hidden"></span>`;
  button.title = 'Alerts';
  const badge = button.querySelector<HTMLSpanElement>('.badge')!;

  const panel = document.createElement('div');
  panel.id = 'alertsPanel';
  panel.className = 'hidden';
  button.insertAdjacentElement('afterend', panel);

  const toggle = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) render(true);
  };
  button.addEventListener('click', toggle);
  document.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target as Node) && !button.contains(e.target as Node)) panel.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panel.classList.add('hidden');
  });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let priceInput: HTMLInputElement | null = null;

  const render = (prefill = false) => {
    const ctx = context();
    const keep = priceInput?.value;
    panel.replaceChildren();
    panel.append(el('h3', undefined, 'Alerts'));

    // Add row
    if (ctx.canAlert) {
      const row = el('form', 'alert-add');
      priceInput = el('input');
      priceInput.type = 'number';
      priceInput.step = 'any';
      priceInput.placeholder = 'Price';
      priceInput.value = prefill && ctx.price !== undefined ? ctx.format(ctx.price) : (keep ?? '');
      const add = el('button', undefined, 'Add alert');
      add.type = 'submit';
      row.append(priceInput, add);
      row.addEventListener('submit', (e) => {
        e.preventDefault();
        const price = Number(priceInput!.value);
        if (!priceInput!.value || !Number.isFinite(price) || price <= 0) return;
        void requestNotificationPermission().then(() => render());
        onAdd(price);
      });
      panel.append(row);
    } else {
      priceInput = null;
      panel.append(el('p', 'muted', 'Alerts need live data, e.g. Binance.'));
    }

    // Notification permission
    const perm = notificationPermission();
    if (perm === 'default') {
      const b = el('button', 'link', 'Turn on desktop notifications');
      b.type = 'button';
      b.addEventListener('click', () => void requestNotificationPermission().then(() => render()));
      panel.append(b);
    } else if (perm === 'denied') {
      panel.append(el('p', 'muted small', 'Desktop notifications are blocked in this browser. You will still get a sound and an on-screen alert.'));
    }

    // List
    const list = el('div', 'alert-list');
    const sorted = [...manager.all].sort((a, b) => Number(!!a.triggeredAt) - Number(!!b.triggeredAt) || b.createdAt - a.createdAt);
    if (sorted.length === 0) list.append(el('p', 'muted', 'No alerts yet.'));
    for (const a of sorted) {
      const row = el('div', 'alert-row' + (a.triggeredAt ? ' triggered' : ''));
      const info = el('button', 'alert-info');
      info.type = 'button';
      info.title = `Show ${a.symbol}`;
      info.append(el('strong', undefined, a.symbol), el('span', undefined, `Crossing ${a.line ? 'the ' : ''}${alertTarget(a)}`));
      info.addEventListener('click', () => {
        panel.classList.add('hidden');
        onSelect(a);
      });
      const status = el(
        'span',
        'alert-status',
        a.triggeredAt ? `Fired ${new Date(a.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Active',
      );
      const actions = el('span', 'alert-actions');
      if (a.triggeredAt) {
        const rearm = el('button', 'icon', '↻');
        rearm.type = 'button';
        rearm.title = 'Turn on again';
        rearm.addEventListener('click', () => manager.rearm(a.id));
        actions.append(rearm);
      }
      const del = el('button', 'icon', '×');
      del.type = 'button';
      del.title = 'Delete';
      del.addEventListener('click', () => manager.remove(a.id));
      actions.append(del);
      row.append(info, status, actions);
      list.append(row);
    }
    panel.append(list);

    if (manager.all.some((a) => a.triggeredAt)) {
      const clear = el('button', 'link', 'Clear fired alerts');
      clear.type = 'button';
      clear.addEventListener('click', () => manager.clearTriggered());
      panel.append(clear);
    }
  };

  const sync = () => {
    const n = manager.activeCount;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    if (!panel.classList.contains('hidden')) render();
  };
  sync();
  return { sync };
}
