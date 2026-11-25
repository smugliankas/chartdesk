import type { ChartController } from '../chart/ChartController';
import { ICONS } from '../ui/tools';
import type { AlertManager, PriceAlert } from './AlertManager';
import type { AlertsPrimitive } from './AlertsPrimitive';

interface Options {
  /** Element that holds the chart and overlays (#chartWrap). */
  host: HTMLElement;
  /** The chart's own element (#chart). */
  chartEl: HTMLElement;
  cc: ChartController;
  manager: AlertManager;
  primitive: AlertsPrimitive;
  /** Whether the cursor tool is active (drawing tools take precedence). */
  isCursor: () => boolean;
  /** Called when the pointer starts or stops hovering an alert line. */
  onHoverChange?: (hovering: boolean) => void;
}

const TOLERANCE = 5;

/**
 * Makes the dashed alert lines interactive, like TradingView: hover one to see its
 * price with a × to delete it, and drag it up or down to move the alert.
 * Alerts on a drawing move with the drawing instead.
 */
export function attachAlertInteraction({ host, chartEl, cc, manager, primitive, isCursor, onHoverChange }: Options): void {
  const tag = document.createElement('div');
  tag.className = 'alert-tag hidden';
  tag.innerHTML = `<span class="alert-tag-icon">${ICONS.bell}</span><span class="alert-tag-price"></span>`;
  const priceEl = tag.querySelector<HTMLSpanElement>('.alert-tag-price')!;
  const remove = document.createElement('button');
  remove.className = 'alert-tag-remove';
  remove.title = 'Delete alert';
  remove.textContent = '×';
  tag.append(remove);
  host.append(tag);

  let hovered: PriceAlert | null = null;
  let dragging: { alert: PriceAlert; price: number } | null = null;

  const local = (e: MouseEvent) => {
    const r = chartEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** A standalone alert line near this y (alerts on drawings are left to the drawing). */
  const hitTest = (x: number, y: number): PriceAlert | null => {
    const pane = cc.paneSize();
    if (x < 0 || x > pane.width || y < 0 || y > pane.height) return null;
    for (const { alert, level } of primitive.active()) {
      if (alert.drawingId) continue;
      const ly = cc.priceToY(level);
      if (ly !== null && Math.abs(ly - y) <= TOLERANCE) return alert;
    }
    return null;
  };

  const showTag = (alert: PriceAlert, price: number) => {
    const y = cc.priceToY(price);
    if (y === null) return;
    const chartTop = chartEl.getBoundingClientRect().top - host.getBoundingClientRect().top;
    priceEl.textContent = cc.formatPrice(price);
    tag.style.top = `${chartTop + Math.round(y) - 12}px`;
    tag.style.right = `${cc.priceScaleWidth() + 26}px`;
    tag.classList.remove('hidden');
    if (hovered !== alert) {
      hovered = alert;
      onHoverChange?.(true);
    }
  };

  const hideTag = () => {
    tag.classList.add('hidden');
    if (hovered) {
      hovered = null;
      onHoverChange?.(false);
    }
  };

  remove.addEventListener('click', () => {
    if (hovered) manager.remove(hovered.id);
    hideTag();
  });

  host.addEventListener('mousemove', (e) => {
    if (dragging) return;
    if (tag.contains(e.target as Node)) return; // keep it while the pointer is on the tag
    if (!isCursor()) return hideTag();
    const { x, y } = local(e);
    const hit = hitTest(x, y);
    if (!hit) return hideTag();
    const level = primitive.active().find((a) => a.alert.id === hit.id)?.level ?? hit.price;
    showTag(hit, level);
    chartEl.style.cursor = 'ns-resize';
  });
  host.addEventListener('mouseleave', () => {
    if (!dragging) hideTag();
  });

  // Capture phase on the host: runs before the drawing tools and the chart's own panning.
  host.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0 || !isCursor() || !chartEl.contains(e.target as Node)) return;
      const { x, y } = local(e);
      const hit = hitTest(x, y);
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = { alert: hit, price: hit.price };
      chartEl.style.cursor = 'ns-resize';

      const onMove = (ev: MouseEvent) => {
        if (!dragging) return;
        const price = cc.yToPrice(local(ev).y);
        if (price === null) return;
        dragging.price = price;
        primitive.setPreview({ id: dragging.alert.id, price });
        showTag(dragging.alert, price);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const d = dragging;
        dragging = null;
        primitive.setPreview(null);
        if (d && d.price !== d.alert.price) manager.update(d.alert.id, { price: d.price, priceText: cc.formatPrice(d.price) });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    true,
  );
}
