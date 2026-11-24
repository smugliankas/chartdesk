import type { Drawing } from './model';

const PREFIX = 'chart-app:drawings:';

// Browser storage can be unavailable or full; drawing must keep working either way.

export function loadDrawings(key: string): Drawing[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
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
  } catch {
    /* ignore */
  }
}
