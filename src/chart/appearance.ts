export type Theme = 'dark' | 'light';

/** Everything about how the chart looks. Saved between visits. */
export interface Appearance {
  theme: Theme;
  upColor: string;
  downColor: string;
  borders: boolean;
  wicks: boolean;
  background: string;
  gridVert: boolean;
  gridHorz: boolean;
  gridColor: string;
  showVolume: boolean;
  /** Color of the price/time scale labels and the symbol name in the legend. */
  textColor: string;
  /** Font size of the price/time scale labels. */
  fontSize: number;
}

export const FONT_SIZES: readonly number[] = [10, 11, 12, 13, 14, 16];

/** Colors that come with a theme (not user-editable on their own). */
export interface ThemeColors {
  background: string;
  grid: string;
  text: string;
  border: string;
}

export const THEMES: Record<Theme, ThemeColors> = {
  dark: { background: '#0c0c0c', grid: '#1b1b1b', text: '#d6d6d6', border: '#262626' },
  light: { background: '#ffffff', grid: '#eef1f6', text: '#131722', border: '#e0e3eb' },
};

export function defaultAppearance(theme: Theme = 'dark'): Appearance {
  return {
    theme,
    upColor: '#26a69a',
    downColor: '#ef5350',
    borders: true,
    wicks: true,
    background: THEMES[theme].background,
    gridVert: true,
    gridHorz: true,
    gridColor: THEMES[theme].grid,
    showVolume: true,
    textColor: THEMES[theme].text,
    fontSize: 12,
  };
}

/** Switches the app theme only. The chart's own colors (background, grid, text, candles) stay as set. */
export function withTheme(a: Appearance, theme: Theme): Appearance {
  return { ...a, theme };
}

const KEY = 'chartdesk:appearance';

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Appearance>) : {};
    const theme: Theme = saved.theme === 'light' ? 'light' : 'dark';
    // The first dark theme was dark blue; move its default colors to the new black theme.
    if (saved.background === '#0f1117') saved.background = THEMES.dark.background;
    if (saved.gridColor === '#1c2030') saved.gridColor = THEMES.dark.grid;
    return { ...defaultAppearance(theme), ...saved, theme };
  } catch {
    return defaultAppearance();
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

/** "#rrggbb" + alpha → "rgba(...)". Falls back to the color itself for other formats. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Returns `color`, or `fallback` when `color` would be nearly invisible on `background`
 * (e.g. a white text note after switching to the light theme).
 */
export function readable(color: string, background: string, fallback: string): string {
  const a = luminance(color);
  const b = luminance(background);
  if (a === null || b === null) return color;
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contrast < 1.6 ? fallback : color;
}

/** Dark or light text, whichever reads better on `background`. */
export function contrastText(background: string): string {
  const l = luminance(background);
  return l !== null && l > 0.4 ? THEMES.light.text : THEMES.dark.text;
}

/** The text color actually used: the chosen one, unless it would be unreadable on the background. */
export function effectiveTextColor(a: Appearance): string {
  return readable(a.textColor, a.background, contrastText(a.background));
}
