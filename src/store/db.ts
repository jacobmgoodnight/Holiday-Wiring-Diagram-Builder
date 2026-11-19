/**
 * Local storage (IndexedDB via Dexie). Everything stays in this browser; JSON export is the
 * backup (Phase 5). Writes go through one queue so a slow write can never land after a newer one.
 */
import Dexie, { type Table } from 'dexie';
import type { Display } from '../model/types';

export interface StoredDisplay {
  id: string;
  title: string;
  season: Display['season'];
  year?: number;
  /** Outline text as last edited. */
  text: string;
  /** Model as last built (holds fields the outline cannot express). */
  display: Display;
  /** Line → node id map for `text`, so IDs stay stable across reloads. */
  lineNodeIds: (string | null)[];
  updatedAt: number;
  schema: 1;
}

export interface Meta {
  key: string;
  value: unknown;
}

class SketchpadDb extends Dexie {
  displays!: Table<StoredDisplay, string>;
  meta!: Table<Meta, string>;
  constructor() {
    super('wiring-sketchpad');
    this.version(1).stores({ displays: 'id, updatedAt', meta: 'key' });
  }
}

let db: SketchpadDb | null = null;
function getDb(): SketchpadDb {
  db ??= new SketchpadDb();
  return db;
}

export function toStored(text: string, display: Display, lineNodeIds: (string | undefined)[], now = Date.now()): StoredDisplay {
  return {
    id: display.id,
    title: display.title,
    season: display.season,
    year: display.year,
    text,
    display,
    lineNodeIds: lineNodeIds.map((x) => x ?? null),
    updatedAt: now,
    schema: 1,
  };
}

export function lineIdsFromStored(rec: StoredDisplay): (string | undefined)[] {
  return rec.lineNodeIds.map((x) => x ?? undefined);
}

export async function listDisplays(): Promise<Pick<StoredDisplay, 'id' | 'title' | 'season' | 'year' | 'updatedAt'>[]> {
  const all = await getDb().displays.orderBy('updatedAt').reverse().toArray();
  return all.map(({ id, title, season, year, updatedAt }) => ({ id, title, season, year, updatedAt }));
}

export function getDisplay(id: string): Promise<StoredDisplay | undefined> {
  return getDb().displays.get(id);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDb().meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await getDb().meta.put({ key, value });
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized write. Resolves when this write (and all earlier ones) finished. */
export function saveDisplay(rec: StoredDisplay): Promise<void> {
  const run = queue.then(() => getDb().displays.put(rec)).then(() => undefined);
  queue = run.catch(() => undefined);
  return run;
}

export function deleteDisplay(id: string): Promise<void> {
  const run = queue.then(() => getDb().displays.delete(id));
  queue = run.catch(() => undefined);
  return run;
}

/** True when IndexedDB can be opened (false in some private-browsing modes). */
export async function storageAvailable(): Promise<boolean> {
  try {
    await getDb().open();
    return true;
  } catch {
    return false;
  }
}
