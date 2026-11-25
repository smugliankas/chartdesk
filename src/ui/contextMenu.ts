export interface MenuItem {
  label: string;
  /** Shown on the right, e.g. "⌘D". */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

/** `null` draws a separator. */
export type MenuEntry = MenuItem | null;

let menu: HTMLDivElement | null = null;

function close(): void {
  menu?.remove();
  menu = null;
}

// One set of listeners for every menu: any click elsewhere, Esc, scrolling or resizing closes it.
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  document.addEventListener('wheel', close, { passive: true });
}

/** Opens a right-click menu at the given screen position. */
export function showContextMenu(clientX: number, clientY: number, entries: MenuEntry[]): void {
  listen();
  close();
  menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const entry of entries) {
    if (!entry) {
      menu.append(Object.assign(document.createElement('div'), { className: 'context-sep' }));
      continue;
    }
    const item = document.createElement('button');
    item.className = 'context-item' + (entry.danger ? ' danger' : '');
    item.setAttribute('role', 'menuitem');
    item.disabled = !!entry.disabled;
    const label = document.createElement('span');
    label.textContent = entry.label;
    item.append(label);
    if (entry.shortcut) {
      const key = document.createElement('span');
      key.className = 'context-shortcut';
      key.textContent = entry.shortcut;
      item.append(key);
    }
    item.addEventListener('click', () => {
      close();
      entry.action();
    });
    menu.append(item);
  }

  document.body.append(menu);
  // Keep it on screen.
  const r = menu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - r.width - 6);
  const y = clientY + r.height > window.innerHeight - 6 ? Math.max(6, clientY - r.height) : clientY;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}
