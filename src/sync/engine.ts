/**
 * One sync run: pull the cloud copy, merge it with the plans here, write the merged copy back
 * (encrypted), then apply the other device's changes here and swap photos. If another device
 * wrote in between, it merges again.
 */
import { addSnapshot, allDisplays, allPhotos, deleteDisplay, getMeta, getPhoto, savePhoto, saveDisplay, setMeta, type StoredDisplay } from '../store/db';
import { type SyncApi, syncApi } from './api';
import { type SyncKeys, deriveKeys, open, openJson, seal, sealJson } from './crypto';
import { type SyncBase, type SyncDoc, mergeSync, photoIdsOf } from './merge';

export interface SyncState {
  code: string;
  base: SyncBase;
  lastSyncAt?: number;
}

const META = 'sync';
export const readSyncState = () => getMeta<SyncState | null>(META).then((s) => s ?? undefined);
export const writeSyncState = (s: SyncState | undefined) => setMeta(META, s ?? null);

export interface SyncOutcome {
  state: SyncState;
  /** Displays changed or added here by the other device. */
  saved: string[];
  /** Displays deleted here because the other device deleted them. */
  removed: string[];
  /** Both-sides edits kept as restore points. */
  kept: number;
  photosUp: number;
  photosDown: number;
}

let keyCache: { code: string; keys: Promise<SyncKeys> } | undefined;
const keysFor = (code: string) => {
  if (keyCache?.code !== code) keyCache = { code, keys: deriveKeys(code) };
  return keyCache.keys;
};

/** A photo travels as a small header (type, size) followed by its bytes. */
async function packPhoto(p: { blob: Blob; width: number; height: number }): Promise<Uint8Array<ArrayBuffer>> {
  const head = new TextEncoder().encode(JSON.stringify({ type: p.blob.type || 'image/jpeg', width: p.width, height: p.height }));
  const body = new Uint8Array(await p.blob.arrayBuffer());
  const out = new Uint8Array(4 + head.length + body.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(body, 4 + head.length);
  return out;
}
function unpackPhoto(bytes: Uint8Array<ArrayBuffer>): { blob: Blob; width: number; height: number } {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n))) as { type: string; width: number; height: number };
  return { blob: new Blob([bytes.subarray(4 + n)], { type: head.type }), width: head.width, height: head.height };
}

export async function runSync(state: SyncState, api: SyncApi = syncApi(), now = Date.now()): Promise<SyncOutcome> {
  const keys = await keysFor(state.code);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await api.pull(keys.lookup);
    const remote = row ? await openJson<SyncDoc>(keys, row.doc, 'doc') : undefined;
    const m = mergeSync(await allDisplays(), remote, state.base, now);
    if (m.changedCloud) {
      const rev = await api.push(keys.lookup, row?.rev ?? 0, await sealJson(keys, m.doc, 'doc'));
      if (!rev) continue; // another device synced in between: merge again
    }
    // The cloud has the merged copy: now bring the other device's changes here.
    for (const k of m.keep) await addSnapshot(snapshotOf(k.rec, now));
    for (const rec of m.save) await saveDisplay(rec);
    for (const id of m.remove) await deleteDisplay(id);
    // Photos: send what the cloud lacks, fetch what this device lacks.
    const wanted = photoIdsOf(m.doc);
    const there = new Set(wanted.size ? await api.photoIds(keys.lookup) : []);
    let photosUp = 0;
    let photosDown = 0;
    for (const p of await allPhotos()) {
      if (!wanted.has(p.id) || there.has(p.id)) continue;
      await api.photoPut(keys.lookup, p.id, await seal(keys, await packPhoto(p), `photo:${p.id}`));
      photosUp++;
    }
    for (const id of wanted) {
      if (!there.has(id) || (await getPhoto(id))) continue;
      const data = await api.photoGet(keys.lookup, id);
      if (!data) continue;
      const p = unpackPhoto(await open(keys, data, `photo:${id}`));
      await savePhoto({ id, ...p, createdAt: now });
      photosDown++;
    }
    return {
      state: { ...state, base: m.base, lastSyncAt: now },
      saved: m.save.map((r) => r.id),
      removed: m.remove,
      kept: m.keep.length,
      photosUp,
      photosDown,
    };
  }
  throw new Error('Another device kept changing the plans during the sync. Try again in a moment.');
}

function snapshotOf(rec: StoredDisplay, at: number) {
  return {
    displayId: rec.id,
    at,
    reason: 'sync' as const,
    title: rec.title,
    itemCount: Object.keys(rec.display.nodes).length,
    text: rec.text,
    display: rec.display,
    lineNodeIds: rec.lineNodeIds,
  };
}
