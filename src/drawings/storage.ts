import type { Drawing, DrawingStyle, DrawingTemplate, DrawingType } from './model';

export const DRAWINGS_PREFIX = 'chartdesk:drawings:';
/** Key prefix used before the project was named ChartDesk; read once and moved over. */
const OLD_PREFIX = 'chart-app:drawings:';

/*
 * Drawings live in IndexedDB, not localStorage: localStorage holds only about 5 MB for the
 * whole app (roughly 20,000 drawings), while IndexedDB can use a good part of the disk, so
 * "unlimited drawings" really is unlimited.
 *
 * Everything is read into memory once at start (initDrawingStorage), so reading stays
 * instant and synchronous. Writes go out a moment after a change, so quick changes in a row
 * (dragging, arrow keys, undo) are written once; pending writes are flushed when the page is
 * hidden or closed. Without IndexedDB (rare), drawings fall back to localStorage.
 */

const DB_NAME = 'chartdesk';
const STORE = 'drawings';

const cache = new Map<string, readonly Drawing[]>();
const pending = new Map<string, readonly Drawing[]>();
let db: IDBDatabase | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

function parseList(raw: string | null): Drawing[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as Drawing[]) : [];
  } catch {
    return [];
  }
}

/** Drawings kept in localStorage (by older versions, or as the fallback), by symbol key. */
function localStorageDrawings(): Map<string, Drawing[]> {
  const out = new Map<string, Drawing[]>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const key = k.startsWith(DRAWINGS_PREFIX) ? k.slice(DRAWINGS_PREFIX.length) : k.startsWith(OLD_PREFIX) ? k.slice(OLD_PREFIX.length) : null;
      if (key !== null && (k.startsWith(DRAWINGS_PREFIX) || !out.has(key))) out.set(key, parseList(localStorage.getItem(k)));
    }
  } catch {
    /* no localStorage */
  }
  return out;
}

/** Opens the drawing store and reads it into memory. Call (and wait) once before drawing. */
export async function initDrawingStorage(): Promise<void> {
  const legacy = localStorageDrawings();
  try {
    db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    keys.forEach((k, i) => cache.set(String(k), values[i] as Drawing[]));
  } catch {
    db = null;
  }
  if (!db) {
    for (const [key, list] of legacy) cache.set(key, list);
    return;
  }
  // Move drawings from localStorage (older versions) into IndexedDB, once.
  if (legacy.size > 0) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      for (const [key, list] of legacy) {
        if (cache.has(key) || list.length === 0) continue;
        tx.objectStore(STORE).put(list, key);
        cache.set(key, list);
      }
      await done(tx);
      for (const key of legacy.keys()) {
        localStorage.removeItem(DRAWINGS_PREFIX + key);
        localStorage.removeItem(OLD_PREFIX + key);
      }
    } catch {
      for (const [key, list] of legacy) if (!cache.has(key)) cache.set(key, list);
    }
  }
}

export function loadDrawings(key: string): Drawing[] {
  return [...(cache.get(key) ?? [])];
}

export function saveDrawings(key: string, drawings: readonly Drawing[]): void {
  cache.set(key, drawings);
  pending.set(key, drawings);
  clearTimeout(timer);
  timer = setTimeout(flushDrawings, 250);
}

/** Writes pending changes now. Resolves when they are stored. */
export function flushDrawings(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (pending.size === 0) return Promise.resolve();
  const batch = [...pending];
  pending.clear();
  if (!db) {
    for (const [key, list] of batch) {
      try {
        if (list.length === 0) localStorage.removeItem(DRAWINGS_PREFIX + key);
        else localStorage.setItem(DRAWINGS_PREFIX + key, JSON.stringify(list));
      } catch {
        /* full or unavailable */
      }
    }
    return Promise.resolve();
  }
  const tx = db.transaction(STORE, 'readwrite');
  for (const [key, list] of batch) {
    if (list.length === 0) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(list, key);
  }
  return done(tx).catch(() => {
    // Keep them so the next change tries again.
    for (const [key, list] of batch) if (!pending.has(key)) pending.set(key, list);
  });
}

/** Every symbol's drawings (for a backup). */
export function allDrawings(): ReadonlyMap<string, readonly Drawing[]> {
  return cache;
}

/** Replaces the drawings of the given symbols (from a backup) and stores them. */
export async function replaceDrawings(entries: ReadonlyMap<string, readonly Drawing[]>): Promise<void> {
  for (const [key, list] of entries) {
    cache.set(key, list);
    pending.set(key, list);
  }
  await flushDrawings();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushDrawings());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushDrawings();
  });
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

// --- named templates per tool ---------------------------------------------------

const TEMPLATES_KEY = 'chartdesk:templates';

export function loadTemplates(): Partial<Record<DrawingType, DrawingTemplate[]>> {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<DrawingType, DrawingTemplate[]>>) : {};
  } catch {
    return {};
  }
}

export function saveTemplates(templates: Partial<Record<DrawingType, DrawingTemplate[]>>): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    /* ignore */
  }
}
