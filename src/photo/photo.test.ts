import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deleteNode, updateNode } from '../model/actions';
import { inlineFemales, runSockets, socketLabels } from '../model/graph';
import { copyForNextYear } from '../model/season';
import type { PhotoView } from '../model/types';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { addPlacedNode, addView, removeView, setPlacement, updateView } from './actions';
import {
  type Pt,
  areaBulbs,
  bulbColors,
  bulbCount,
  bulbSpacingPx,
  drawsAsArea,
  feetPerPxFrom,
  fitWithin,
  insidePolygon,
  nearestOnPolyline,
  pointsAlong,
  polylineLength,
  runLengthFt,
  smoothPath,
  unplaced,
  wiringLines,
} from './geometry';
import { lightOptsOf, lightPatch } from './lightOpts';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const view: PhotoView = { id: 'v1', name: 'Front', photoId: 'p1', width: 2000, height: 1000 };
const base = () => addView(buildDisplay(halloween, { id: 'h' }).display, view).display;

describe('geometry', () => {
  it('measures runs once a scale is set', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    const fpp = feetPerPxFrom([0, 0], [0.1, 0], 16, view)!; // 200 px = 16 ft
    expect(fpp).toBeCloseTo(0.08);
    const run = { kind: 'path' as const, points: [[0, 0.5], [0.25, 0.5]] as [number, number][] };
    expect(runLengthFt(run, view)).toBeUndefined();
    expect(runLengthFt(run, { ...view, feetPerPx: fpp })).toBeCloseTo(40);
  });

  it('spaces bulbs evenly along corners', () => {
    const pts = pointsAlong([[0, 0], [10, 0], [10, 10]], 5);
    expect(pts).toEqual([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]]);
    expect(pointsAlong([[0, 0]], 5)).toEqual([[0, 0]]);
  });

  it('uses the real bulb spacing (12 in for C9 by default) once the scale is known', () => {
    expect(bulbSpacingPx({ category: 'c9' }, { ...view, feetPerPx: 0.05 })).toBeCloseTo(20);
    expect(bulbSpacingPx({ category: 'c9' }, view)).toBe(20); // without scale: a foot is 1% of the photo
    expect(bulbSpacingPx({ category: 'c9', spacingIn: 6 }, view)).toBe(10);
    expect(bulbSpacingPx({ category: 'mini' }, view)).toBeCloseTo(20 / 3); // minis: 4 in
    expect(bulbCount(32, 12)).toBe(33);
    expect(bulbCount(10, 8)).toBe(16);
    expect(bulbCount(0, 12)).toBe(0);
  });

  it('rounds corners: the curve cuts inside each corner, ends stay put', () => {
    const corner: Pt[] = [[0, 0], [100, 0], [100, 100]];
    const curve = smoothPath(corner);
    expect(curve[0]).toEqual([0, 0]);
    expect(curve[curve.length - 1]).toEqual([100, 100]);
    expect(curve.some(([x, y]) => Math.hypot(x - 100, y) < 1)).toBe(false); // no sharp corner
    expect(curve.every(([x, y]) => x <= 100 + 1e-9 && y >= -1e-9)).toBe(true); // never bulges outside
    expect(curve).toContainEqual([50, 0]); // straight up to halfway, then the curve
    const ring = smoothPath([[0, 0], [100, 0], [100, 100], [0, 100]], true);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(ring.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)).toBe(true);
    expect(smoothPath([[0, 0], [5, 5]])).toEqual([[0, 0], [5, 5]]);
    const zig = { kind: 'path' as const, points: [[0.1, 0.5], [0.2, 0.4], [0.3, 0.5]] as Pt[] };
    const scaled = { ...view, feetPerPx: 0.05 };
    expect(runLengthFt(zig, scaled, true)!).toBeLessThan(runLengthFt(zig, scaled)!);
  });

  it('covers a bush outline with a net or a wrap of bulbs, all inside it', () => {
    const ring: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const net = areaBulbs(ring, 10, 'net');
    expect(net.length).toBeGreaterThan(80);
    expect(net.length).toBeLessThan(130);
    expect(net.every((p) => insidePolygon(p, ring))).toBe(true);
    // Neighbours on the net are one spacing apart.
    const d = Math.min(...net.slice(1).map((p) => Math.hypot(p[0] - net[0][0], p[1] - net[0][1])));
    expect(d).toBeCloseTo(10);
    const wrap = areaBulbs(ring, 10, 'wrap');
    expect(wrap.length).toBeGreaterThan(60);
    expect(wrap.every((p) => insidePolygon(p, ring))).toBe(true);
    expect(areaBulbs(ring, 10, 'wrap')).toEqual(wrap); // stable between renders
    expect(areaBulbs(ring, 0.01, 'net', 200)).toHaveLength(200); // capped
  });

  it('finds the nearest point on a run', () => {
    const r = nearestOnPolyline([[0, 0], [100, 0], [100, 100]], [40, 20]);
    expect(r.at).toEqual([40, 0]);
    expect(r.along).toBeCloseTo(0.2);
  });

  it('knows which lights are outlined as a bush', () => {
    expect(drawsAsArea({ label: 'Net lights' })).toBe(true);
    expect(drawsAsArea({ label: 'Bush mini lights' })).toBe(true);
    expect(drawsAsArea({ label: 'Lights', category: 'tree' })).toBe(true);
    expect(drawsAsArea({ label: 'C9 roofline run', category: 'c9' })).toBe(false);
  });

  it('stores only the light options that differ from the defaults', () => {
    const red = { label: 'Red C9 run', category: 'c9' as const };
    expect(lightOptsOf(red)).toEqual({ bulbColors: ['#ff3b30'], spacingIn: 12, smooth: false, wireColor: 'green' });
    expect(lightPatch(red, lightOptsOf(red))).toEqual({ bulbColors: undefined, spacingIn: undefined, smooth: undefined, wireColor: undefined });
    expect(lightPatch(red, { bulbColors: ['#3a8bff'], spacingIn: 8, smooth: true, wireColor: 'white' })).toEqual({
      bulbColors: ['#3a8bff'],
      spacingIn: 8,
      smooth: true,
      wireColor: 'white',
    });
    expect(lightOptsOf({ ...red, bulbColors: ['#3a8bff'], wireColor: 'white' }).wireColor).toBe('white');
  });

  it('colours bulbs from the item name', () => {
    expect(bulbColors({ label: 'Roofline C9 warm white' })).toEqual(['#ffcf6e']);
    expect(bulbColors({ label: 'Multicolor minis' })).toHaveLength(5);
    expect(bulbColors({ label: 'Red and green icicles' })).toEqual(['#ff3b30', '#30d158']);
    expect(bulbColors({ label: 'Candy cane pathway lights' })).toEqual(['#ff3b30', '#eef6ff']);
    expect(bulbColors({ label: 'Lights', color: 'black' })).toEqual(['#ffcf6e']);
    expect(bulbColors({ label: 'Pixel tree', category: 'pixel' })).toHaveLength(5);
    expect(bulbColors({ label: 'Red lights', bulbColors: ['#3a8bff'] })).toEqual(['#3a8bff']); // picked by hand
  });

  it('shrinks big photos but never enlarges small ones', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('placing items', () => {
  it('places an item without touching its wiring, and survives a text round trip', () => {
    const d0 = base();
    const r = setPlacement(d0, 'S03', 'v1', { kind: 'point', x: 0.4, y: 0.8 });
    expect(r.display.links).toEqual(d0.links);
    const synced = syncFromModel(r.display);
    expect(synced.text).toBe(halloween); // the outline does not change
    expect(synced.result.display.nodes.S03.placements).toEqual({ v1: { kind: 'point', x: 0.4, y: 0.8 } });
    expect(synced.result.display.views).toEqual([view]);
  });

  it('keeps placements through text edits of the item', () => {
    const d0 = setPlacement(base(), 'C02', 'v1', { kind: 'point', x: 0.1, y: 0.1 }).display;
    const { text, lineNodeIds } = { text: halloween, lineNodeIds: buildDisplay(halloween).lineNodeIds };
    const edited = buildDisplay(text.replace('C02 black cord 10ft', 'C02 black cord 12ft'), { previous: { display: d0, text, lineNodeIds } });
    expect(edited.display.nodes.C02.placements?.v1).toEqual({ kind: 'point', x: 0.1, y: 0.1 });
    expect(edited.display.views).toEqual([view]);
  });

  it('rejects runs with one point, bushes with two, and points off the photo', () => {
    expect(() => setPlacement(base(), 'C02', 'v1', { kind: 'path', points: [[0.1, 0.1]] })).toThrow(/two points/);
    expect(() => setPlacement(base(), 'C02', 'v1', { kind: 'area', points: [[0.1, 0.1], [0.2, 0.2]] })).toThrow(/three points/);
    expect(setPlacement(base(), 'C02', 'v1', { kind: 'area', points: [[0.1, 0.1], [0.2, 0.2], [0.1, 0.3]] }).display.nodes.C02.placements?.v1.kind).toBe('area');
    expect(() => setPlacement(base(), 'C02', 'v1', { kind: 'point', x: 1.2, y: 0.1 })).toThrow();
    expect(() => setPlacement(base(), 'C02', 'nope', { kind: 'point', x: 0.2, y: 0.1 })).toThrow(/no longer here/);
  });

  it('adds a new light run straight onto the photo, unplugged', () => {
    const r = addPlacedNode(base(), { kind: 'load', label: 'Roofline C9 warm white', category: 'c9' }, 'v1', {
      kind: 'path',
      points: [
        [0.1, 0.2],
        [0.5, 0.1],
      ],
    });
    const n = r.display.nodes[r.nodeId!];
    expect(n.placements?.v1.kind).toBe('path');
    expect(r.display.links.some((l) => l.to === n.id)).toBe(false);
    expect(syncFromModel(r.display).text).toMatch(/\n\nRoofline C9 warm white\n$/);
  });

  it('runs a cable to the nearest placed item upstream, coloured like the cord in between', () => {
    let d = base();
    d = setPlacement(d, 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    d = setPlacement(d, 'S02', 'v1', { kind: 'point', x: 0.3, y: 0.5 }).display; // K01, C02 not placed
    d = setPlacement(d, 'S08', 'v1', { kind: 'path', points: [[0.4, 0.4], [0.6, 0.4]] }).display;
    const lines = wiringLines(d, view);
    expect(lines.map((l) => [l.childId, l.parentId])).toEqual([
      ['S02', 'O01'],
      ['S08', 'S02'],
    ]);
    expect(lines[0]).toMatchObject({ from: [200, 500], to: [600, 500], via: ['C02'], color: '#1d1d1f' }); // C02 black cord
    expect(lines[1]).toMatchObject({ from: [600, 500], to: [800, 400] }); // to the run's plug end
  });

  it('attaches at the end female, or the nearest point for an inline female', () => {
    const text = 'O01 Porch outlet\n  L01 C9 roofline run\n    end: L02 C9 garage run\n    tap1: L03 Wreath\n';
    let d = addView(buildDisplay(text, { id: 'x' }).display, view).display;
    d = setPlacement(d, 'L01', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.5, 0.2]] }).display;
    d = setPlacement(d, 'L02', 'v1', { kind: 'path', points: [[0.6, 0.3], [0.9, 0.3]] }).display;
    d = setPlacement(d, 'L03', 'v1', { kind: 'point', x: 0.25, y: 0.4 }).display;
    const by = Object.fromEntries(wiringLines(d, view).map((l) => [l.childId, l]));
    expect(by.L02.from).toEqual([1000, 200]); // the end of L01
    expect(by.L03.from).toEqual([500, 200]); // straight above the wreath, on L01
    expect(by.L03.color).toBe('#2f6b3a'); // the wreath's own green lead
  });

  it('a run with inline females names its sockets tap1, tap2… then end', () => {
    let d = buildDisplay('O01 Porch\n  C01 SPT-1 zip cord\n    L01 Wreath\n    L02 Wreath\n', { id: 'x' }).display;
    expect(d.nodes.C01.subtype).toBe('spt');
    d = updateNode(d, 'C01', { outputs: 3 }).display;
    expect(runSockets(d.nodes.C01)).toEqual(['tap1', 'tap2', 'end']);
    expect(inlineFemales(d.nodes.C01)).toBe(2);
    expect([...socketLabels(d, 'C01').values()]).toEqual(['tap1', 'tap2']);
    d = updateNode(d, 'C01', { endFemale: false }).display;
    expect(runSockets(d.nodes.C01)).toEqual(['tap1', 'tap2', 'tap3']);
    expect(runSockets(buildDisplay('O01\n  S01 3-way splitter\n').display.nodes.S01)).toBeUndefined();
  });

  it('keeps light options, socket counts and outlet location through text edits', () => {
    const text = 'O01 Porch outlet\n  C01 SPT-1 zip cord\n    tap2: Wreath\n  L02 C9 roofline run\n';
    const b0 = buildDisplay(text, { id: 'x' });
    expect(b0.display.links.find((l) => l.from === 'C01')?.port).toBe('tap2');
    let d = updateNode(b0.display, 'C01', { outputs: 4, endFemale: false }).display;
    d = updateNode(d, 'L02', { bulbColors: ['#3a8bff'], spacingIn: 8, smooth: true, wireColor: 'white' }).display;
    d = updateNode(d, 'O01', { location: 'Front porch' }).display;
    const synced = syncFromModel(d);
    const edited = buildDisplay(synced.text.replace('C9 roofline run', 'C9 roofline run left'), {
      previous: { display: synced.result.display, text: synced.text, lineNodeIds: synced.result.lineNodeIds },
    }).display;
    expect(edited.nodes.C01).toMatchObject({ outputs: 4, endFemale: false });
    expect(edited.nodes.L02).toMatchObject({ label: 'C9 roofline run left', bulbColors: ['#3a8bff'], spacingIn: 8, smooth: true, wireColor: 'white' });
    expect(edited.nodes.O01.location).toBe('Front porch');
  });

  it('plugs a new item into a target when it is added on the photo', () => {
    const r = addPlacedNode(base(), { kind: 'load', label: 'Net lights', category: 'icicle' }, 'v1', { kind: 'area', points: [[0.1, 0.6], [0.2, 0.6], [0.15, 0.7]] }, { parent: 'S02' });
    expect(r.display.links.some((l) => l.from === 'S02' && l.to === r.nodeId)).toBe(true);
    expect(r.display.nodes[r.nodeId!].placements?.v1.kind).toBe('area');
  });

  it('lists what is not on the photo yet, outlet by outlet', () => {
    const d = setPlacement(base(), 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    const list = unplaced(d, 'v1');
    expect(list).toHaveLength(54);
    expect(list[0].id).toBe('K01');
  });

  it('removing a photo removes its placements but not the items', () => {
    let d = setPlacement(base(), 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    d = removeView(d, 'v1').display;
    expect(d.views).toBeUndefined();
    expect(d.nodes.O01.placements).toBeUndefined();
    expect(Object.keys(d.nodes)).toHaveLength(55);
  });

  it('keeps the scale, and copies photos and placements for next year', () => {
    let d = updateView(base(), 'v1', { feetPerPx: 0.05 }).display;
    d = setPlacement(d, 'C02', 'v1', { kind: 'point', x: 0.2, y: 0.2 }).display;
    d = updateNode(d, 'C02', { status: 'installed' }).display;
    const copy = syncFromModel(copyForNextYear(d, 'h27')).result.display;
    expect(copy.views).toEqual([{ ...view, feetPerPx: 0.05 }]);
    expect(copy.nodes.C02).toMatchObject({ status: 'planned', placements: { v1: { kind: 'point', x: 0.2, y: 0.2 } } });
  });

  it('a deleted item leaves no wiring line behind', () => {
    let d = setPlacement(base(), 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    d = setPlacement(d, 'S02', 'v1', { kind: 'point', x: 0.3, y: 0.5 }).display;
    d = deleteNode(d, 'S02', true).display;
    expect(wiringLines(d, view)).toEqual([]);
  });
});
