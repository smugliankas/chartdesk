import type { DrawingManager } from '../drawings/DrawingManager';
import { readable, withAlpha } from '../chart/appearance';
import { enhanceSelect } from './selectMenu';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LABEL_POS,
  DEFAULT_LABEL_SIZE,
  DEFAULT_LOSS_COLOR,
  DEFAULT_PROFIT_COLOR,
  DEFAULT_WIDTH,
  FIB_LEVELS,
  fibLevelsOf,
  fibShowsTrendLine,
  FONT_SIZES,
  LABEL_POSITIONS,
  LINE_STYLES,
  LINE_WIDTHS,
  PALETTE,
  styleSupport,
  type Drawing,
  type DrawingStyle,
  type LabelPos,
  type LineStyle,
} from '../drawings/model';
import { shownOn } from '../drawings/model';
import { TF_LABELS, TIMEFRAMES, type Timeframe } from '../types';
import { ICONS } from './tools';

const lineIcon = (width: number, dash = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20"><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;

const STYLE_ICONS: Record<LineStyle, string> = {
  solid: lineIcon(2),
  dashed: lineIcon(2, '5 3'),
  dotted: lineIcon(2, '0.1 4'),
};

const STYLE_NAMES: Record<LineStyle, string> = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };

const LEVELS_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h16"/><path d="M17 10l2 2-2 2"/></svg>';

const LABEL_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19h18"/><path d="M7 15l5-11 5 11M8.8 11h6.4"/></svg>';

const TEMPLATE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10a1 1 0 011 1v15l-6-4-6 4V5a1 1 0 011-1z"/></svg>';

const LABEL_POS_NAMES: Record<LabelPos, string> = {
  'top-left': 'Above, left',
  'top-center': 'Above, middle',
  'top-right': 'Above, right',
  'middle-left': 'On the line, left',
  'middle-center': 'On the line, middle',
  'middle-right': 'On the line, right',
  'bottom-left': 'Below, left',
  'bottom-center': 'Below, middle',
  'bottom-right': 'Below, right',
};

const LABEL_SIZES: readonly number[] = [10, 11, 12, 13, 14, 16, 18, 20, 24];

const TIMEFRAMES_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>';

/** Which color the palette is currently picking. */
type ColorTarget = 'color' | 'profitColor' | 'lossColor';

export interface LineAlertHooks {
  /** Whether alerts can be set on this kind of drawing. */
  supports: (d: Drawing) => boolean;
  /** Whether this drawing already has an active alert. */
  has: (drawingId: string) => boolean;
  /** Adds or removes the alert on this drawing. */
  toggle: (d: Drawing) => void;
}

/**
 * Floating bar shown above the chart while a drawing is selected. It shows only the
 * controls that apply: color, line width and style, font size, target/stop colors for
 * positions, levels for Fibonacci, an alert toggle for lines, and delete.
 * Returns a function that refreshes it; call it whenever the drawings change.
 */
export function createStyleBar(host: HTMLElement, drawings: DrawingManager, alerts?: LineAlertHooks): () => void {
  const bar = document.createElement('div');
  bar.id = 'styleBar';
  bar.className = 'hidden';
  host.append(bar);

  const group = () => {
    const g = document.createElement('div');
    g.className = 'sb-group';
    bar.append(g);
    return g;
  };
  const button = (parent: HTMLElement, html: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'sb-button';
    b.innerHTML = html;
    b.title = title;
    b.addEventListener('click', onClick);
    parent.append(b);
    return b;
  };
  const swatchButton = (parent: HTMLElement, title: string, target: ColorTarget) => {
    const b = button(parent, '<span class="swatch"></span>', title, () => openPalette(b, target));
    return { button: b, swatch: b.querySelector<HTMLSpanElement>('.swatch')! };
  };

  // --- shared color palette ----------------------------------------------------
  const palette = document.createElement('div');
  palette.className = 'palette hidden';
  bar.append(palette);
  let paletteTarget: ColorTarget = 'color';

  const setColor = (color: string, live = false) => drawings.setStyle({ [paletteTarget]: color } as DrawingStyle, live);

  for (const c of PALETTE) {
    const s = document.createElement('button');
    s.className = 'palette-swatch';
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => {
      setColor(c);
      palette.classList.add('hidden');
    });
    palette.append(s);
  }
  const custom = document.createElement('label');
  custom.className = 'palette-custom';
  custom.textContent = 'Custom…';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.addEventListener('input', () => setColor(picker.value, true));
  picker.addEventListener('change', () => setColor(picker.value));
  custom.append(picker);
  palette.append(custom);

  const currentColor = (target: ColorTarget): string => {
    const d = drawings.selectedDrawing;
    if (!d) return '#000000';
    if (target === 'color') return d.color;
    if (d.type !== 'long' && d.type !== 'short') return d.color;
    return target === 'profitColor' ? (d.profitColor ?? DEFAULT_PROFIT_COLOR) : (d.lossColor ?? DEFAULT_LOSS_COLOR);
  };

  function openPalette(anchor: HTMLElement, target: ColorTarget): void {
    const wasOpenHere = !palette.classList.contains('hidden') && paletteTarget === target;
    closePopovers();
    if (wasOpenHere) return;
    paletteTarget = target;
    const color = currentColor(target);
    if (/^#[0-9a-f]{6}$/i.test(color)) picker.value = color;
    palette.style.left = `${anchor.offsetLeft + anchor.parentElement!.offsetLeft}px`;
    palette.classList.remove('hidden');
  }

  // --- color --------------------------------------------------------------
  const colorGroup = group();
  const lineColor = swatchButton(colorGroup, 'Color', 'color');

  // --- position zones ---------------------------------------------------------
  const zoneGroup = group();
  const profitColor = swatchButton(zoneGroup, 'Target zone color', 'profitColor');
  const lossColor = swatchButton(zoneGroup, 'Stop zone color', 'lossColor');

  // --- line width & style ---------------------------------------------------
  const widthGroup = group();
  const widthButtons = new Map<number, HTMLButtonElement>();
  for (const w of LINE_WIDTHS) {
    widthButtons.set(w, button(widthGroup, lineIcon(w), `${w}px`, () => drawings.setStyle({ width: w })));
  }

  const lineStyleGroup = group();
  const styleButtons = new Map<LineStyle, HTMLButtonElement>();
  for (const s of LINE_STYLES) {
    styleButtons.set(s, button(lineStyleGroup, STYLE_ICONS[s], STYLE_NAMES[s], () => drawings.setStyle({ lineStyle: s })));
  }

  // --- Fibonacci levels ---------------------------------------------------------
  const fibGroup = group();
  const levelsButton = button(fibGroup, LEVELS_ICON, 'Levels and trend line', () => {
    const open = !levelsMenu.classList.contains('hidden');
    closePopovers();
    if (!open) {
      levelsMenu.style.left = `${fibGroup.offsetLeft}px`;
      levelsMenu.classList.remove('hidden');
    }
    syncMenuButtons();
  });
  const levelsMenu = document.createElement('div');
  levelsMenu.className = 'levels-menu hidden';
  bar.append(levelsMenu);

  const levelChecks = new Map<number, HTMLInputElement>();
  for (const level of FIB_LEVELS) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      const d = drawings.selectedDrawing;
      if (!d || d.type !== 'fib') return;
      const set = new Set(fibLevelsOf(d));
      if (box.checked) set.add(level);
      else set.delete(level);
      drawings.setStyle({ levels: [...set] });
    });
    label.append(box, String(level));
    levelsMenu.append(label);
    levelChecks.set(level, box);
  }
  const trendLabel = document.createElement('label');
  trendLabel.className = 'levels-trend';
  const trendBox = document.createElement('input');
  trendBox.type = 'checkbox';
  trendBox.addEventListener('change', () => drawings.setStyle({ trendLine: trendBox.checked }));
  trendLabel.append(trendBox, 'Trend line');
  levelsMenu.append(trendLabel);

  // --- text on the drawing, and where it sits ---------------------------------------
  const labelGroup = group();
  const labelButton = button(labelGroup, LABEL_ICON, 'Text on the drawing', () => {
    const open = !labelMenu.classList.contains('hidden');
    closePopovers();
    if (!open) {
      labelMenu.style.left = `${labelGroup.offsetLeft}px`;
      labelMenu.classList.remove('hidden');
      labelInput.focus();
      labelInput.select();
    }
    syncMenuButtons();
  });
  const labelMenu = document.createElement('div');
  labelMenu.className = 'levels-menu label-menu hidden';
  bar.append(labelMenu);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Text, e.g. FVG';
  labelInput.spellcheck = false;
  // Shown as you type; one undo step when you leave the box or press Enter.
  labelInput.addEventListener('input', () => drawings.setStyle({ label: labelInput.value }, true));
  labelInput.addEventListener('change', () => drawings.setStyle({ label: labelInput.value }));
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      drawings.setStyle({ label: labelInput.value });
      closePopovers();
    }
  });

  const posTitle = document.createElement('div');
  posTitle.className = 'tf-title';
  posTitle.textContent = 'Position';
  const posGrid = document.createElement('div');
  posGrid.className = 'label-grid';
  const posButtons = new Map<LabelPos, HTMLButtonElement>();
  for (const pos of LABEL_POSITIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `label-pos ${pos}`;
    b.title = LABEL_POS_NAMES[pos];
    b.innerHTML = '<span></span>';
    b.addEventListener('click', () => drawings.setStyle({ labelPos: pos }));
    posGrid.append(b);
    posButtons.set(pos, b);
  }

  const sizeRow = document.createElement('label');
  sizeRow.className = 'label-size';
  const sizeSelect = document.createElement('select');
  for (const size of LABEL_SIZES) sizeSelect.append(new Option(`${size}px`, String(size)));
  sizeSelect.addEventListener('change', () => drawings.setStyle({ labelSize: Number(sizeSelect.value) }));
  sizeRow.append('Size', sizeSelect);
  labelMenu.append(labelInput, posTitle, posGrid, sizeRow);
  enhanceSelect(sizeSelect);

  // --- templates: named styles for this kind of drawing ----------------------------------
  const templateGroup = group();
  const templateButton = button(templateGroup, TEMPLATE_ICON, 'Templates', () => {
    const open = !templateMenu.classList.contains('hidden');
    closePopovers();
    if (!open) {
      templateMenu.style.left = `${templateGroup.offsetLeft}px`;
      renderTemplates();
      templateMenu.classList.remove('hidden');
    }
    syncMenuButtons();
  });
  const templateMenu = document.createElement('div');
  templateMenu.className = 'levels-menu template-menu hidden';
  bar.append(templateMenu);

  const templateList = document.createElement('div');
  templateList.className = 'template-list';
  const saveRow = document.createElement('form');
  saveRow.className = 'template-save';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Name, e.g. FVG';
  nameInput.spellcheck = false;
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.textContent = 'Save';
  saveRow.append(nameInput, saveButton);
  saveRow.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!nameInput.value.trim()) return nameInput.focus();
    drawings.saveTemplate(nameInput.value);
    nameInput.value = '';
    renderTemplates();
  });
  const saveTitle = document.createElement('div');
  saveTitle.className = 'tf-title';
  saveTitle.textContent = 'Save this style as a template';
  templateMenu.append(templateList, saveTitle, saveRow);

  function renderTemplates(): void {
    const d = drawings.selectedDrawing;
    if (!d) return;
    const list = drawings.templatesFor(d.type);
    templateList.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'template-empty';
      empty.textContent = 'No templates for this tool yet.';
      templateList.append(empty);
    }
    for (const t of list) {
      const row = document.createElement('div');
      row.className = 'template-row';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'template-apply';
      // A small picture of the template: a box for boxes, a line for the rest, in its color
      // (or the text color when that color would vanish on the menu, e.g. black on dark).
      const sample = document.createElement('span');
      const isBox = d.type === 'rect' || d.type === 'channel';
      sample.className = 'template-sample' + (isBox ? ' box' : '');
      const css = getComputedStyle(document.body);
      const color = readable(t.style.color ?? d.color, css.getPropertyValue('--panel').trim(), css.getPropertyValue('--text').trim());
      sample.style.borderColor = color;
      sample.style.borderStyle = t.style.lineStyle ?? 'solid';
      sample.style.borderWidth = `${Math.max(isBox ? 1.5 : 2, t.style.width ?? DEFAULT_WIDTH)}px`;
      if (isBox) sample.style.background = withAlpha(color, 0.18);
      const name = document.createElement('span');
      name.textContent = t.name;
      apply.append(sample, name);
      apply.title = `Apply "${t.name}"`;
      apply.addEventListener('click', () => {
        drawings.applyTemplate(t.name);
        closePopovers();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'template-remove';
      remove.textContent = '×';
      remove.title = `Delete "${t.name}"`;
      remove.addEventListener('click', () => {
        drawings.deleteTemplate(d.type, t.name);
        renderTemplates();
      });
      row.append(apply, remove);
      templateList.append(row);
    }
  }

  // --- timeframes the drawing shows on -----------------------------------------
  const tfGroup = group();
  const tfButton = button(tfGroup, TIMEFRAMES_ICON, 'Show on timeframes', () => {
    const open = !tfMenu.classList.contains('hidden');
    closePopovers();
    if (!open) {
      tfMenu.style.left = `${tfGroup.offsetLeft}px`;
      tfMenu.classList.remove('hidden');
    }
    syncMenuButtons();
  });
  const tfMenu = document.createElement('div');
  tfMenu.className = 'levels-menu tf-menu hidden';
  bar.append(tfMenu);

  const tfTitle = document.createElement('div');
  tfTitle.className = 'tf-title';
  tfTitle.textContent = 'Show on timeframes';
  const presets = document.createElement('div');
  presets.className = 'tf-presets';
  tfMenu.append(tfTitle, presets);

  const setTimeframes = (list: Timeframe[] | undefined) => drawings.setTimeframes(list);
  const current = (): Timeframe | null => drawings.timeframe;
  const preset = (label: () => string, pick: (i: number) => Timeframe[] | undefined) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.addEventListener('click', () => {
      const tf = current();
      setTimeframes(tf ? pick(TIMEFRAMES.indexOf(tf)) : undefined);
    });
    presets.append(b);
    return { button: b, label, pick };
  };
  const presetButtons = [
    preset(() => 'All', () => undefined),
    preset(() => `Only ${TF_LABELS[current() ?? '1h']}`, (i) => [TIMEFRAMES[i]]),
    preset(() => `${TF_LABELS[current() ?? '1h']} and above`, (i) => TIMEFRAMES.slice(i)),
    preset(() => `${TF_LABELS[current() ?? '1h']} and below`, (i) => TIMEFRAMES.slice(0, i + 1)),
  ];

  const tfGrid = document.createElement('div');
  tfGrid.className = 'tf-grid';
  tfMenu.append(tfGrid);
  const tfChecks = new Map<Timeframe, HTMLInputElement>();
  for (const tf of TIMEFRAMES) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      const d = drawings.selectedDrawing;
      if (!d) return;
      const set = new Set(d.timeframes ?? TIMEFRAMES);
      if (box.checked) set.add(tf);
      else set.delete(tf);
      if (set.size === 0) {
        box.checked = true; // a drawing has to show somewhere
        return;
      }
      setTimeframes(set.size === TIMEFRAMES.length ? undefined : TIMEFRAMES.filter((t) => set.has(t)));
    });
    label.append(box, TF_LABELS[tf]);
    tfGrid.append(label);
    tfChecks.set(tf, box);
  }

  // --- font size ------------------------------------------------------------
  const fontGroup = group();
  const fontSelect = document.createElement('select');
  fontSelect.title = 'Font size';
  for (const size of FONT_SIZES) fontSelect.append(new Option(`${size}px`, String(size)));
  fontSelect.addEventListener('change', () => drawings.setStyle({ fontSize: Number(fontSelect.value) }));
  fontGroup.append(fontSelect);
  enhanceSelect(fontSelect);

  // --- alert (horizontal and sloped lines) --------------------------------------
  const alertGroup = group();
  const alertButton = button(alertGroup, ICONS.bell, 'Alert when price crosses this line', () => {
    const d = drawings.selectedDrawing;
    if (d && alerts) alerts.toggle(d);
  });

  // --- lock -------------------------------------------------------------------
  const lockGroup = group();
  const lockButton = button(lockGroup, ICONS.unlock, 'Lock', () => drawings.toggleLock());

  // --- delete -----------------------------------------------------------------
  const deleteGroup = group();
  button(deleteGroup, ICONS.trash, 'Delete (Del)', () => drawings.deleteSelected()).classList.add('danger');

  // --- closing popovers ---------------------------------------------------------
  function closePopovers(): void {
    palette.classList.add('hidden');
    levelsMenu.classList.add('hidden');
    tfMenu.classList.add('hidden');
    labelMenu.classList.add('hidden');
    templateMenu.classList.add('hidden');
    syncMenuButtons();
  }

  /** A button that opens a menu is lit only while its menu is open (the timeframe one also while the drawing is limited). */
  function syncMenuButtons(): void {
    const open = (menu: HTMLElement) => !menu.classList.contains('hidden');
    labelButton.classList.toggle('active', open(labelMenu));
    templateButton.classList.toggle('active', open(templateMenu));
    levelsButton.classList.toggle('active', open(levelsMenu));
    tfButton.classList.toggle('active', !!drawings.selectedDrawing?.timeframes || open(tfMenu));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopovers();
  });
  document.addEventListener('mousedown', (e) => {
    if (!bar.contains(e.target as Node)) closePopovers();
  });

  return () => {
    const d = drawings.currentTool === 'cursor' ? drawings.selectedDrawing : null;
    bar.classList.toggle('hidden', !d);
    if (!d) {
      closePopovers();
      return;
    }
    const support = styleSupport(d.type);
    colorGroup.classList.toggle('hidden', !support.color);
    zoneGroup.classList.toggle('hidden', !support.zones);
    widthGroup.classList.toggle('hidden', !support.line);
    lineStyleGroup.classList.toggle('hidden', !support.line);
    fibGroup.classList.toggle('hidden', !support.fib);
    fontGroup.classList.toggle('hidden', !support.font);
    labelGroup.classList.toggle('hidden', !support.label);
    if (!support.label) labelMenu.classList.add('hidden');
    alertGroup.classList.toggle('hidden', !alerts?.supports(d));
    alertButton.classList.toggle('active', !!alerts?.has(d.id));
    lockButton.innerHTML = d.locked ? ICONS.lock : ICONS.unlock;
    lockButton.classList.toggle('active', !!d.locked);
    lockButton.dataset.tip = d.locked ? 'Unlock' : 'Lock (stops it from being moved)';
    lockButton.removeAttribute('title');
    for (const g of [colorGroup, zoneGroup, widthGroup, lineStyleGroup, fibGroup, tfGroup, fontGroup, labelGroup, templateGroup]) g.classList.toggle('locked', !!d.locked);
    if (!support.fib) levelsMenu.classList.add('hidden');

    const limited = !!d.timeframes;
    tfButton.dataset.tip = limited ? `Shown on ${d.timeframes!.map((t) => TF_LABELS[t]).join(', ')}` : 'Show on timeframes (all)';
    tfButton.removeAttribute('title');
    for (const [tf, box] of tfChecks) box.checked = shownOn(d, tf);
    const tfNow = current();
    for (const p of presetButtons) {
      p.button.textContent = p.label();
      // Light up the preset that matches the drawing's current choice.
      const list = tfNow ? p.pick(TIMEFRAMES.indexOf(tfNow)) : undefined;
      const same = list === undefined ? !d.timeframes : !!d.timeframes && list.join() === d.timeframes.join();
      p.button.classList.toggle('active', same);
    }

    lineColor.swatch.style.background = d.color;
    profitColor.swatch.style.background = currentColor('profitColor');
    lossColor.swatch.style.background = currentColor('lossColor');
    const width = d.width ?? DEFAULT_WIDTH;
    for (const [w, b] of widthButtons) b.classList.toggle('active', w === width);
    const lineStyle = d.lineStyle ?? 'solid';
    for (const [s, b] of styleButtons) b.classList.toggle('active', s === lineStyle);
    if (d.type === 'text') fontSelect.value = String(d.fontSize ?? DEFAULT_FONT_SIZE);
    if (support.label) {
      // Don't overwrite what is being typed.
      if (document.activeElement !== labelInput) labelInput.value = d.label ?? '';
      const pos = d.labelPos ?? DEFAULT_LABEL_POS;
      for (const [p, b] of posButtons) b.classList.toggle('active', p === pos);
      sizeSelect.value = String(d.labelSize ?? DEFAULT_LABEL_SIZE);
      const isBox = d.type === 'rect';
      for (const [p, b] of posButtons) b.title = isBox ? LABEL_POS_NAMES[p].replace('Above', 'Top').replace('On the line', 'Middle').replace('Below', 'Bottom') : LABEL_POS_NAMES[p];
    }
    syncMenuButtons();
    if (!templateMenu.classList.contains('hidden')) renderTemplates();
    if (d.type === 'fib') {
      const shown = new Set(fibLevelsOf(d));
      for (const [level, box] of levelChecks) box.checked = shown.has(level);
      trendBox.checked = fibShowsTrendLine(d);
    }
  };
}
