/**
 * What changes when ChartDesk runs as the desktop app (Tauri) instead of in a browser.
 *
 * The Tauri code is loaded only in the desktop app (dynamic import), so the web version
 * doesn't carry it.
 */

/** True inside the desktop app. */
export const IS_DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Saves a file: a "Save as" dialog in the desktop app, a download in the browser.
 * Resolves false when the person cancels the dialog.
 */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  if (IS_DESKTOP) {
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Header values must be plain ASCII.
    const name = filename.replace(/[^\x20-\x7e]/g, '_');
    return invoke<boolean>('save_file', bytes, { headers: { 'x-file-name': name } });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** The desktop window's own full screen (the web page's full screen doesn't apply there). */
export const desktopWindow = {
  async isFullscreen(): Promise<boolean> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().isFullscreen();
  },
  async setFullscreen(on: boolean): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
  },
  async onResized(fn: () => void): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().onResized(fn);
  },
};

/**
 * Links that would open a new browser tab (target="_blank") open in the person's own browser
 * instead: the desktop window has no tabs.
 */
export function openLinksInBrowser(): void {
  if (!IS_DESKTOP) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (!a || !/^https?:/.test(a.href)) return;
    e.preventDefault();
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(a.href));
  });
}

/** What the cTrader source needs from the desktop app: the app credentials and the browser sign-in. */
export const desktopCTrader = {
  async app(): Promise<{ clientId: string; clientSecret: string } | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('ctrader_app');
  },
  async login(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('ctrader_login');
  },
};
