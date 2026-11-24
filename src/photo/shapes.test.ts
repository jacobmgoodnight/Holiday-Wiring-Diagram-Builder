import { describe, expect, it } from 'vitest';
import { archPoints, megaTreeStrands, outlinePoints, shapePoints, wrapPoints } from './shapes';

describe('shapes', () => {
  it('outlines a window from two opposite corners, back to the first', () => {
    expect(outlinePoints([10, 10], [50, 40])).toEqual([[10, 10], [50, 10], [50, 40], [10, 40], [10, 10]]);
    expect(shapePoints('outline', [[10, 10]])).toBeUndefined(); // needs both corners
  });

  it('draws an arch from its feet, half as tall as it is wide, bulging up', () => {
    const pts = archPoints([0, 100], [100, 100]);
    expect(pts[0][0]).toBeCloseTo(0);
    expect(pts[pts.length - 1][0]).toBeCloseTo(100);
    const top = pts[pts.length >> 1];
    expect(top[0]).toBeCloseTo(50);
    expect(top[1]).toBeCloseTo(50); // 50 px above the feet
    expect(pts.every(([, y]) => y <= 100 + 1e-9)).toBe(true);
  });

  it('wraps a post from side to side, bottom to top', () => {
    const pts = wrapPoints([100, 200], [100, 40]); // a post 160 px tall
    expect(pts[0][1]).toBeCloseTo(200);
    expect(pts[pts.length - 1][1]).toBeCloseTo(40);
    const xs = pts.map(([x]) => Math.round(x));
    expect(new Set(xs)).toEqual(new Set([90, 110])); // alternates sides, 20 px wide
    expect(pts.length).toBeGreaterThan(8);
  });

  it('fans mega tree strands from the top across the base', () => {
    const s = megaTreeStrands([50, 0], [0, 100], [100, 100], 5);
    expect(s).toHaveLength(5);
    expect(s.every(([a]) => a[0] === 50 && a[1] === 0)).toBe(true);
    expect(s.map(([, b]) => b[0])).toEqual([0, 25, 50, 75, 100]);
  });
});
