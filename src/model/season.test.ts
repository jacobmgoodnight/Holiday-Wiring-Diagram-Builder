import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { addNode, replug, updateNode, deleteNode } from './actions';
import { checklist } from './checklist';
import { compareDisplays, copyForNextYear, nextTitle, snapshotsToPrune } from './season';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const base = () => buildDisplay(halloween, { id: 'h26' }).display;

describe('checklist', () => {
  it('lists every item outlet by outlet, from the wall outwards', () => {
    const groups = checklist(base(), 'install');
    expect(groups.map((g) => g.id)).toEqual(['O01', 'O02', 'O03', 'O04', 'O05', 'O06']);
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(55);
    const o2 = groups[1].rows;
    expect(o2.map((r) => r.id).slice(0, 4)).toEqual(['O02', 'K02', 'C01', 'S01']);
    expect(o2[0].depth).toBe(0);
    expect(o2.find((r) => r.id === 'S01')).toMatchObject({ depth: 3, into: 'C01' });
    expect(groups[0].rows.find((r) => r.id === 'C02')).toMatchObject({ into: 'K01 · left' });
  });

  it('marks installed and verified items done; S08 is already installed in the fixture', () => {
    const groups = checklist(base(), 'install');
    expect(groups[0].done).toBe(1);
    expect(groups[0].rows.find((r) => r.id === 'S08')!.done).toBe(true);
  });

  it('runs teardown from the far end back to the wall, tracking packed and storage', () => {
    let d = base();
    d = updateNode(d, 'S07', { packed: true, storage: 'Husky tote' }).display;
    const o3 = checklist(d, 'teardown')[2];
    expect(o3.rows.map((r) => r.id)).toEqual([...checklist(d, 'install')[2].rows.map((r) => r.id)].reverse());
    expect(o3.rows.at(-1)!.id).toBe('O03');
    expect(o3.rows.find((r) => r.id === 'S07')).toMatchObject({ done: true, storage: 'Husky tote' });
    expect(o3.done).toBe(1);
  });

  it('shows signal-only items with their link type', () => {
    const o5 = checklist(base(), 'install')[4];
    expect(o5.rows.find((r) => r.label === 'Dukane 8120WIA')).toMatchObject({ signal: 'hdmi', into: 'K03' });
  });
});

describe('copy for next year', () => {
  it('bumps the year in the title', () => {
    expect(nextTitle('Halloween 2026')).toBe('Halloween 2027');
    expect(nextTitle('Christmas 2026 (example)')).toBe('Christmas 2027 (example)');
    expect(nextTitle('Porch ideas')).toBe('Porch ideas (copy)');
  });

  it('keeps IDs and wiring, resets status, and rewrites only the touched lines', () => {
    let src = base();
    src = updateNode(src, 'C02', { isNew: true, packed: true, notes: 'behind bench' }).display;
    const copy = copyForNextYear(src, 'h27');
    expect(copy).toMatchObject({ id: 'h27', copiedFrom: 'h26', title: 'Halloween 2027' });
    expect(Object.keys(copy.nodes).sort()).toEqual(Object.keys(src.nodes).sort());
    expect(copy.links.length).toBe(src.links.length);
    expect(copy.nodes.C02).toMatchObject({ status: 'planned', notes: 'behind bench' });
    expect(copy.nodes.C02.isNew).toBeUndefined();
    expect(copy.nodes.C02.packed).toBeUndefined();
    const { text, result } = syncFromModel(copy);
    expect(result.display).toMatchObject({ title: 'Halloween 2027', year: 2027, copiedFrom: 'h26' });
    const changed = text.split('\n').filter((l, i) => l !== halloween.split('\n')[i]);
    expect(changed).toEqual(['# Halloween 2027', '        3: S08 3-way splitter']);
  });

  it('does not copy the source when the source changes later', () => {
    const src = base();
    const copy = copyForNextYear(src, 'h27');
    src.nodes.C02.label = 'changed';
    expect(copy.nodes.C02.label).toBe('black cord');
  });
});

describe('compare with last year', () => {
  it('reports added, moved, renamed and removed items', () => {
    const last = base();
    let d = syncFromModel(copyForNextYear(last, 'h27')).result.display;
    d = addNode(d, { kind: 'load', label: 'Strobe' }, { parent: 'S09', port: '1' }).display;
    d = replug(d, 'C09', { parent: 'S03', port: '3' }).display;
    d = updateNode(d, 'C06', { label: 'long green cord' }).display;
    const mister = Object.values(d.nodes).find((n) => n.label === 'Pond mister')!;
    d = deleteNode(d, mister.id, false).display;
    const changes = compareDisplays(last, d);
    expect(changes.map((c) => [c.kind, c.id, c.from ?? '', c.to ?? ''])).toEqual([
      ['added', 'L27', '', 'S09 · 1'],
      ['moved', 'C09', 'S08 · 2', 'S03 · 3'],
      ['renamed', 'C06', 'green cord', 'long green cord'],
      ['removed', mister.id, 'S07 · 2', ''],
    ]);
  });

  it('reports nothing for an untouched copy', () => {
    const last = base();
    expect(compareDisplays(last, syncFromModel(copyForNextYear(last, 'x')).result.display)).toEqual([]);
  });
});

describe('restore point retention', () => {
  it('keeps manual points and the newest 20 others', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ id: i, at: i * 1000, reason: i % 10 === 0 ? ('manual' as const) : ('auto' as const) }));
    const prune = snapshotsToPrune(list);
    expect(prune).toHaveLength(7); // 27 automatic, keep 20
    expect(prune.every((id) => id % 10 !== 0)).toBe(true);
    expect(Math.max(...prune)).toBeLessThan(Math.min(...list.filter((s) => s.reason === 'auto' && !prune.includes(s.id)).map((s) => s.id)));
  });
});
