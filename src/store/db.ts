/**
 * Local storage (IndexedDB via Dexie). Everything stays in this browser; JSON export is the
 * backup (Phase 5). Writes go through one queue so a slow write can never land after a newer one.
 */
import Dexie, { type Table } from 'dexie';
import { snapshotsToPrune } from '../model/season';
import type { Display } from '../model/types';
import type { Preset } from '../presets/presets';

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

/** A restore point: a complete local copy of one display at a moment. */
export interface Snapshot {
  id?: number;
  displayId: string;
  at: number;
  reason: 'auto' | 'manual' | 'before-restore';
  title: string;
  itemCount: number;
  text: string;
  display: Display;
  lineNodeIds: (string | null)[];
}

export interface Meta {
  key: string;
  value: unknown;
}

class SketchpadDb extends Dexie {
  displays!: Table<StoredDisplay, string>;
  meta!: Table<Meta, string>;
  snapshots!: Table<Snapshot, number>;
  presets!: Table<Preset & { createdAt: number }, string>;
  constructor() {
    super('wiring-sketchpad');
    this.version(1).stores({ displays: 'id, updatedAt', meta: 'key' });
    // v2 adds restore points; existing displays are untouched.
    this.version(2).stores({ displays: 'id, updatedAt', meta: 'key', snapshots: '++id, displayId, at' });
    // v3 adds your own presets ("Save as preset").
    this.version(3).stores({ displays: 'id, updatedAt', meta: 'key', snapshots: '++id, displayId, at', presets: 'id, createdAt' });
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

export function addSnapshot(snap: Omit<Snapshot, 'id'>): Promise<void> {
  const run = queue.then(async () => {
    const db = getDb();
    await db.snapshots.add(snap as Snapshot);
    const all = await db.snapshots.where('displayId').equals(snap.displayId).toArray();
    const prune = snapshotsToPrune(all.map((s) => ({ id: s.id!, at: s.at, reason: s.reason })));
    if (prune.length) await db.snapshots.bulkDelete(prune);
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listSnapshots(displayId: string): Promise<Snapshot[]> {
  const all = await getDb().snapshots.where('displayId').equals(displayId).toArray();
  return all.sort((a, b) => b.at - a.at);
}

export async function listCustomPresets(): Promise<Preset[]> {
  const all = await getDb().presets.orderBy('createdAt').toArray();
  return all.map(({ createdAt: _c, ...p }) => ({ ...p, custom: true }));
}

export async function saveCustomPreset(p: Preset): Promise<void> {
  await getDb().presets.put({ ...p, custom: true, createdAt: Date.now() });
}

export async function deleteCustomPreset(id: string): Promise<void> {
  await getDb().presets.delete(id);
}

/** Every saved display, for a full backup. */
export async function allDisplays(): Promise<StoredDisplay[]> {
  return getDb().displays.orderBy('updatedAt').reverse().toArray();
}

export function deleteDisplay(id: string): Promise<void> {
  const run = queue.then(async () => {
    await getDb().displays.delete(id);
    await getDb().snapshots.where('displayId').equals(id).delete();
  });
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
