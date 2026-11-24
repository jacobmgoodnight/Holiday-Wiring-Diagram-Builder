import { describe, expect, it } from 'vitest';
import { updateNode } from '../model/actions';
import type { PhotoView } from '../model/types';
import { buildDisplay } from '../outline/build';
import { addView, setPlacement } from '../photo/actions';
import { installSteps, takedownSteps } from './installSteps';

const text = `# Test
O01 Porch outlet @20A GFCI
  C01 green cord 40ft
    L01 C9 roofline run
      end: L02 C9 garage run
  C02 SPT-1 zip cord
    tap2: Wreath
  S01 3-way splitter
    2: Spotlight
L05 Inflatable
`;

describe('install steps', () => {
  it('reads the plug-in order outlet by outlet, in words', () => {
    let d = buildDisplay(text, { id: 't' }).display;
    d = updateNode(d, 'O01', { location: 'Front porch' }).display;
    d = updateNode(d, 'C02', { outputs: 3 }).display;
    d = updateNode(d, 'L01', { outputs: 1 }).display;
    expect(installSteps(d).map((s) => `${s.n}. ${s.text}`)).toEqual([
      '1. Start at O01 Porch outlet (Front porch, GFCI).',
      '2. Plug C01 green cord 40 ft into O01.',
      '3. Plug L01 C9 roofline run into C01.',
      "4. Plug L02 C9 garage run into L01's end female.",
      '5. Plug C02 SPT-1 zip cord into O01.',
      '6. Plug L06 Wreath into C02 tap 2.',
      '7. Plug S01 3-way splitter into O01.',
      '8. Plug L07 Spotlight into S01 socket 2.',
      '9. Put up L05 Inflatable (not plugged in yet in the plan).',
    ]);
  });

  it('for one photo: what is on it and what feeds it, with the photo items marked', () => {
    const view: PhotoView = { id: 'v1', name: 'Front', photoId: 'p', width: 1000, height: 500 };
    let d = addView(buildDisplay(text, { id: 't' }).display, view).display;
    d = setPlacement(d, 'L02', 'v1', { kind: 'path', points: [[0.1, 0.2], [0.3, 0.2]] }).display;
    d = updateNode(d, 'C01', { status: 'installed' }).display;
    const steps = installSteps(d, { viewId: 'v1' });
    expect(steps.map((s) => [s.n, s.id, s.onPhoto, s.done])).toEqual([
      [1, 'O01', false, false],
      [2, 'C01', false, true],
      [3, 'L01', false, false],
      [4, 'L02', true, false],
    ]);
  });

  it('takes it down backwards, from the far end to the wall, with where each thing is stored', () => {
    let d = buildDisplay(text, { id: 't' }).display;
    d = updateNode(d, 'C02', { outputs: 3 }).display;
    d = updateNode(d, 'L01', { outputs: 1 }).display;
    d = updateNode(d, 'L02', { storage: 'Bin 3' }).display;
    d = updateNode(d, 'L07', { packed: true }).display;
    const steps = takedownSteps(d);
    expect(steps.map((s) => `${s.n}. ${s.text}`)).toEqual([
      '1. Take down L05 Inflatable.',
      '2. Unplug L07 Spotlight from S01 socket 2.',
      '3. Unplug S01 3-way splitter from O01.',
      '4. Unplug L06 Wreath from C02 tap 2.',
      '5. Unplug C02 SPT-1 zip cord from O01.',
      "6. Unplug L02 C9 garage run from L01's end female. Store in Bin 3.",
      '7. Unplug L01 C9 roofline run from C01.',
      '8. Unplug C01 green cord 40 ft from O01.',
    ]);
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['L07']);
  });
});
