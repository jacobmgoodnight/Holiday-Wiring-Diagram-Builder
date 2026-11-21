import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { PRESETS, presetById, searchPresets } from '../presets/presets';
import { ActionError, addNode, changeKind, deleteNode, replug, subtreeIds, unplug, updateNode } from './actions';
import { socketLabels, unusedSockets } from './graph';
import { COALESCE_MS, HISTORY_LIMIT, initHistory, push, redo, undo } from './history';
import type { Display } from './types';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const preset = (id: string) => presetById(id)!;
const text = (d: Display) => syncFromModel(d).text;

describe('addNode', () => {
  it('rebuilds the O02 branch from presets, socket by socket', () => {
    let d = buildDisplay('# Test\nO02 Garage-side outlet\n', { id: 't' }).display;
    const add = (id: string, parent: string, port?: string) => {
      const r = addNode(d, preset(id), { parent, port });
      expect(r.warning).toBeUndefined();
      d = syncFromModel(r.display).result.display;
      return r.nodeId!;
    };
    const k = add('smartplug2', 'O02');
    const c = add('cord', k, '1');
    const s = add('split4', c);
    add('prop', s, '1');
    add('spot', s, '2');
    add('spot', s, '3');
    const t = add('tote', s, '4');
    add('projector', t);
    add('fan', t);
    add('split3', t);
    expect(text(d)).toBe(
      [
        '# Test',
        'O02 Garage-side outlet',
        '  K01 2-port smart plug',
        '    C01 Extension cord',
        '      S01 4-way splitter',
        '        Animated prop',
        '        Spotlight',
        '        Spotlight',
        '        T01 Tote',
        '          Projector',
        '          Fan',
        '          S02 3-way splitter',
        '',
      ].join('\n'),
    );
    expect(unusedSockets(d, 'K01')).toBe(1);
    expect(unusedSockets(d, 'S02')).toBe(3);
    // Re-reading the text keeps every ID.
    expect(Object.keys(syncFromModel(d).result.display.nodes).sort()).toEqual(Object.keys(d.nodes).sort());
  });

  it('writes the socket label only when numbering would get it wrong', () => {
    const d0 = buildDisplay('O01 Porch\n  S01 4-way splitter\n', { id: 't' }).display;
    const r = addNode(d0, preset('spot'), { parent: 'S01', port: '3' });
    expect(text(r.display)).toBe('O01 Porch\n  S01 4-way splitter\n    3: Spotlight\n');
    expect(socketLabels(r.display, 'S01').get(r.display.links.at(-1)!.id)).toBe('3');
  });

  it('fills a written "Unused socket" line in place', () => {
    const d0 = buildDisplay(halloween, { id: 'h' }).display;
    const r = addNode(d0, preset('inflatable'), { parent: 'S03', port: '3' });
    expect(text(r.display)).toContain('      3: Inflatable\n\nO02');
    expect(text(r.display)).not.toContain('Unused socket');
  });

  it('fills the first written unused socket when no socket is named', () => {
    const d0 = buildDisplay(halloween, { id: 'h' }).display;
    const r = addNode(d0, preset('inflatable'), { parent: 'S03' });
    expect(text(r.display)).toContain('      3: Inflatable\n\nO02');
  });

  it('warns but still adds when a socket is already used', () => {
    const d0 = buildDisplay(halloween, { id: 'h' }).display;
    const r = addNode(d0, preset('spot'), { parent: 'S02', port: '2' });
    expect(r.warning).toMatch(/already feeds/);
  });

  it('adds a top-level outlet after a blank line', () => {
    const d0 = buildDisplay('O01 Porch\n', { id: 't' }).display;
    const r = addNode(d0, preset('outlet'), { parent: null });
    expect(r.nodeId).toBe('O02');
    expect(text(r.display)).toBe('O01 Porch\n\nO02 Outlet\n');
  });
});

describe('replug / unplug / delete', () => {
  const base = () => buildDisplay(halloween, { id: 'h' }).display;

  it('moves an item with everything plugged into it', () => {
    const r = replug(base(), 'C09', { parent: 'S03', port: '3' });
    const out = text(r.display);
    expect(out).toContain('      3: C09 short black cord\n        Carved pumpkin 4, C7 flicker bulb\n');
    expect(out).not.toContain('Unused socket');
    expect(socketLabels(r.display, 'S08').size).toBe(2);
  });

  it('keeps later siblings on their sockets when one is removed', () => {
    const d0 = buildDisplay('O01 x\n  S01 3-way splitter\n    Fan\n    Mister\n    Fog\n', { id: 't' }).display;
    const mister = Object.values(d0.nodes).find((n) => n.label === 'Mister')!;
    for (const r of [deleteNode(d0, mister.id, false), unplug(d0, mister.id), replug(d0, mister.id, { parent: 'O01' })]) {
      expect(text(r.display)).toContain('    Fan\n    3: Fog\n');
    }
    // Removing the last one needs no pinning.
    const fog = Object.values(d0.nodes).find((n) => n.label === 'Fog')!;
    expect(text(deleteNode(d0, fog.id, false).display)).toContain('    Fan\n    Mister\n');
  });

  it('refuses loops', () => {
    expect(() => replug(base(), 'S02', { parent: 'C08' })).toThrow(ActionError);
    expect(() => replug(base(), 'S02', { parent: 'S02' })).toThrow(/itself/);
  });

  it('unplugs into "not plugged in yet" without guessing a new parent', () => {
    const r = unplug(base(), 'C09');
    expect(r.display.links.some((l) => l.to === 'C09')).toBe(false);
    expect(text(r.display)).toMatch(/\n\nC09 short black cord\n  Carved pumpkin 4, C7 flicker bulb\n$/);
  });

  it('deletes only the item, leaving what was plugged into it unplugged', () => {
    const r = deleteNode(base(), 'C08', false);
    expect(r.display.nodes.C08).toBeUndefined();
    const pumpkins = Object.values(r.display.nodes).filter((n) => /Carved pumpkin [123]/.test(n.label));
    expect(pumpkins).toHaveLength(3);
    expect(pumpkins.every((p) => !r.display.links.some((l) => l.to === p.id))).toBe(true);
  });

  it('deletes an item with everything below it, including signal links into it', () => {
    const d = base();
    const skelly = Object.values(d.nodes).find((n) => n.label === '6.5-ft Ultra Skelly')!;
    const r = deleteNode(d, 'S02', true);
    expect(Object.keys(r.display.nodes)).toHaveLength(55 - subtreeIds(d, 'S02').size);
    expect(r.display.nodes[skelly.id]).toBeUndefined();
    expect(r.display.links.some((l) => l.to === skelly.id)).toBe(false);
    expect(syncFromModel(r.display).result.diagnostics.filter((x) => x.severity !== 'info')).toEqual([]);
  });
});

describe('updateNode / changeKind', () => {
  it('rewrites only the edited line and keeps notes', () => {
    const d0 = buildDisplay(halloween, { id: 'h' }).display;
    const r = updateNode(d0, 'C02', { label: 'black cord', lengthFt: 12, notes: 'Behind the bench', status: 'installed' });
    const synced = syncFromModel(r.display);
    const changed = synced.text.split('\n').filter((l, i) => l !== halloween.split('\n')[i]);
    expect(changed).toEqual(['    left: C02 black cord 12ft [installed]']);
    expect(synced.result.display.nodes.C02.notes).toBe('Behind the bench');
  });

  it('gives a new ID when the kind changes, keeping its connections', () => {
    const d0 = buildDisplay(halloween, { id: 'h' }).display;
    const fan = Object.values(d0.nodes).find((n) => n.label === 'PC cooling fan')!;
    const r = changeKind(d0, fan.id, 'splitter');
    expect(r.nodeId).toBe('S10');
    expect(r.display.links.find((l) => l.to === 'S10')).toMatchObject({ from: 'T02' });
    expect(text(r.display)).toContain('          S10 PC cooling fan\n');
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    let h = initHistory('a');
    h = push(h, 'b');
    h = push(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    h = undo(undo(h));
    expect(h.present).toBe('a');
    expect(undo(h)).toBe(h);
    h = push(h, 'x');
    expect(h.future).toEqual([]);
  });

  it('coalesces a burst of typing into one step', () => {
    let h = initHistory('');
    h = push(h, 'F', { coalesceKey: 'text', now: 0 });
    h = push(h, 'Fa', { coalesceKey: 'text', now: 300 });
    h = push(h, 'Fan', { coalesceKey: 'text', now: 600 });
    h = push(h, 'Fan!', { coalesceKey: 'text', now: 600 + COALESCE_MS + 1 });
    expect(h.past).toEqual(['', 'Fan']);
  });

  it(`keeps at least 50 steps (limit ${HISTORY_LIMIT})`, () => {
    let h = initHistory(0);
    for (let i = 1; i <= 150; i++) h = push(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    for (let i = 0; i < 60; i++) h = undo(h);
    expect(h.present).toBe(90);
  });
});

describe('presets', () => {
  it('have unique ids and never guess watts', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    const r = addNode(buildDisplay('O01 x\n').display, preset('c9'), { parent: 'O01' });
    expect(r.display.nodes[r.nodeId!]).toMatchObject({ category: 'c9' });
    expect(r.display.nodes[r.nodeId!].watts).toBeUndefined();
  });

  it('search matches names and keywords', () => {
    expect(searchPresets('kasa').map((p) => p.id)).toEqual(['smartplug', 'smartplug2']);
    expect(searchPresets('candy').map((p) => p.id)).toEqual(['pathway']);
    expect(searchPresets('')).toHaveLength(PRESETS.length);
  });
});
