// How a fired alert reaches the user: a sound, a browser notification (if allowed)
// and a toast that stays on screen until dismissed.

let audio: AudioContext | null = null;

/**
 * Browsers only allow sound after the user has interacted with the page,
 * so the audio context is created on the first click or key press.
 */
export function unlockAudioOnFirstInteraction(): void {
  const unlock = () => {
    try {
      audio ??= new AudioContext();
      void audio.resume();
    } catch {
      /* no audio available */
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Three short rising beeps. */
export function playAlertSound(): void {
  if (!audio) return;
  const start = audio.currentTime + 0.02;
  [880, 1046.5, 1318.5].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Asks for permission if it hasn't been decided yet. Must be called from a click. */
export async function requestNotificationPermission(): Promise<void> {
  if (notificationsSupported() && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
}

export function showBrowserNotification(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: `chartdesk-${title}`, requireInteraction: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/** An in-app toast that stays until the user closes it. */
export function showToast(title: string, body: string): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.append(host);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('div');
  p.textContent = body;
  text.append(strong, p);
  const close = document.createElement('button');
  close.className = 'icon';
  close.title = 'Dismiss';
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(text, close);
  host.append(toast);
}

/** Flashes the tab title until the tab is focused again. */
export function flashTitle(message: string): void {
  const original = document.title.replace(/^\(!\) .*? · /, '');
  let on = true;
  const timer = setInterval(() => {
    document.title = on ? `(!) ${message} · ${original}` : original;
    on = !on;
  }, 1000);
  const stop = () => {
    clearInterval(timer);
    document.title = original;
    window.removeEventListener('focus', stop);
    document.removeEventListener('visibilitychange', onVisible);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') stop();
  };
  window.addEventListener('focus', stop);
  document.addEventListener('visibilitychange', onVisible);
  if (document.hasFocus()) setTimeout(stop, 4000);
}
