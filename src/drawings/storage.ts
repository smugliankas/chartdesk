import type { Drawing, DrawingStyle, DrawingType } from './model';

const PREFIX = 'chartdesk:drawings:';
/** Key prefix used before the project was named ChartDesk; read once and moved over. */
const OLD_PREFIX = 'chart-app:drawings:';

// Browser storage can be unavailable or full; drawing must keep working either way.

export function loadDrawings(key: string): Drawing[] {
  try {
    const raw = localStorage.getItem(PREFIX + key) ?? localStorage.getItem(OLD_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(key: string, drawings: readonly Drawing[]): void {
  try {
    if (drawings.length === 0) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(drawings));
    localStorage.removeItem(OLD_PREFIX + key);
  } catch {
    /* ignore */
  }
}

// --- last-used style per tool -------------------------------------------------

const STYLES_KEY = 'chartdesk:styles';

export function loadStyleDefaults(): Partial<Record<DrawingType, DrawingStyle>> {
  try {
    const raw = localStorage.getItem(STYLES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<DrawingType, DrawingStyle>>) : {};
  } catch {
    return {};
  }
}

export function saveStyleDefaults(styles: Partial<Record<DrawingType, DrawingStyle>>): void {
  try {
    localStorage.setItem(STYLES_KEY, JSON.stringify(styles));
  } catch {
    /* ignore */
  }
}
