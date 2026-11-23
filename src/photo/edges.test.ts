import { describe, expect, it } from 'vitest';
import type { Pt } from './geometry';
import { edgeMapFromPixels, simplify, snapPoint, traceEdge } from './edges';

/** A 100 × 80 picture: light sky above a dark roof whose edge rises to a peak at x = 50. */
const roofY = (x: number) => 50 - 8 * Math.max(0, 1 - Math.abs(x - 50) / 40);
function roof(): ReturnType<typeof edgeMapFromPixels> {
  const w = 100;
  const h = 80;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = y > roofY(x) ? 60 : 210;
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
  return edgeMapFromPixels(px, w, h, 1);
}

describe('following edges in the photo', () => {
  it('traces along the roof edge between two taps instead of cutting straight across', () => {
    const path = traceEdge(roof(), [10, 50], [90, 50]);
    expect(path[path.length - 1]).toEqual([90, 50]);
    // It goes up over the peak (the straight line would stay at y = 50).
    expect(path.some(([x, y]) => Math.abs(x - 50) <= 3 && Math.abs(y - roofY(50)) <= 2)).toBe(true);
    expect(path.length).toBeLessThan(8); // simplified to a few points
    for (const [x, y] of path) expect(Math.abs(y - roofY(x))).toBeLessThanOrEqual(2.5);
  });

  it('snaps a tap to the nearest strong edge, and leaves it alone on a plain area', () => {
    const map = roof();
    const [, y] = snapPoint(map, [50, 46], 6);
    expect(Math.abs(y - roofY(50))).toBeLessThanOrEqual(1.5);
    expect(snapPoint(map, [50, 10], 6)).toEqual([50, 10]); // open sky: nothing to snap to
  });

  it('keeps the straight line where there is no edge to follow', () => {
    const flat = edgeMapFromPixels(new Uint8ClampedArray(60 * 40 * 4).fill(200), 60, 40, 2);
    expect(traceEdge(flat, [10, 10], [100, 60])).toEqual([[100, 60]]);
  });

  it('simplifies a wiggle-free line to its ends', () => {
    const line: Pt[] = Array.from({ length: 20 }, (_, i) => [i, 2 * i]);
    expect(simplify(line, 0.5)).toEqual([[0, 0], [19, 38]]);
  });
});
