import { describe, expect, it } from 'vitest';
import type { Pt } from './geometry';
import { edgeMapFromPixels, simplify, snapPoint, traceEdge } from './edges';

/** A 200 × 80 picture: light sky above a dark roof whose edge rises to a peak at x = 100. */
const roofY = (x: number) => 50 - 12 * Math.max(0, 1 - Math.abs(x - 100) / 90);
function roof(): ReturnType<typeof edgeMapFromPixels> {
  const w = 200;
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
    const path: Pt[] = [[10, 50], ...traceEdge(roof(), [10, 50], [190, 50])];
    expect(path[path.length - 1]).toEqual([190, 50]);
    expect(path.length).toBeLessThan(8); // simplified to a few points
    // Every step along the traced line stays on the roof edge (the edge is ~4 px thick)…
    const yAt = (x: number) => {
      const i = path.findIndex(([px]) => px >= x);
      const [x0, y0] = path[Math.max(0, i - 1)];
      const [x1, y1] = path[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    };
    for (let x = 10; x <= 190; x += 5) expect(Math.abs(yAt(x) - roofY(x))).toBeLessThanOrEqual(3);
    // …so it goes up over the peak, where the straight line would stay at y = 50.
    expect(yAt(100)).toBeLessThan(42);
  });

  it('snaps a tap to the nearest strong edge, and leaves it alone on a plain area', () => {
    const map = roof();
    const [, y] = snapPoint(map, [100, 43], 6);
    expect(Math.abs(y - roofY(100))).toBeLessThanOrEqual(1.5);
    expect(snapPoint(map, [100, 10], 6)).toEqual([100, 10]); // open sky: nothing to snap to
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
