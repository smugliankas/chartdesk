/**
 * Gives a <select> the app's own button and menu, so it looks the same on every system: the
 * browser's own list follows the operating system (glassy on a Mac, plain on Windows).
 *
 * The <select> stays in the page, hidden, and keeps working as before: code reads and sets its
 * `value` and listens for `change`. An option can carry a second, muted line in `data-detail`.
 */
export function enhanceSelect(select: HTMLSelectElement): void {
  if (select.dataset.enhanced) return;
  select.dataset.enhanced = '1';

  const box = document.createElement('span');
  box.className = ('select-box ' + select.className).trim(); // spacing classes go on the box
  select.replaceWith(box);
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-button';
  button.setAttribute('aria-haspopup', 'listbox');
  const label = document.createElement('span');
  label.className = 'select-label';
  button.append(label);
  button.insertAdjacentHTML(
    'beforeend',
    '<svg class="select-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );

  const menu = document.createElement('div');
  menu.className = 'select-menu hidden';
  menu.setAttribute('role', 'listbox');
  box.append(button, select, menu);

  let active = -1;

  const refresh = () => {
    const option = select.selectedOptions[0];
    label.textContent = option?.textContent ?? '';
    button.disabled = select.disabled;
    // Tooltips come from the <select>.
    if (select.title) button.title = select.title;
    else button.removeAttribute('title');
    if (select.dataset.tip) button.dataset.tip = select.dataset.tip;
  };

  const render = () => {
    menu.replaceChildren(
      ...[...select.options].map((option, i) => {
        const item = document.createElement('div');
        item.className =
          'select-item' + (option.selected ? ' selected' : '') + (i === active ? ' active' : '') + (option.disabled ? ' disabled' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        const text = document.createElement('span');
        text.className = 'select-text';
        text.textContent = option.textContent;
        if (option.dataset.detail) {
          const detail = document.createElement('small');
          detail.textContent = option.dataset.detail;
          text.append(detail);
        }
        item.append(text);
        if (option.selected) {
          item.insertAdjacentHTML(
            'beforeend',
            '<svg class="select-check" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          );
        }
        // mousedown so the button keeps focus.
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (!option.disabled) pick(i);
        });
        item.addEventListener('mousemove', () => {
          if (active === i) return;
          active = i;
          for (const [j, el] of [...menu.children].entries()) el.classList.toggle('active', j === i);
        });
        return item;
      }),
    );
  };

  const isOpen = () => !menu.classList.contains('hidden');

  const open = () => {
    if (select.disabled) return;
    active = select.selectedIndex;
    render();
    menu.classList.remove('hidden');
    // Open upwards when there is no room below (the replay bar sits at the bottom).
    const rect = box.getBoundingClientRect();
    menu.classList.toggle('up', rect.bottom + menu.offsetHeight + 8 > window.innerHeight && rect.top > menu.offsetHeight + 8);
    button.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    menu.classList.add('hidden');
    button.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  };

  const pick = (index: number) => {
    close();
    if (index === select.selectedIndex) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const move = (step: number) => {
    const n = select.options.length;
    for (let k = 1; k <= n; k++) {
      const i = (((active + step * k) % n) + n) % n;
      if (!select.options[i].disabled) {
        active = i;
        break;
      }
    }
    render();
    menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  // The browser focuses the button on its own; focusing it from code would make the browser
  // draw its thick keyboard-focus ring after a mouse click.
  button.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isOpen()) close();
    else open();
  });
  // Safari doesn't focus buttons on click, so blur never comes: close on a click elsewhere.
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !box.contains(e.target as Node)) close();
  });
  button.addEventListener('click', (e) => {
    // Keyboard "click" (Enter/Space are handled below; this catches assistive tech).
    if (e.detail === 0 && !isOpen()) open();
  });
  button.addEventListener('keydown', (e) => {
    if (!isOpen()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (active >= 0) pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc closes the menu only, not a dialog or full screen
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });
  button.addEventListener('blur', close);

  // Code sets the value directly (select.value = …); keep the button's label in step.
  for (const prop of ['value', 'selectedIndex'] as const) {
    const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop)!;
    Object.defineProperty(select, prop, {
      configurable: true,
      get() {
        return native.get!.call(this);
      },
      set(v) {
        native.set!.call(this, v);
        refresh();
      },
    });
  }
  new MutationObserver(refresh).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'title', 'data-tip'],
  });
  refresh();
}
