import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deleteNode, updateNode } from '../model/actions';
import { inlineFemales, runSockets, socketLabels } from '../model/graph';
import { copyForNextYear } from '../model/season';
import type { PhotoView } from '../model/types';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import {
  addMeasure,
  addPlacedNode,
  addView,
  measureSpread,
  moveFemale,
  plugOnPhoto,
  removeFemale,
  removeMeasure,
  removeView,
  setPlacement,
  nearbyUnplugged,
  plugIntoCord,
  plugNearbyIntoCord,
  spliceFemale,
  swapEnds,
  updateView,
} from './actions';
import {
  type Pt,
  areaBulbs,
  cordFor,
  nearestOpenSocket,
  pointAlong,
  runSocketSpots,
  tapPositions,
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
import { applyLookToAll, lightOptsOf, lightPatch, lookKey, rememberLook, withLook } from './lightOpts';

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

describe('inline females and cords on the photo', () => {
  const sptText = 'O01 Porch outlet\n  C01 SPT-1 zip cord\n    Wreath\n';
  /** C01 zip cord with tap1 (the wreath on it), tap2 and an end female, drawn along y = 200. */
  const spt = () => {
    let d = addView(buildDisplay(sptText, { id: 'x' }).display, view).display;
    d = updateNode(d, 'C01', { outputs: 3 }).display;
    return setPlacement(d, 'C01', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.5, 0.2]] }).display; // 200..1000 px
  };

  it('spreads inline females evenly until they are placed', () => {
    expect(tapPositions({ kind: 'path', points: [] }, 2)).toEqual([1 / 3, 2 / 3]);
    expect(tapPositions({ kind: 'path', points: [], taps: [0.5] }, 3)).toEqual([0.5, 0.5 + 0.5 / 3, 0.5 + 1 / 3]);
    expect(tapPositions({ kind: 'path', points: [], taps: [0.2, 0.4, 0.9] }, 2)).toEqual([0.2, 0.4]);
    expect(pointAlong([[0, 0], [10, 0], [10, 10]], 0.75)).toEqual([10, 5]);
  });

  it('shows where each female is and what is plugged into it', () => {
    const spots = runSocketSpots(spt(), 'C01', view)!;
    expect(spots.map((s) => [s.port, Math.round(s.at[0]), s.childId])).toEqual([
      ['tap1', 467, 'L01'],
      ['tap2', 733, undefined],
      ['end', 1000, undefined],
    ]);
    // The wreath's cable starts at its female.
    const d = setPlacement(spt(), 'L01', 'v1', { kind: 'point', x: 0.25, y: 0.4 }).display;
    expect(wiringLines(d, view)[0].from[0]).toBeCloseTo(466.7, 0);
    expect(nearestOpenSocket(d, view, [990, 210], 30)).toMatchObject({ parent: 'C01', port: 'end' });
    expect(nearestOpenSocket(d, view, [600, 400], 30)).toBeUndefined();
  });

  it('splices a female in where you tap, renumbering the ones after it', () => {
    const r = spliceFemale(spt(), 'C01', 'v1', 0.1); // before tap1
    expect(r.port).toBe('tap1');
    const d = r.display;
    expect(d.nodes.C01.outputs).toBe(4);
    expect(d.nodes.C01.placements?.v1).toMatchObject({ taps: [0.1, 1 / 3, 2 / 3] });
    expect(d.links.find((l) => l.to === 'L01')?.port).toBe('tap2'); // the wreath stays on its female
    expect(syncFromModel(d).text).toBe('O01 Porch outlet\n  C01 SPT-1 zip cord\n    tap2: Wreath\n');
  });

  it('slides a female along; past another it takes the other number, plug and all', () => {
    const d = moveFemale(spt(), 'C01', 'v1', 0, 0.9).display; // tap1 (wreath) slides past tap2
    expect(d.nodes.C01.placements?.v1).toMatchObject({ taps: [2 / 3, 0.9] });
    expect(d.links.find((l) => l.to === 'L01')?.port).toBe('tap2');
  });

  it('removes an empty female, but not one in use', () => {
    const d = removeFemale(spt(), 'C01', 'v1', 1).display;
    expect(d.nodes.C01.outputs).toBe(2);
    expect(() => removeFemale(spt(), 'C01', 'v1', 0)).toThrow(/L01 is plugged into C01 tap 1/);
  });

  it('adds an extension cord, sized to a common length, when the next strand does not reach', () => {
    expect(cordFor(4)).toBe(6);
    expect(cordFor(20)).toBe(25);
    expect(cordFor(120)).toBe(150);
    let d = addView(buildDisplay('O01 Porch\n  L01 C9 roofline run\nL02 C9 garage run\n', { id: 'x' }).display, { ...view, feetPerPx: 0.05 }).display;
    const v = d.views![0];
    d = updateNode(d, 'L01', { outputs: 1 }).display;
    d = setPlacement(d, 'L01', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.5, 0.2]] }).display; // ends at x = 1000
    // Starts 400 px (20 ft) past the end of L01: a 25 ft cord goes in between.
    const far = setPlacement(d, 'L02', 'v1', { kind: 'path', points: [[0.7, 0.2], [0.9, 0.2]] }).display;
    const r = plugOnPhoto(far, v, 'L02', { parent: 'L01', port: 'end' });
    expect(r.cordFt).toBe(25);
    expect(syncFromModel(r.display).text).toBe('O01 Porch\n  L01 C9 roofline run\n    C01 Green extension cord 25ft\n      L02 C9 garage run\n');
    expect(wiringLines(r.display, v).find((l) => l.childId === 'L02')).toMatchObject({ parentId: 'L01', via: [r.cordId], color: '#2f6b3a' });
    // Touching ends plug straight in; so does "no cords" mode.
    const near = setPlacement(d, 'L02', 'v1', { kind: 'path', points: [[0.505, 0.2], [0.9, 0.2]] }).display;
    expect(plugOnPhoto(near, v, 'L02', { parent: 'L01', port: 'end' }).cordId).toBeUndefined();
    expect(plugOnPhoto(far, v, 'L02', { parent: 'L01', port: 'end' }, { autoCord: false }).cordId).toBeUndefined();
    expect(() => plugOnPhoto(far, v, 'L01', { parent: 'L01' })).toThrow(/itself/);
    // Two markers (an outlet and an inflatable) never get a cord added for them.
    let m = addView(buildDisplay('O01 Porch\nL01 Inflatable\n', { id: 'm' }).display, { ...view, feetPerPx: 0.05 }).display;
    m = setPlacement(m, 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    m = setPlacement(m, 'L01', 'v1', { kind: 'point', x: 0.8, y: 0.9 }).display;
    expect(plugOnPhoto(m, m.views![0], 'L01', { parent: 'O01' }).cordId).toBeUndefined();
  });
});

describe('swapping ends, measuring, remembered looks', () => {
  it('swaps the plug and female ends; inline females keep their spots and renumber', () => {
    let d = addView(buildDisplay('O01 Porch\n  C01 SPT-1 zip cord\n    Wreath\n', { id: 'x' }).display, view).display;
    d = updateNode(d, 'C01', { outputs: 3 }).display;
    d = setPlacement(d, 'C01', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.5, 0.2]], taps: [0.25, 0.6] }).display;
    const r = swapEnds(d, 'C01', 'v1').display;
    const pl = r.nodes.C01.placements!.v1;
    expect(pl).toMatchObject({ points: [[0.5, 0.2], [0.1, 0.2]] });
    expect((pl as { taps: number[] }).taps.map((t) => +t.toFixed(2))).toEqual([0.4, 0.75]);
    // The wreath was on tap1 (nearest the old plug end); that female is now tap2.
    expect(r.links.find((l) => l.to === 'L01')?.port).toBe('tap2');
    expect(runSocketSpots(r, 'C01', view)!.find((x) => x.port === 'end')!.at).toEqual([200, 200]);
  });

  it('combines several measurements and says how well they agree', () => {
    let d = addMeasure(base(), 'v1', { a: [0.1, 0.5], b: [0.2, 0.5], ft: 10, name: 'Garage door' }).display; // 200 px
    expect(d.views![0].feetPerPx).toBeCloseTo(0.05);
    d = addMeasure(d, 'v1', { a: [0.5, 0.5], b: [0.55, 0.5], ft: 5.5 }).display; // 100 px: 0.055
    expect(d.views![0].feetPerPx).toBeCloseTo(15.5 / 300);
    expect(measureSpread(d.views![0].measures!, view)).toBeCloseTo(0.005 / 0.0525);
    d = removeMeasure(d, 'v1', 0).display;
    expect(d.views![0].feetPerPx).toBeCloseTo(0.055);
    d = removeMeasure(d, 'v1', 0).display;
    expect(d.views![0].feetPerPx).toBeUndefined();
    expect(() => addMeasure(base(), 'v1', { a: [0.1, 0.5], b: [0.1, 0.5], ft: 10 })).toThrow();
  });

  it('new lights of a kind take the look last chosen for it', () => {
    const red = { bulbColors: ['#ff3b30'], spacingIn: 8, smooth: false, wireColor: 'white' };
    const d = rememberLook(base(), { label: 'C9 roofline run', category: 'c9' }, red);
    expect(lookKey({ label: 'Net lights', category: 'icicle' })).toBe('icicle:bush');
    const item = withLook(d, { kind: 'load' as const, label: 'C9 roofline run', category: 'c9' as const, spacingIn: 12 });
    expect(item).toMatchObject({ bulbColors: ['#ff3b30'], spacingIn: 8, wireColor: 'white' });
    // Your own preset keeps its colours.
    expect(lightOptsOf(withLook(d, { kind: 'load' as const, label: 'C9', category: 'c9' as const, bulbColors: ['#3a8bff'] }, true)).bulbColors).toEqual(['#3a8bff']);
    // A different kind of light is not affected.
    expect(lightOptsOf(withLook(d, { kind: 'load' as const, label: 'Mini lights', category: 'mini' as const })).bulbColors).toEqual(['#ffcf6e']);
  });

  it('can give every light of a kind the same look', () => {
    let d = buildDisplay('O01 Porch\n  L01 C9 roofline run\n  L02 Red C9 roofline run\n  L03 Mini lights\n', { id: 'x' }).display;
    d = applyLookToAll(d, d.nodes.L01, { bulbColors: ['#3a8bff'], spacingIn: 12, smooth: false, wireColor: 'green' });
    expect(d.nodes.L01.bulbColors).toEqual(['#3a8bff']);
    expect(d.nodes.L02.bulbColors).toEqual(['#3a8bff']);
    expect(d.nodes.L03.bulbColors).toBeUndefined();
    expect(d.lightLooks?.c9?.bulbColors).toEqual(['#3a8bff']);
    // The remembered look survives a text edit.
    const synced = syncFromModel(d);
    expect(synced.result.display.lightLooks?.c9?.bulbColors).toEqual(['#3a8bff']);
  });
});

describe('cords that no longer reach', () => {
  it('flags the cord when a strand is dragged away after it was sized, and says what fits', async () => {
    const { takeoff } = await import('../export/takeoff');
    const v = { ...view, feetPerPx: 0.05 };
    let d = addView(buildDisplay('O01 Porch\nL01 C9 roofline run\n', { id: 'x' }).display, v).display;
    d = setPlacement(d, 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    d = setPlacement(d, 'L01', 'v1', { kind: 'path', points: [[0.3, 0.5], [0.5, 0.5]] }).display; // 400 px = 20 ft away
    const r = plugOnPhoto(d, v, 'L01', { parent: 'O01' });
    expect(r.cordFt).toBe(25);
    expect(wiringLines(r.display, v)[0].short).toBeUndefined(); // sized to fit
    // Drag the strand 300 px (15 ft) further: 35 ft gap, needs ~42 ft; a 50 ft cord fits.
    const moved = setPlacement(r.display, 'L01', 'v1', { kind: 'path', points: [[0.45, 0.5], [0.65, 0.5]] }).display;
    expect(wiringLines(moved, v)[0].short).toEqual({ have: 25, need: 42, fix: 50 });
    const check = takeoff(moved)[0];
    expect(check.title).toBe('Check these cords');
    expect(check.lines[0]).toMatchObject({ item: `${r.cordId} Green extension cord (25 ft)`, qty: 'needs ~42 ft', detail: 'to reach L01 on “Front” · use a 50 ft cord' });
    // Without a scale nothing is flagged (lengths are unknown).
    expect(wiringLines(moved, view)[0].short).toBeUndefined();
  });
});

describe('plugging into a zip cord where things are', () => {
  // 20 px a foot. C01 runs along y = 500 from x = 200 to 1800 with only its end female.
  const fv: PhotoView = { ...view, feetPerPx: 0.05 };
  const yard = () => {
    let d = addView(buildDisplay('O01 Porch\n  C01 SPT-1 zip cord\nL01 Net lights\nL02 Net lights\nL03 Inflatable\n', { id: 'z' }).display, fv).display;
    d = updateNode(d, 'C01', { outputs: 1 }).display;
    d = setPlacement(d, 'C01', 'v1', { kind: 'path', points: [[0.1, 0.5], [0.9, 0.5]] }).display;
    d = setPlacement(d, 'L01', 'v1', { kind: 'area', points: [[0.3, 0.53], [0.35, 0.6], [0.25, 0.6]] }).display; // 1.5 ft below the cord
    d = setPlacement(d, 'L02', 'v1', { kind: 'area', points: [[0.6, 0.6], [0.65, 0.7], [0.55, 0.7]] }).display; // 5 ft below
    return setPlacement(d, 'L03', 'v1', { kind: 'point', x: 0.5, y: 0.9 }).display; // 20 ft away
  };
  const portOf = (d: ReturnType<typeof yard>, child: string) => {
    const link = d.links.find((l) => l.to === child)!;
    return socketLabels(d, link.from).get(link.id);
  };

  it('splices a female where the item is nearest, and its own lead reaches it', () => {
    const r = plugIntoCord(yard(), fv, 'L01', 'C01');
    expect(r).toMatchObject({ port: 'tap1', spliced: true });
    expect(r.cordId).toBeUndefined(); // 1.5 ft: the net's own lead reaches
    expect(portOf(r.display, 'L01')).toBe('tap1');
    const pl = r.display.nodes.C01.placements!.v1;
    expect(pl.kind === 'path' && pl.taps![0]).toBeCloseTo(0.25, 2);
    // Further off (5 ft), it still gets its own female, and an extension cord to reach it.
    const r2 = plugIntoCord(r.display, fv, 'L02', 'C01');
    expect(r2.port).toBe('tap2');
    expect(r2.cordFt).toBe(9);
  });

  it('uses an open female that is already close by instead of adding another', () => {
    const d = spliceFemale(yard(), 'C01', 'v1', 0.26).display;
    const r = plugIntoCord(d, fv, 'L01', 'C01');
    expect(r).toMatchObject({ port: 'tap1', spliced: false });
    expect(inlineFemales(r.display.nodes.C01)).toBe(1);
  });

  it('plugs in everything nearby in one go, in order along the cord', () => {
    const d = yard();
    expect(nearbyUnplugged(d, fv, 'C01')).toEqual(['L01', 'L02']); // not the inflatable 20 ft away, not the outlet
    const r = plugNearbyIntoCord(d, fv, 'C01');
    expect(r.plugged).toEqual(['L01', 'L02']);
    // L02 is 5 ft off, so it comes in through an extension cord plugged into tap 2.
    const cord = r.display.links.find((l) => l.to === 'L02')!.from;
    expect([portOf(r.display, 'L01'), portOf(r.display, cord)]).toEqual(['tap1', 'tap2']);
    expect(nearbyUnplugged(r.display, fv, 'C01')).toEqual([]);
    // Only zip cords and stringers take vampire females anywhere.
    expect(nearbyUnplugged(d, fv, 'L01')).toEqual([]);
  });
});
