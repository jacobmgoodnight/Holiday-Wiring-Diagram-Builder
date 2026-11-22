import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutDisplay } from '../diagram/layout';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { suggestionsFor } from '../presets/suggest';
import { addNode, duplicateNode, updateNode } from './actions';
import { findNodes, navigate } from './navigate';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const base = () => buildDisplay(halloween, { id: 'h' }).display;

describe('arrow-key navigation', () => {
  const d = base();
  it('moves to parent, first child and siblings', () => {
    expect(navigate(d, 'S02', 'left')).toBe('C02');
    expect(navigate(d, 'S02', 'right')).toBe('L01');
    expect(navigate(d, 'S08', 'up')).toBe('L02');
    expect(navigate(d, 'S08', 'down')).toBe('L08');
    expect(navigate(d, 'L08', 'down')).toBeUndefined();
    expect(navigate(d, 'O01', 'left')).toBeUndefined();
    expect(navigate(d, 'O01', 'down')).toBe('O02');
    expect(navigate(d, 'C03', 'right')).toBe('L10');
  });
  it('does not step into a collapsed branch', () => {
    expect(navigate(d, 'S02', 'right', new Set(['S02']))).toBeUndefined();
  });
});

describe('find', () => {
  const d = base();
  it('ranks an exact ID first, then names', () => {
    expect(findNodes(d, 's02').map((n) => n.id)).toEqual(['S02']);
    expect(findNodes(d, 'skelly').map((n) => n.label)).toEqual(['6.5-ft Ultra Skelly', 'Orange Ultra Skelly spotlight', '12-ft Skelly spotlight', '12-ft Skelly', '3-way under 12-ft Skelly (yard tap)']);
    expect(findNodes(d, 'pumpkin').length).toBeGreaterThanOrEqual(5);
    expect(findNodes(d, '   ')).toEqual([]);
  });
  it('finds by tag and storage spot', () => {
    const t = updateNode(updateNode(d, 'C02', { tags: ['porch'] }).display, 'C09', { storage: 'Blue tote' }).display;
    expect(findNodes(t, 'porch').map((n) => n.id)).toContain('C02');
    expect(findNodes(t, 'blue tote').map((n) => n.id)).toEqual(['C09']);
  });
});

describe('duplicate', () => {
  it('adds a new item of the same kind into the next free socket', () => {
    const d0 = buildDisplay('O01 Porch\n  S01 4-way splitter\n    Spotlight 15W [porch]\n', { id: 't' }).display;
    const r = duplicateNode(d0, 'L01');
    expect(r.nodeId).toBe('L02');
    expect(r.warning).toBeUndefined();
    expect(syncFromModel(r.display).text).toBe('O01 Porch\n  S01 4-way splitter\n    Spotlight 15W [porch]\n    Spotlight 15W [porch]\n');
  });
  it('does not copy status, notes, photo spots or what is plugged into it', () => {
    let d0 = base();
    d0 = updateNode(d0, 'C08', { status: 'installed', notes: 'old', placements: { v: { kind: 'point', x: 0.1, y: 0.1 } } }).display;
    const r = duplicateNode(d0, 'C08');
    const copy = r.display.nodes[r.nodeId!];
    expect(copy).toMatchObject({ kind: 'cord', label: 'brown cord 3-socket end', status: 'planned', outputs: 3, color: 'brown' });
    expect(copy.notes).toBeUndefined();
    expect(copy.placements).toBeUndefined();
    expect(r.display.links.filter((l) => l.from === copy.id)).toEqual([]);
  });
  it('warns (but still adds) when the splitter is full', () => {
    const r = duplicateNode(base(), 'L01'); // S02 is a 4-way with 4 used
    expect(r.warning).toMatch(/no free socket \(4 of 4 used\)/);
  });
  it('fills a written "Unused socket" first', () => {
    const r = duplicateNode(base(), 'L09'); // on S03, which has "3: Unused socket"
    expect(syncFromModel(r.display).text).toContain('      3: Porch UV spotlight\n');
  });
});

describe('picker suggestions', () => {
  const d = base();
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id);
  it('suggests gear under outlets and plugs, splitters after cords', () => {
    expect(ids(suggestionsFor(d, null))[0]).toBe('outlet');
    expect(ids(suggestionsFor(d, 'O01'))[0]).toBe('smartplug2');
    expect(ids(suggestionsFor(d, 'C02'))[0]).toBe('split3');
  });
  it('offers more of the same when filling a splitter', () => {
    const s = suggestionsFor(d, 'S01', 'L18');
    expect(s[0]).toMatchObject({ id: 'like:L18', name: 'Another Orange spotlight A', kind: 'load', label: 'Orange spotlight A' });
    expect(s.slice(1, 3).map((p) => p.name)).toEqual(['Another 15-ft scarecrow', 'Another Orange spotlight B']);
    const r = addNode(d, s[0], { parent: 'S01' });
    expect(r.display.nodes[r.nodeId!]).toMatchObject({ label: 'Orange spotlight A', category: 'spotlight' });
  });
  it('offers another run only for light strings that daisy-chain', () => {
    const t = buildDisplay('O01 x\n  Roofline C9 warm white\n  Spotlight\n', { id: 't' }).display;
    expect(ids(suggestionsFor(t, 'L01'))).toEqual(['like:L01', 'cord', 'split3']);
    expect(ids(suggestionsFor(t, 'L02'))).toEqual(['cord', 'split3']);
  });

  it('never repeats a suggestion', () => {
    const s = suggestionsFor(d, 'S07');
    expect(new Set(s.map((p) => `${p.kind}|${p.label}`)).size).toBe(s.length);
  });
});

describe('collapsed branches', () => {
  it('hides everything below a collapsed item and counts it', () => {
    const d = base();
    const full = layoutDisplay(d);
    const folded = layoutDisplay(d, { collapsed: new Set(['S02']) });
    const s02 = folded.nodes.find((n) => n.id === 'S02')!;
    expect(s02).toMatchObject({ collapsed: 11, branch: true });
    expect(folded.nodes.some((n) => n.id === 'S08' || n.id === 'L01')).toBe(false);
    expect(full.nodes.filter((n) => n.type === 'item').length - folded.nodes.filter((n) => n.type === 'item').length).toBe(11);
    // The ESP32's BLE link points into the folded branch, so it is not drawn.
    expect(folded.edges.some((e) => e.source === 'P01')).toBe(false);
    expect(folded.height).toBeLessThan(full.height);
  });
  it('collapsing a leaf does nothing', () => {
    expect(layoutDisplay(base(), { collapsed: new Set(['L01']) }).nodes.find((n) => n.id === 'L01')!.collapsed).toBeUndefined();
  });
});
