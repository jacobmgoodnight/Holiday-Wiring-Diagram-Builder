import { describe, expect, it } from 'vitest';
import { updateNode } from '../model/actions';
import type { PhotoView } from '../model/types';
import { buildDisplay } from '../outline/build';
import { addView, setPlacement } from '../photo/actions';
import { takeoff, takeoffRows, takeoffText } from './takeoff';

const text = `# Test
O01 Porch outlet
  C01 green cord 25ft
    L01 C9 roofline run warm white 40ft
      L02 C9 roofline run warm white
  C02 SPT-1 zip cord 30ft
    Wreath
    Wreath
  S01 3-way splitter
    Inflatable x2
L05 Multicolor C9 porch run 10ft
L06 Net lights
`;
const view: PhotoView = { id: 'v1', name: 'Front', photoId: 'p', width: 2000, height: 1000, feetPerPx: 0.05 };

function plan() {
  let d = addView(buildDisplay(text, { id: 't' }).display, view).display;
  d = updateNode(d, 'C02', { outputs: 3 }).display;
  d = setPlacement(d, 'L02', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.3, 0.2]] }).display; // 400 px = 20 ft
  d = setPlacement(d, 'L06', 'v1', { kind: 'area', points: [[0.1, 0.6], [0.2, 0.6], [0.2, 0.7], [0.1, 0.7]] }).display;
  return d;
}

describe('shopping list', () => {
  it('adds up lights by type, colour and spacing, using photo lengths where the plan has none', () => {
    const s = takeoff(plan());
    const lights = s.find((x) => x.title === 'Lights along the house')!;
    expect(lights.lines[0]).toEqual({
      item: 'C9/C7 lights · Warm white · 12″ apart',
      qty: '~60 ft',
      detail: '≈ 62 bulbs · buy ~66 ft with 10% for corners',
      ids: ['L01', 'L02'],
    });
    // Multicolour C9s: bulbs by colour, in the order they repeat.
    expect(lights.lines[1].item).toBe('C9/C7 lights · Multicolor · 12″ apart');
    expect(lights.lines[1].detail).toBe('≈ 11 bulbs: 3 red, 2 green, 2 blue, 2 orange, 2 yellow · buy ~11 ft with 10% for corners');
  });

  it('lists bushes, zip cord females, cords by length, gear and props', () => {
    const s = Object.fromEntries(takeoff(plan()).map((x) => [x.title, x.lines]));
    expect(s['Bushes and trees']).toEqual([{ item: 'Net lights · Warm white', qty: '~10×5 ft', detail: '≈ 3 4×6 ft nets', ids: ['L06'] }]);
    expect(s['Zip cord and multi-outlet cords']).toEqual([{ item: 'SPT-1 zip cord', qty: '30 ft', detail: '2 inline females + 1 end female', ids: ['C02'] }]);
    expect(s['Extension cords']).toEqual([{ item: '25 ft green extension cord', qty: '× 1', ids: ['C01'] }]);
    expect(s['Splitters, timers and controllers']).toEqual([{ item: '3-way splitter', qty: '× 1', ids: ['S01'] }]);
    expect(s['Props and other lights'].map((l) => [l.item, l.qty])).toEqual([
      ['Wreath', '× 2'],
      ['Inflatable', '× 2'],
    ]);
  });

  it('says which runs have no length, and can list only what is new this year', () => {
    const d = updateNode(plan(), 'L02', { placements: undefined }).display;
    const line = takeoff(d)[0].lines[0];
    expect(line.qty).toBe('40 ft');
    expect(line.detail).toContain('1 run without a length (L02)');
    const fresh = takeoff(updateNode(d, 'C01', { isNew: true }).display, { onlyNew: true });
    expect(fresh.map((x) => x.title)).toEqual(['Extension cords']);
  });

  it('copies as text and CSV rows', () => {
    const s = takeoff(plan());
    expect(takeoffText('Test', s)).toContain('Lights along the house\n- C9/C7 lights · Warm white · 12″ apart: ~60 ft (≈ 62 bulbs · buy ~66 ft with 10% for corners) [L01, L02]\n');
    expect(takeoffRows(s)[0]).toEqual(['section', 'item', 'quantity', 'detail', 'ids']);
    expect(takeoffRows(s)).toContainEqual(['Extension cords', '25 ft green extension cord', '× 1', '', 'C01']);
  });
});
