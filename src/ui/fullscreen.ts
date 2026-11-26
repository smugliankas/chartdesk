import { desktopWindow, IS_DESKTOP } from '../desktop';
import { IS_MAC } from '../platform';
import { ICONS } from './tools';

/** Keyboard Lock API (Chrome, Edge, Opera): lets the page receive Esc while in full screen. */
interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as WebkitDocument;

export const FULLSCREEN_KEYS = IS_MAC ? '⇧F' : 'Shift+F';
export const AUTO_SCALE_KEYS = IS_MAC ? '⇧A' : 'Shift+A';

function fullscreenElement(): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Full-screen mode, like TradingView's: a button in the top bar and Shift + F.
 *
 * Esc first cancels whatever is going on (a drawing in progress, a selection, a menu); only
 * when there is nothing left to cancel does it leave full screen. Browsers normally keep Esc
 * for themselves in full screen, so where the Keyboard Lock API exists (Chrome, Edge) we ask
 * for Esc; holding Esc still exits there. Elsewhere (Safari, Firefox) Esc always exits, which
 * the browser decides.
 */
export function setupFullscreen(button: HTMLButtonElement, canEscape: () => boolean): { toggle: () => void } {
  if (IS_DESKTOP) return setupDesktopFullscreen(button, canEscape);
  const root = document.documentElement as WebkitElement;
  const supported = !!(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  let escLocked = false;

  if (!supported) {
    button.classList.add('hidden');
    return { toggle: () => {} };
  }

  const enter = async () => {
    try {
      await (root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.());
    } catch {
      return;
    }
    if (keyboard?.lock) {
      try {
        await keyboard.lock(['Escape']);
        escLocked = true;
      } catch {
        escLocked = false;
      }
    }
  };

  const exit = () => {
    void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
  };

  const toggle = () => (fullscreenElement() ? exit() : void enter());

  const sync = () => {
    const on = !!fullscreenElement();
    if (!on && escLocked) {
      keyboard?.unlock();
      escLocked = false;
    }
    button.innerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen;
    button.dataset.tip = on ? `Exit full screen (${FULLSCREEN_KEYS}, Esc)` : `Full screen (${FULLSCREEN_KEYS})`;
    button.removeAttribute('title');
    button.classList.toggle('active', on);
  };

  button.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  // Capture phase: decide before the other Esc handlers cancel things, then leave full screen
  // only if there was nothing to cancel.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !escLocked || !fullscreenElement()) return;
      if (!canEscape()) setTimeout(exit, 0);
    },
    true,
  );

  sync();
  return { toggle };
}

function showState(button: HTMLButtonElement, on: boolean): void {
  button.innerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen;
  button.dataset.tip = on ? `Exit full screen (${FULLSCREEN_KEYS}, Esc)` : `Full screen (${FULLSCREEN_KEYS})`;
  button.removeAttribute('title');
  button.classList.toggle('active', on);
}

/**
 * The desktop app: the window itself goes full screen. Esc works as in the browser version:
 * it cancels what is going on first, and leaves full screen only when there is nothing left.
 */
function setupDesktopFullscreen(button: HTMLButtonElement, canEscape: () => boolean): { toggle: () => void } {
  let on = false;
  const sync = async () => {
    on = await desktopWindow.isFullscreen();
    showState(button, on);
  };
  const set = async (want: boolean) => {
    await desktopWindow.setFullscreen(want);
    await sync();
  };
  const toggle = () => void set(!on);

  button.addEventListener('click', toggle);
  // Also catches the window's own full-screen button (the green one on a Mac).
  void desktopWindow.onResized(() => void sync());
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && on && !canEscape()) void set(false);
    },
    true,
  );
  showState(button, false);
  void sync();
  return { toggle };
}
