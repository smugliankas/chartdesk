/**
 * Backup of everything ChartDesk keeps in the browser: drawings, alerts, watchlist,
 * drawing styles and settings. Exported as one JSON file and restored from it.
 */

import type { Drawing } from './drawings/model';
import { formatDateTime } from './format';
import { allDrawings, DRAWINGS_PREFIX, flushDrawings, replaceDrawings } from './drawings/storage';
import { confirmDialog } from './ui/confirmDialog';

const PREFIX = 'chartdesk:';
/** Keys from before the project was named ChartDesk. */
const OLD_PREFIX = 'chart-app:';
const FORMAT = 'chartdesk-backup';

export interface Backup {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  /** localStorage entries, key → raw (JSON) string. */
  data: Record<string, string>;
}

export interface BackupSummary {
  /** Symbols with drawings, e.g. "binance:BTCUSDT". */
  drawingSymbols: string[];
  drawings: number;
  alerts: number;
  hasSettings: boolean;
}

/**
 * Collects the stored data: settings and alerts from `storage`, drawings from `drawings`
 * (kept in IndexedDB). Takes both as arguments, so it can be tested.
 */
export function collectBackup(
  storage: Storage = localStorage,
  now = new Date(),
  drawings: ReadonlyMap<string, readonly Drawing[]> = new Map(),
): Backup {
  const data: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    if (key.startsWith(PREFIX)) data[key] = value;
    else if (key.startsWith(OLD_PREFIX)) {
      // Not yet moved to the new name: export it under the new one, unless that exists.
      const renamed = PREFIX + key.slice(OLD_PREFIX.length);
      if (storage.getItem(renamed) === null) data[renamed] = value;
    }
  }
  for (const [key, list] of drawings) {
    if (list.length > 0) data[DRAWINGS_PREFIX + key] = JSON.stringify(list);
  }
  return { format: FORMAT, version: 1, exportedAt: now.toISOString(), data };
}

/** Reads a backup file's text. Throws a readable error for anything that isn't one. */
export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a ChartDesk backup file.');
  }
  const b = parsed as Partial<Backup> | null;
  if (!b || b.format !== FORMAT || typeof b.data !== 'object' || b.data === null) {
    throw new Error('This is not a ChartDesk backup file.');
  }
  if (b.version !== 1) throw new Error('This backup was made by a newer version of ChartDesk.');
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(b.data)) {
    // Only our own keys, and only text: a backup can't write anything else.
    if (key.startsWith(PREFIX) && typeof value === 'string') data[key] = value;
  }
  return { format: FORMAT, version: 1, exportedAt: String(b.exportedAt ?? ''), data };
}

export function summarize(backup: Backup): BackupSummary {
  const drawingSymbols: string[] = [];
  let drawings = 0;
  let alerts = 0;
  for (const [key, value] of Object.entries(backup.data)) {
    if (key.startsWith(`${PREFIX}drawings:`)) {
      drawingSymbols.push(key.slice(`${PREFIX}drawings:`.length));
      drawings += countArray(value);
    } else if (key === `${PREFIX}alerts`) alerts = countArray(value);
  }
  return {
    drawingSymbols: drawingSymbols.sort(),
    drawings,
    alerts,
    hasSettings: `${PREFIX}settings` in backup.data || `${PREFIX}appearance` in backup.data,
  };
}

/**
 * Writes a backup's settings, alerts and watchlist into `storage` and returns its drawings
 * by symbol, for the drawing store. Drawings of symbols that are not in the backup are kept;
 * everything in the backup replaces what is there.
 */
export function restoreBackup(backup: Backup, storage: Storage = localStorage): Map<string, Drawing[]> {
  const drawings = new Map<string, Drawing[]>();
  for (const [key, value] of Object.entries(backup.data)) {
    if (key.startsWith(DRAWINGS_PREFIX)) {
      try {
        const list: unknown = JSON.parse(value);
        if (Array.isArray(list)) drawings.set(key.slice(DRAWINGS_PREFIX.length), list as Drawing[]);
      } catch {
        /* skip a broken entry */
      }
    } else storage.setItem(key, value);
  }
  return drawings;
}

function countArray(raw: string): number {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

// --- browser side -------------------------------------------------------------

/** Downloads the backup as chartdesk-backup-YYYY-MM-DD.json. */
export async function downloadBackup(): Promise<BackupSummary> {
  await flushDrawings();
  const backup = collectBackup(localStorage, new Date(), allDrawings());
  const day = backup.exportedAt.slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `chartdesk-backup-${day}.json`);
  return summarize(backup);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Lets the user pick a backup file and restores it after asking. Reloads the page when done. */
export function chooseAndRestoreBackup(onError: (message: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const s = summarize(backup);
      const parts = [
        `${s.drawings} drawing${s.drawings === 1 ? '' : 's'} on ${s.drawingSymbols.length} symbol${s.drawingSymbols.length === 1 ? '' : 's'}`,
        `${s.alerts} alert${s.alerts === 1 ? '' : 's'}`,
      ];
      if (s.hasSettings) parts.push('settings');
      const date = backup.exportedAt ? ` from ${formatDateTime(Date.parse(backup.exportedAt) / 1000)}` : '';
      const ok = await confirmDialog({
        title: `Restore this backup${date}?`,
        message:
          `It has ${parts.join(', ')}.\n\n` +
          'Drawings on these symbols, your alerts, watchlist and settings will be replaced by the ones in the backup. ' +
          'Drawings on other symbols are kept.',
        confirmLabel: 'Restore',
        danger: true,
      });
      if (!ok) return;
      await replaceDrawings(restoreBackup(backup));
      location.reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  });
  input.click();
}
