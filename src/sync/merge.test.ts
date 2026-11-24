import { describe, expect, it } from 'vitest';
import { buildDisplay } from '../outline/build';
import { type StoredDisplay, toStored } from '../store/db';
import { type SyncBase, type SyncDoc, displayHash, mergeSync } from './merge';

const rec = (id: string, text: string, at: number): StoredDisplay => {
  const b = buildDisplay(text, { id });
  return toStored(text, b.display, b.lineNodeIds, at);
};
const doc = (...recs: StoredDisplay[]): SyncDoc => ({ v: 1, displays: Object.fromEntries(recs.map((r) => [r.id, { rec: r, hash: displayHash(r) }])), deleted: {} });
const base = (...recs: StoredDisplay[]): SyncBase => ({ hashes: Object.fromEntries(recs.map((r) => [r.id, displayHash(r)])) });

describe('merging plans between devices', () => {
  const a1 = rec('a', '# A\nO01 Porch\n', 100);
  const a2 = rec('a', '# A\nO01 Porch\n  Spotlight\n', 200);
  const a3 = rec('a', '# A\nO01 Garage\n', 300);
  const b1 = rec('b', '# B\nO01 Back\n', 100);

  it('first sync: everything here goes up', () => {
    const m = mergeSync([a1, b1], undefined, { hashes: {} }, 1000);
    expect(Object.keys(m.doc.displays).sort()).toEqual(['a', 'b']);
    expect(m.changedCloud).toBe(true);
    expect(m.save).toEqual([]);
  });

  it('joining: what is in the cloud comes down, what is here goes up', () => {
    const m = mergeSync([b1], doc(a1), { hashes: {} }, 1000);
    expect(m.save.map((r) => r.id)).toEqual(['a']);
    expect(Object.keys(m.doc.displays).sort()).toEqual(['a', 'b']);
  });

  it('an edit on one side wins; nothing to do when nothing changed', () => {
    expect(mergeSync([a2], doc(a1), base(a1), 1000)).toMatchObject({ save: [], keep: [], changedCloud: true });
    const down = mergeSync([a1], doc(a2), base(a1), 1000);
    expect(down.save).toEqual([a2]);
    expect(down.changedCloud).toBe(false);
    expect(mergeSync([a1], doc(a1), base(a1), 1000).changedCloud).toBe(false);
  });

  it('edits on both sides: the newer wins and the other is kept as a restore point', () => {
    const m = mergeSync([a3], doc(a2), base(a1), 1000); // a3 (here) is newer than a2 (there)
    expect(m.doc.displays.a.rec).toEqual(a3);
    expect(m.keep).toEqual([{ rec: a2, from: 'other device' }]);
    const m2 = mergeSync([a2], doc(a3), base(a1), 1000);
    expect(m2.save).toEqual([a3]);
    expect(m2.keep).toEqual([{ rec: a2, from: 'this device' }]);
  });

  it('deletions follow, unless the other side changed it since', () => {
    // Deleted here (it was synced as a1, the cloud still has a1): delete it in the cloud.
    const gone = mergeSync([], doc(a1), base(a1), 1000);
    expect(gone.doc.displays.a).toBeUndefined();
    expect(gone.doc.deleted.a).toBe(1000);
    // The other device then follows the deletion…
    expect(mergeSync([a1], gone.doc, base(a1), 2000).remove).toEqual(['a']);
    // …unless it changed it meanwhile: then it stays, and goes back up.
    const kept = mergeSync([a2], gone.doc, base(a1), 2000);
    expect(kept.remove).toEqual([]);
    expect(kept.doc.displays.a.rec).toEqual(a2);
    expect(kept.doc.deleted.a).toBeUndefined();
    // Deleted here but changed there: it comes back here.
    expect(mergeSync([], doc(a2), base(a1), 1000).save).toEqual([a2]);
  });
});
