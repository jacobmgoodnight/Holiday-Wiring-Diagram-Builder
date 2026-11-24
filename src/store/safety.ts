/**
 * Keeping plans safe between seasons (pure, plus small browser helpers). Everything lives in
 * this browser, and browsers can clear a website's data: Safari after 7 days of use without
 * visiting the site, unless it is on the Home Screen. So: ask for persistent storage, tell
 * iPhone users about the Home Screen once, and nudge for a backup when there is none recent.
 */
const KEY = 'wiring-sketchpad.safety';
const DAY = 24 * 60 * 60 * 1000;

export interface SafetyState {
  /** Last JSON backup downloaded on this device. */
  lastBackupAt?: number;
  /** Edits since then (or ever). */
  editsSinceBackup: number;
  firstEditAt?: number;
  /** "Later" on the backup reminder. */
  snoozeUntil?: number;
  /** The iPhone Home Screen tip was shown and dismissed. */
  iosTipDone?: boolean;
}

export function readSafety(): SafetyState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SafetyState>;
    return { editsSinceBackup: 0, ...raw };
  } catch {
    return { editsSinceBackup: 0 };
  }
}

export function writeSafety(s: SafetyState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: reminders reset next visit, which is harmless
  }
}

export const noteEdit = (s: SafetyState, now: number): SafetyState => ({ ...s, editsSinceBackup: s.editsSinceBackup + 1, firstEditAt: s.firstEditAt ?? now });
export const noteBackup = (s: SafetyState, now: number): SafetyState => ({ ...s, lastBackupAt: now, editsSinceBackup: 0, snoozeUntil: undefined });
export const snoozeBackup = (s: SafetyState, now: number): SafetyState => ({ ...s, snoozeUntil: now + 7 * DAY });

/**
 * Time to suggest a backup: a real amount of work (40 edits) never backed up, or 25 edits
 * since a backup that is two weeks old. Not while snoozed.
 */
export function shouldNudgeBackup(s: SafetyState, now: number): boolean {
  if (s.snoozeUntil && now < s.snoozeUntil) return false;
  if (s.lastBackupAt === undefined) return s.editsSinceBackup >= 40;
  return s.editsSinceBackup >= 25 && now - s.lastBackupAt >= 14 * DAY;
}

/** The iPhone tip: Safari on iOS/iPadOS in a tab (not from the Home Screen), after some work. */
export function shouldShowIosTip(s: SafetyState, iosTab: boolean): boolean {
  return iosTab && !s.iosTipDone && s.editsSinceBackup + (s.lastBackupAt ? 5 : 0) >= 5;
}

/** Safari on iPhone or iPad, in a browser tab rather than the Home Screen app. */
export function isIosBrowserTab(nav: Navigator = navigator, standalone = matchMedia?.('(display-mode: standalone)').matches): boolean {
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return ios && !standalone && (nav as Navigator & { standalone?: boolean }).standalone !== true;
}

/** Ask the browser to keep this site's data (no-op where unsupported). True when it will. */
export async function keepStorage(): Promise<boolean | undefined> {
  try {
    const st = navigator.storage;
    if (!st?.persist) return undefined;
    if (await st.persisted()) return true;
    return await st.persist();
  } catch {
    return undefined;
  }
}
