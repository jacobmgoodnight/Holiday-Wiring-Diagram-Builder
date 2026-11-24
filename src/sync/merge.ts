/**
 * Merging plans between devices (pure). The cloud copy holds every display with a hash of its
 * content, plus tombstones for deleted ones. Each device remembers the hashes it last synced
 * (the "base"), so it can tell what changed where:
 * - changed on one side only: that side wins;
 * - changed on both: the newer edit wins, and the other is kept as a restore point here, so
 *   nothing is lost;
 * - deleted on one side: followed, unless the other side changed it since (then it stays).
 */
import type { StoredDisplay } from '../store/db';

export interface SyncDisplay {
  rec: StoredDisplay;
  hash: string;
}

export interface SyncDoc {
  v: 1;
  displays: Record<string, SyncDisplay>;
  /** Deleted display id → when. */
  deleted: Record<string, number>;
}

/** What each display was at this device's last sync. */
export interface SyncBase {
  hashes: Record<string, string>;
}

export interface MergeResult {
  /** The new cloud copy. */
  doc: SyncDoc;
  /** Versions from the other device to save here. */
  save: StoredDisplay[];
  /** Displays deleted on the other device, to delete here. */
  remove: string[];
  /** Losers of a both-sides edit, kept here as restore points. */
  keep: { rec: StoredDisplay; from: 'this device' | 'other device' }[];
  /** The cloud copy needs writing. */
  changedCloud: boolean;
  base: SyncBase;
}

/** A short hash of what matters in a display (not when it was saved). */
export function displayHash(rec: Pick<StoredDisplay, 'title' | 'text' | 'display' | 'lineNodeIds'>): string {
  const s = JSON.stringify([rec.title, rec.text, rec.display, rec.lineNodeIds]);
  // cyrb53: fast and plenty for telling versions apart.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const YEAR = 365 * 24 * 60 * 60 * 1000;

export function mergeSync(local: StoredDisplay[], remote: SyncDoc | undefined, base: SyncBase, now: number): MergeResult {
  const L = new Map(local.map((rec) => [rec.id, { rec, hash: displayHash(rec) }]));
  const R = remote?.displays ?? {};
  const deleted = { ...(remote?.deleted ?? {}) };
  const out: Record<string, SyncDisplay> = {};
  const save: StoredDisplay[] = [];
  const remove: string[] = [];
  const keep: MergeResult['keep'] = [];
  const ids = new Set([...L.keys(), ...Object.keys(R), ...Object.keys(base.hashes)]);
  for (const id of ids) {
    const l = L.get(id);
    const r = R[id];
    const b = base.hashes[id];
    if (l && r) {
      if (l.hash === r.hash) {
        out[id] = l;
        continue;
      }
      const localChanged = l.hash !== b;
      const remoteChanged = r.hash !== b;
      if (localChanged && !remoteChanged) out[id] = l;
      else if (!localChanged && remoteChanged) {
        out[id] = r;
        save.push(r.rec);
      } else if (l.rec.updatedAt >= r.rec.updatedAt) {
        out[id] = l;
        keep.push({ rec: r.rec, from: 'other device' });
      } else {
        out[id] = r;
        save.push(r.rec);
        keep.push({ rec: l.rec, from: 'this device' });
      }
    } else if (l) {
      if (deleted[id] !== undefined && b !== undefined && l.hash === b) {
        remove.push(id); // deleted there, unchanged here
        continue;
      }
      delete deleted[id]; // new here, or changed here since it was deleted there
      out[id] = l;
    } else if (r) {
      if (b !== undefined && r.hash === b) {
        deleted[id] = now; // deleted here, unchanged there
        continue;
      }
      out[id] = r; // new there, or changed there since it was deleted here
      save.push(r.rec);
    }
  }
  for (const [id, at] of Object.entries(deleted)) if (now - at > YEAR || out[id]) delete deleted[id];
  const doc: SyncDoc = { v: 1, displays: out, deleted };
  const sameDisplays =
    !!remote && Object.keys(out).length === Object.keys(R).length && Object.entries(out).every(([id, d]) => R[id]?.hash === d.hash);
  const sameDeleted = !!remote && JSON.stringify(Object.keys(deleted).sort()) === JSON.stringify(Object.keys(remote.deleted ?? {}).sort());
  return {
    doc,
    save,
    remove,
    keep,
    changedCloud: !(sameDisplays && sameDeleted),
    base: { hashes: Object.fromEntries(Object.entries(out).map(([id, d]) => [id, d.hash])) },
  };
}

/** Photo ids the displays in a cloud copy use. */
export function photoIdsOf(doc: SyncDoc): Set<string> {
  const ids = new Set<string>();
  for (const d of Object.values(doc.displays)) for (const v of d.rec.display.views ?? []) ids.add(v.photoId);
  return ids;
}
