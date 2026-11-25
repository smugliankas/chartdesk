/**
 * Fast, styled tooltips for every element with a `title`.
 *
 * The native title tooltip is slow and plain, so on hover the title is moved into
 * `data-tip` (which also stops the native one) and shown in our own bubble.
 * A title like "Trend line (⌥T)" shows the part in parentheses as key caps.
 * Titles set later from code keep working: the newest `title` always wins.
 */
export function installTooltips(): void {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);

  let current: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = 0;

  const textOf = (el: HTMLElement): string | null => {
    const title = el.getAttribute('title');
    if (title) {
      el.dataset.tip = title;
      el.removeAttribute('title');
    }
    return el.dataset.tip ?? null;
  };

  const render = (text: string) => {
    tip.replaceChildren();
    const m = /^(.*?)\s*\(([^()]+)\)$/.exec(text);
    const label = document.createElement('span');
    label.textContent = m ? m[1] : text;
    tip.append(label);
    if (m) {
      for (const key of m[2].split(/,\s*/)) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        tip.append(kbd);
      }
    }
  };

  const place = (el: HTMLElement) => {
    // In the left toolbar, a tool group (button + strip) is one box: place beside the whole box.
    const r = (el.closest('#sidebar') && el.closest('.tool-group')) ? el.closest('.tool-group')!.getBoundingClientRect() : el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    let x: number;
    let y: number;
    if (el.closest('#sidebar')) {
      // Left toolbar: to the right of the button.
      x = r.right + gap;
      y = r.top + r.height / 2 - t.height / 2;
    } else {
      x = r.left + r.width / 2 - t.width / 2;
      y = r.bottom + gap;
      if (y + t.height > window.innerHeight - 4) y = r.top - gap - t.height;
    }
    x = Math.max(4, Math.min(x, window.innerWidth - t.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - t.height - 4));
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  };

  const hide = () => {
    clearTimeout(showTimer);
    if (current) lastHidden = Date.now();
    current = null;
    tip.classList.remove('visible');
  };

  document.addEventListener('mouseover', (e) => {
    if (e.buttons !== 0) return; // no tooltips while dragging
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title], [data-tip]');
    if (!el || el === current) return;
    const text = textOf(el);
    if (!text) return;
    hide();
    current = el;
    // Show at once when moving between buttons; otherwise wait a moment.
    const delay = Date.now() - lastHidden < 400 ? 0 : 450;
    showTimer = setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      render(el.dataset.tip ?? text);
      place(el);
      tip.classList.add('visible');
    }, delay);
  });

  document.addEventListener('mouseout', (e) => {
    if (!current) return;
    const to = e.relatedTarget as Node | null;
    if (to && current.contains(to)) return;
    if ((e.target as Node) === current || current.contains(e.target as Node)) hide();
  });
  // pointerdown too: a drag that cancels the mouse events (the grips on the floating bars)
  // would otherwise leave the tooltip on screen.
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('scroll', hide, true);
}
