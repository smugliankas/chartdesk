import { defaultAppearance, FONT_SIZES, withTheme, type Appearance, type Theme } from '../chart/appearance';

/**
 * The chart settings dialog. Every change is applied right away through `onChange`.
 * Returns `open()` and `sync()` (call `sync` when the appearance changes elsewhere, e.g. the vol button).
 */
export function createSettingsDialog(
  get: () => Appearance,
  onChange: (a: Appearance) => void,
): { open: () => void; sync: () => void } {
  const dialog = document.createElement('dialog');
  dialog.id = 'settingsDialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>Chart settings</h2>

      <h3>Theme</h3>
      <div class="segmented" data-field="theme">
        <button type="button" value="dark">Dark</button>
        <button type="button" value="light">Light</button>
      </div>
      <p class="hint">Changes the app's colors. The chart's colors below stay as you set them.</p>

      <h3>Candles</h3>
      <div class="settings-row">
        <label>Up <input type="color" data-field="upColor" /></label>
        <label>Down <input type="color" data-field="downColor" /></label>
        <label><input type="checkbox" data-field="borders" /> Borders</label>
        <label><input type="checkbox" data-field="wicks" /> Wicks</label>
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
