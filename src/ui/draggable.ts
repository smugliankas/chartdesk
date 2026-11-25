/** Six-dot grip, like TradingView's floating toolbars. */
const GRIP =
  '<svg viewBox="0 0 8 16" width="8" height="16" fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="6" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="6" cy="13" r="1.2"/></svg>';

interface Position {
  /** Left edge, as a fraction of the free horizontal room (0 = left, 1 = right). */
  x: number;
  /** Top edge, as a fraction of the free vertical room. */
  y: number;
}

/**
 * Lets a floating toolbar be moved by a grip on its left, like TradingView's. The place is
 * remembered (as a share of the room around it, so it stays sensible when the window is
 * resized). Double-click the grip to put it back where it started.
 */
export function makeDraggable(bar: HTMLElement, host: HTMLElement, storageKey: string): void {
  const grip = document.createElement('div');
  grip.className = 'drag-grip';
  grip.innerHTML = GRIP;
  grip.dataset.tip = 'Drag to move · double-click to put back';
  bar.prepend(grip);

  let pos: Position | null = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) pos = JSON.parse(raw) as Position;
  } catch {
    pos = null;
  }

  const room = () => ({
    w: Math.max(0, host.clientWidth - bar.offsetWidth),
    h: Math.max(0, host.clientHeight - bar.offsetHeight),
  });

  const apply = () => {
    if (!pos) {
      bar.classList.remove('moved');
      bar.style.left = bar.style.top = bar.style.bottom = '';
      return;
    }
    const r = room();
    bar.classList.add('moved');
    bar.style.left = `${Math.round(Math.min(1, Math.max(0, pos.x)) * r.w)}px`;
    bar.style.top = `${Math.round(Math.min(1, Math.max(0, pos.y)) * r.h)}px`;
    bar.style.bottom = 'auto';
  };

  const save = () => {
    try {
      if (pos) localStorage.setItem(storageKey, JSON.stringify(pos));
      else localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const hostRect = host.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const dx = e.clientX - barRect.left;
    const dy = e.clientY - barRect.top;
    bar.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const r = room();
      const left = Math.min(r.w, Math.max(0, ev.clientX - hostRect.left - dx));
      const top = Math.min(r.h, Math.max(0, ev.clientY - hostRect.top - dy));
      pos = { x: r.w ? left / r.w : 0, y: r.h ? top / r.h : 0 };
      apply();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      bar.classList.remove('dragging');
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('mousedown', (e) => e.preventDefault()); // no text selection
  grip.addEventListener('dblclick', () => {
    pos = null;
    apply();
    save();
  });

  // The bar's size changes with its contents (e.g. the style bar for different drawings),
  // and the room with the window: keep it inside.
  new ResizeObserver(() => apply()).observe(bar);
  new ResizeObserver(() => apply()).observe(host);
  apply();
}
