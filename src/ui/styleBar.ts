import type { DrawingManager } from '../drawings/DrawingManager';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LOSS_COLOR,
  DEFAULT_PROFIT_COLOR,
  DEFAULT_WIDTH,
  FIB_LEVELS,
  fibLevelsOf,
  fibShowsTrendLine,
  FONT_SIZES,
  LINE_STYLES,
  LINE_WIDTHS,
  PALETTE,
  styleSupport,
  type Drawing,
  type DrawingStyle,
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

  // --- timeframes the drawing shows on -----------------------------------------
  const tfGroup = group();
  const tfButton = button(tfGroup, TIMEFRAMES_ICON, 'Show on timeframes', () => {
    const open = !tfMenu.classList.contains('hidden');
    closePopovers();
    if (!open) {
      tfMenu.style.left = `${tfGroup.offsetLeft}px`;
      tfMenu.classList.remove('hidden');
    }
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
    alertGroup.classList.toggle('hidden', !alerts?.supports(d));
    alertButton.classList.toggle('active', !!alerts?.has(d.id));
    lockButton.innerHTML = d.locked ? ICONS.lock : ICONS.unlock;
    lockButton.classList.toggle('active', !!d.locked);
    lockButton.dataset.tip = d.locked ? 'Unlock' : 'Lock (stops it from being moved)';
    lockButton.removeAttribute('title');
    for (const g of [colorGroup, zoneGroup, widthGroup, lineStyleGroup, fibGroup, tfGroup, fontGroup]) g.classList.toggle('locked', !!d.locked);
    if (!support.fib) levelsMenu.classList.add('hidden');

    const limited = !!d.timeframes;
    tfButton.classList.toggle('active', limited || !tfMenu.classList.contains('hidden'));
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
    if (d.type === 'fib') {
      const shown = new Set(fibLevelsOf(d));
      for (const [level, box] of levelChecks) box.checked = shown.has(level);
      trendBox.checked = fibShowsTrendLine(d);
      levelsButton.classList.toggle('active', !levelsMenu.classList.contains('hidden'));
    }
  };
}
