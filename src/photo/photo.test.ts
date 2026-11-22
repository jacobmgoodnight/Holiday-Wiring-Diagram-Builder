import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deleteNode, updateNode } from '../model/actions';
import { copyForNextYear } from '../model/season';
import type { PhotoView } from '../model/types';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { addPlacedNode, addView, removeView, setPlacement, updateView } from './actions';
import {
  bulbColors,
  bulbSpacingPx,
  feetPerPxFrom,
  fitWithin,
  pointsAlong,
  polylineLength,
  runLengthFt,
  unplaced,
  wiringLines,
} from './geometry';

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

  it('uses real C9 spacing (about a foot) once the scale is known', () => {
    expect(bulbSpacingPx('c9', { ...view, feetPerPx: 0.05 })).toBeCloseTo(20);
    expect(bulbSpacingPx('c9', view)).toBe(20); // without scale: a pleasant default
  });

  it('colours bulbs from the item name', () => {
    expect(bulbColors({ label: 'Roofline C9 warm white' })).toEqual(['#ffcf6e']);
    expect(bulbColors({ label: 'Multicolor minis' })).toHaveLength(5);
    expect(bulbColors({ label: 'Red and green icicles' })).toEqual(['#ff3b30', '#30d158']);
    expect(bulbColors({ label: 'Candy cane pathway lights' })).toEqual(['#ff3b30', '#eef6ff']);
    expect(bulbColors({ label: 'Lights', color: 'black' })).toEqual(['#ffcf6e']);
    expect(bulbColors({ label: 'Pixel tree', category: 'pixel' })).toHaveLength(5);
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

  it('rejects runs with one point and points off the photo', () => {
    expect(() => setPlacement(base(), 'C02', 'v1', { kind: 'path', points: [[0.1, 0.1]] })).toThrow(/two points/);
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

  it('draws wiring lines to the nearest placed item upstream', () => {
    let d = base();
    d = setPlacement(d, 'O01', 'v1', { kind: 'point', x: 0.1, y: 0.5 }).display;
    d = setPlacement(d, 'S02', 'v1', { kind: 'point', x: 0.3, y: 0.5 }).display; // K01, C02 not placed
    d = setPlacement(d, 'S08', 'v1', { kind: 'path', points: [[0.4, 0.4], [0.6, 0.4]] }).display;
    const lines = wiringLines(d, 'v1');
    expect(lines.map((l) => [l.childId, l.parentId])).toEqual([
      ['S02', 'O01'],
      ['S08', 'S02'],
    ]);
    expect(lines[1]).toMatchObject({ from: [0.3, 0.5], to: [0.4, 0.4] });
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
    expect(wiringLines(d, 'v1')).toEqual([]);
  });
});
