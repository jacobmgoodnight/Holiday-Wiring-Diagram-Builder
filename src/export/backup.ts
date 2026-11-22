/**
 * JSON backup: every display with its outline and model. Import never overwrites: a display
 * whose ID already exists here comes in as a separate copy.
 */
import type { Display } from '../model/types';
import type { StoredDisplay } from '../store/db';

export const BACKUP_FORMAT = 'wiring-sketchpad-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  displays: StoredDisplay[];
}

export class BackupError extends Error {}

export function makeBackup(displays: StoredDisplay[], now = new Date()): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), displays };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function checkDisplay(d: unknown, i: number): asserts d is StoredDisplay {
  const where = `display ${i + 1}`;
  if (!isObj(d)) throw new BackupError(`${where} is not an object`);
  if (typeof d.id !== 'string' || !d.id) throw new BackupError(`${where} has no id`);
  if (typeof d.text !== 'string') throw new BackupError(`${where} has no outline text`);
  if (!isObj(d.display)) throw new BackupError(`${where} has no model`);
  const m = d.display as Record<string, unknown>;
  if (!isObj(m.nodes) || !Array.isArray(m.links) || !Array.isArray(m.comments)) throw new BackupError(`${where} has a damaged model`);
  for (const [id, n] of Object.entries(m.nodes)) {
    if (!isObj(n) || n.id !== id || typeof n.label !== 'string' || typeof n.kind !== 'string' || !Array.isArray(n.tags)) {
      throw new BackupError(`${where}: item ${id} is damaged`);
    }
  }
  if (!Array.isArray(d.lineNodeIds)) throw new BackupError(`${where} has no line map`);
}

/** Parse and validate a backup file's text. Throws BackupError with a readable reason. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not JSON.');
  }
  if (!isObj(data) || data.format !== BACKUP_FORMAT) throw new BackupError('This is not a Wiring Sketchpad backup.');
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of the app.');
  }
  if (!Array.isArray(data.displays)) throw new BackupError('The backup has no displays.');
  data.displays.forEach(checkDisplay);
  return data as unknown as Backup;
}

/**
 * Prepare displays for import. Ones whose ID already exists get a new ID and "(imported)"
 * added to their title, so nothing on this device is overwritten.
 */
export function planImport(existingIds: Set<string>, incoming: StoredDisplay[], newId: () => string, now = Date.now()): StoredDisplay[] {
  const taken = new Set(existingIds);
  return incoming.map((rec) => {
    if (!taken.has(rec.id)) {
      taken.add(rec.id);
      return { ...rec, updatedAt: now };
    }
    const id = newId();
    taken.add(id);
    const title = `${rec.title} (imported)`;
    const display: Display = { ...rec.display, id, title };
    // Keep the title line in the outline in step with the new title.
    const text = rec.text.replace(/^(#\s*)(.*)$/m, (_m, hash: string) => `${hash}${title}`);
    const heading = display.comments.find((c) => c.parent === null && !c.raw && c.text.startsWith('#'));
    if (heading) display.comments = display.comments.map((c) => (c === heading ? { ...c, text: `# ${title}` } : c));
    return { ...rec, id, title, display, text, updatedAt: now };
  });
}
