/** A view that can be shown in the right panel (watchlist, drawings list…). */
export interface PanelView {
  id: string;
  /** Top bar button that opens this view (and closes the panel when it is already showing). */
  button: HTMLButtonElement;
  element: HTMLElement;
  /** Called when the view becomes visible / stops being visible. */
  show?: () => void;
  hide?: () => void;
}

interface Saved {
  open: boolean;
  view: string;
  width?: number;
}

const KEY = 'chartdesk:panel';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

function load(firstView: string): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      return { open: s.open ?? true, view: s.view ?? firstView, width: typeof s.width === 'number' ? s.width : undefined };
    }
    // Before the panel had several views, the watchlist kept these itself.
    const old = JSON.parse(localStorage.getItem('chartdesk:watchlist') ?? '{}') as { open?: boolean; width?: number };
    return { open: old.open ?? true, view: firstView, width: typeof old.width === 'number' ? old.width : undefined };
  } catch {
    return { open: true, view: firstView };
  }
}

/**
 * The panel on the right of the chart, like TradingView's: one view at a time, opened from
 * buttons in the top bar. Its left edge can be dragged to resize it (double-click resets).
 */
export function createRightPanel(host: HTMLElement, views: PanelView[], onToggle?: () => void): { show: (id: string) => void } {
  const state = load(views[0].id);
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const panel = document.createElement('aside');
  panel.id = 'rightPanel';
  const resizeEl = document.createElement('div');
  resizeEl.className = 'panel-resize';
  panel.append(resizeEl, ...views.map((v) => v.element));
  host.append(panel);

  const applyWidth = () => {
    panel.style.width = `${Math.round(state.width ?? DEFAULT_WIDTH)}px`;
  };

  let shown: PanelView | null = null;
  const apply = () => {
    const view = state.open ? (views.find((v) => v.id === state.view) ?? views[0]) : null;
    panel.classList.toggle('hidden', !view);
    for (const v of views) {
      v.element.classList.toggle('hidden', v !== view);
      v.button.classList.toggle('active', v === view);
    }
    if (shown !== view) {
      shown?.hide?.();
      shown = view;
      view?.show?.();
    }
    onToggle?.();
  };

  for (const v of views) {
    v.button.addEventListener('click', () => {
      if (state.open && state.view === v.id) state.open = false;
      else {
        state.open = true;
        state.view = v.id;
      }
      save();
      apply();
    });
  }

  // Drag the left edge to resize.
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

  applyWidth();
  apply();

  return {
    show: (id) => {
      state.open = true;
      state.view = id;
      save();
      apply();
    },
  };
}
