import type { DrawingManager } from '../drawings/DrawingManager';
import type { Drawing } from '../drawings/model';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_WIDTH,
  FONT_SIZES,
  LINE_STYLES,
  LINE_WIDTHS,
  PALETTE,
  styleSupport,
  type LineStyle,
} from '../drawings/model';
import { ICONS } from './tools';

const lineIcon = (width: number, dash = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20"><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;

const STYLE_ICONS: Record<LineStyle, string> = {
  solid: lineIcon(2),
  dashed: lineIcon(2, '5 3'),
  dotted: lineIcon(2, '0.1 4'),
};

const STYLE_NAMES: Record<LineStyle, string> = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };

/**
 * Floating bar shown above the chart while a drawing is selected:
 * color, line width, line style, font size and delete.
 * Returns a function that refreshes it; call it whenever the drawings change.
 */
export interface LineAlertHooks {
  /** Whether alerts can be set on this kind of drawing. */
  supports: (d: Drawing) => boolean;
  /** Whether this drawing already has an active alert. */
  has: (drawingId: string) => boolean;
  /** Adds or removes the alert on this drawing. */
  toggle: (d: Drawing) => void;
}

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

  // --- color --------------------------------------------------------------
  const colorGroup = group();
  const colorButton = button(colorGroup, '<span class="swatch"></span>', 'Color', () => palette.classList.toggle('hidden'));
  const swatch = colorButton.querySelector<HTMLSpanElement>('.swatch')!;

  const palette = document.createElement('div');
  palette.className = 'palette hidden';
  colorGroup.append(palette);
  for (const c of PALETTE) {
    const s = document.createElement('button');
    s.className = 'palette-swatch';
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => {
      drawings.setStyle({ color: c });
      palette.classList.add('hidden');
    });
    palette.append(s);
  }
  const custom = document.createElement('label');
  custom.className = 'palette-custom';
  custom.textContent = 'Custom…';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.addEventListener('input', () => drawings.setStyle({ color: picker.value }, true));
  picker.addEventListener('change', () => drawings.setStyle({ color: picker.value }));
  custom.append(picker);
  palette.append(custom);

  // Close the palette on any click outside it.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') palette.classList.add('hidden');
  });
  document.addEventListener('mousedown', (e) => {
    if (!colorGroup.contains(e.target as Node)) palette.classList.add('hidden');
  });

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

  // --- font size ------------------------------------------------------------
  const fontGroup = group();
  const fontSelect = document.createElement('select');
  fontSelect.title = 'Font size';
  for (const size of FONT_SIZES) fontSelect.append(new Option(`${size}px`, String(size)));
  fontSelect.addEventListener('change', () => drawings.setStyle({ fontSize: Number(fontSelect.value) }));
  fontGroup.append(fontSelect);

  // --- delete -----------------------------------------------------------------
  // --- alert (horizontal and sloped lines) --------------------------------------
  const alertGroup = group();
  const alertButton = button(alertGroup, ICONS.bell, 'Alert when price crosses this line', () => {
    const d = drawings.selectedDrawing;
    if (d && alerts) alerts.toggle(d);
  });

  const deleteGroup = group();
  button(deleteGroup, ICONS.trash, 'Delete (Del)', () => drawings.deleteSelected()).classList.add('danger');

  return () => {
    const d = drawings.currentTool === 'cursor' ? drawings.selectedDrawing : null;
    bar.classList.toggle('hidden', !d);
    if (!d) {
      palette.classList.add('hidden');
      return;
    }
    const support = styleSupport(d.type);
    colorGroup.classList.toggle('hidden', !support.color);
    widthGroup.classList.toggle('hidden', !support.line);
    lineStyleGroup.classList.toggle('hidden', !support.line);
    fontGroup.classList.toggle('hidden', !support.font);
    alertGroup.classList.toggle('hidden', !alerts?.supports(d));
    alertButton.classList.toggle('active', !!alerts?.has(d.id));

    swatch.style.background = d.color;
    if (/^#[0-9a-f]{6}$/i.test(d.color)) picker.value = d.color;
    const width = d.width ?? DEFAULT_WIDTH;
    for (const [w, b] of widthButtons) b.classList.toggle('active', w === width);
    const lineStyle = d.lineStyle ?? 'solid';
    for (const [s, b] of styleButtons) b.classList.toggle('active', s === lineStyle);
    if (d.type === 'text') fontSelect.value = String(d.fontSize ?? DEFAULT_FONT_SIZE);
  };
}
