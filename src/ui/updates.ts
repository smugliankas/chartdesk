import { desktopUpdater, IS_DESKTOP, type AvailableUpdate } from '../desktop';

/** How often the desktop app looks for a newer version while it stays open. */
const CHECK_EVERY_MS = 6 * 3600_000;
/** The first look waits a little, so it doesn't slow the start. */
const FIRST_CHECK_MS = 4000;

/**
 * Updates in the desktop app: a quiet look on GitHub at start and every few hours; when there
 * is a newer version, a small card offers to install it ("Update and restart") or wait
 * ("Later", until the next start). The settings dialog gets a section with the version and a
 * "Check for updates" button. Does nothing in the browser.
 *
 * Returns that settings section, or null in the browser.
 */
export function setupUpdates(): HTMLElement | null {
  if (!IS_DESKTOP) return null;

  let found: AvailableUpdate | null = null;
  let dismissed: string | null = null;
  let installing = false;

  // --- the card ----------------------------------------------------------------------
  const card = document.createElement('div');
  card.className = 'update-card hidden';
  card.setAttribute('role', 'status');
  card.innerHTML = `
    <div class="update-text">
      <strong class="update-title"></strong>
      <span class="update-detail"></span>
    </div>
    <div class="update-bar hidden"><span></span></div>
    <div class="update-actions">
      <button type="button" class="update-later">Later</button>
      <button type="button" class="update-now confirm-primary">Update and restart</button>
    </div>`;
  document.body.append(card);
  const title = card.querySelector<HTMLElement>('.update-title')!;
  const detail = card.querySelector<HTMLElement>('.update-detail')!;
  const bar = card.querySelector<HTMLElement>('.update-bar')!;
  const fill = bar.querySelector<HTMLElement>('span')!;
  const later = card.querySelector<HTMLButtonElement>('.update-later')!;
  const now = card.querySelector<HTMLButtonElement>('.update-now')!;

  const showCard = (u: AvailableUpdate) => {
    title.textContent = `ChartDesk ${u.version} is available`;
    detail.textContent = `You have ${u.current}. The update takes a few seconds; your drawings and settings stay.`;
    bar.classList.add('hidden');
    later.disabled = false;
    now.disabled = false;
    now.textContent = 'Update and restart';
    card.classList.remove('hidden');
  };

  later.addEventListener('click', () => {
    dismissed = found?.version ?? null;
    card.classList.add('hidden');
  });

  now.addEventListener('click', () => void install());

  async function install(): Promise<void> {
    if (!found || installing) return;
    installing = true;
    later.disabled = true;
    now.disabled = true;
    now.textContent = 'Updating…';
    detail.textContent = 'Downloading…';
    bar.classList.remove('hidden');
    fill.style.width = '0%';
    try {
      await desktopUpdater.install((percent) => {
        fill.style.width = `${percent}%`;
        detail.textContent = percent >= 100 ? 'Installing… ChartDesk will start again.' : `Downloading… ${percent}%`;
      });
    } catch (e) {
      // The check that found it may be stale (e.g. after a long sleep): look again, then offer a retry.
      installing = false;
      detail.textContent = e instanceof Error ? e.message : String(e);
      bar.classList.add('hidden');
      later.disabled = false;
      now.disabled = false;
      now.textContent = 'Try again';
      found = await desktopUpdater.check().catch(() => found);
    }
  }

  // --- checking ----------------------------------------------------------------------
  /** Looks for an update. `manual`: the person asked, so say what came of it. */
  async function check(manual: boolean): Promise<void> {
    if (installing) return;
    if (manual) setSectionStatus('Checking…');
    try {
      found = await desktopUpdater.check();
    } catch (e) {
      // A quiet check that fails (offline, GitHub down) just waits for the next one.
      if (manual) setSectionStatus(e instanceof Error ? e.message : String(e), true);
      return;
    }
    if (!found) {
      if (manual) setSectionStatus('ChartDesk is up to date.');
      return;
    }
    if (manual) setSectionStatus(`Version ${found.version} is available.`);
    if (manual || dismissed !== found.version) showCard(found);
  }

  setTimeout(() => void check(false), FIRST_CHECK_MS);
  setInterval(() => void check(false), CHECK_EVERY_MS);

  // --- the settings section ------------------------------------------------------------
  const section = document.createElement('div');
  section.innerHTML = `
    <h3>Updates</h3>
    <div class="settings-row">
      <span class="update-version">ChartDesk</span>
      <button type="button" class="update-check">Check for updates</button>
    </div>
    <p class="hint update-status">ChartDesk looks for updates when it starts and installs them when you say so.</p>`;
  const version = section.querySelector<HTMLElement>('.update-version')!;
  const status = section.querySelector<HTMLElement>('.update-status')!;
  section.querySelector('.update-check')!.addEventListener('click', () => void check(true));
  void desktopUpdater.version().then((v) => (version.textContent = `ChartDesk ${v}`));

  function setSectionStatus(text: string, error = false): void {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  return section;
}
