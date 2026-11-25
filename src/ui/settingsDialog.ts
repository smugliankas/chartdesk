import { defaultAppearance, FONT_SIZES, withTheme, type Appearance, type Theme } from '../chart/appearance';

/**
 * The chart settings dialog. Every change is applied right away through `onChange`.
 * Returns `open()` and `sync()` (call `sync` when the appearance changes elsewhere, e.g. the vol button).
 */
export function createSettingsDialog(
  get: () => Appearance,
  onChange: (a: Appearance) => void,
  backup: { onExport: () => void; onImport: () => void },
): { open: () => void; sync: () => void } {
  const dialog = document.createElement('dialog');
  dialog.id = 'settingsDialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>Settings</h2>

      <h3>Theme</h3>
      <div class="segmented" data-field="theme">
        <button type="button" value="dark">Dark</button>
        <button type="button" value="light">Light</button>
      </div>
      <p class="hint">Changes the app's colors. The chart's colors below stay as you set them.</p>

      <h3>Candles</h3>
      <div class="candle-grid">
        <span></span><span class="col-head">Up</span><span class="col-head">Down</span>
        <span class="row-head">Body</span>
        <input type="color" data-field="upColor" title="Body, up" />
        <input type="color" data-field="downColor" title="Body, down" />
        <label class="row-head"><input type="checkbox" data-field="borders" /> Borders</label>
        <input type="color" data-field="borderUpColor" title="Border, up" />
        <input type="color" data-field="borderDownColor" title="Border, down" />
        <label class="row-head"><input type="checkbox" data-field="wicks" /> Wicks</label>
        <input type="color" data-field="wickUpColor" title="Wick, up" />
        <input type="color" data-field="wickDownColor" title="Wick, down" />
      </div>

      <h3>Text</h3>
      <div class="settings-row">
        <label>Color <input type="color" data-field="textColor" /></label>
        <label>Size <select data-field="fontSize">${FONT_SIZES.map((s) => `<option value="${s}">${s}px</option>`).join('')}</select></label>
      </div>
      <p class="hint">Price and time scales, and the symbol name on the chart.</p>

      <h3>Price scale</h3>
      <div class="settings-row">
        <label><input type="checkbox" data-field="countdown" /> Countdown to bar close</label>
      </div>

      <h3>Background</h3>
      <div class="settings-row">
        <label>Color <input type="color" data-field="background" /></label>
      </div>

      <h3>Grid</h3>
      <div class="settings-row">
        <label><input type="checkbox" data-field="gridVert" /> Vertical lines</label>
        <label><input type="checkbox" data-field="gridHorz" /> Horizontal lines</label>
        <label>Color <input type="color" data-field="gridColor" /></label>
      </div>

      <h3>Volume</h3>
      <div class="settings-row">
        <label><input type="checkbox" data-field="showVolume" /> Show volume</label>
      </div>

      <h3>Backup</h3>
      <div class="settings-row">
        <button type="button" id="backupExport">Export backup…</button>
        <button type="button" id="backupImport">Restore from file…</button>
      </div>
      <p class="hint">Drawings, alerts, watchlist and settings are kept only in this browser. Export a backup now and then, or to move to another computer.</p>

      <div class="dialog-actions spread">
        <button type="button" id="settingsReset">Reset to defaults</button>
        <button value="close">Done</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const inputs = [...dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-field], select[data-field]')];
  const themeButtons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-field="theme"] button')];

  const sync = () => {
    const a = get();
    for (const input of inputs) {
      const value = a[input.dataset.field as keyof Appearance];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    for (const b of themeButtons) b.classList.toggle('active', b.value === a.theme);
    // Border/wick colors only matter while borders/wicks are shown.
    for (const input of inputs) {
      const f = input.dataset.field;
      if (f === 'borderUpColor' || f === 'borderDownColor') input.disabled = !a.borders;
      if (f === 'wickUpColor' || f === 'wickDownColor') input.disabled = !a.wicks;
    }
  };

  for (const input of inputs) {
    const apply = () => {
      const field = input.dataset.field as keyof Appearance;
      const value =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : input instanceof HTMLSelectElement
            ? Number(input.value)
            : input.value;
      onChange({ ...get(), [field]: value });
      if (typeof value === 'boolean') sync();
    };
    input.addEventListener(input.type === 'color' ? 'input' : 'change', apply);
  }
  for (const b of themeButtons) {
    b.addEventListener('click', () => {
      onChange(withTheme(get(), b.value as Theme));
      sync();
    });
  }
  dialog.querySelector('#settingsReset')!.addEventListener('click', () => {
    onChange(defaultAppearance(get().theme));
    sync();
  });
  dialog.querySelector('#backupExport')!.addEventListener('click', () => backup.onExport());
  dialog.querySelector('#backupImport')!.addEventListener('click', () => backup.onImport());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // click on the backdrop
  });

  return {
    open: () => {
      sync();
      dialog.showModal();
    },
    sync,
  };
}
