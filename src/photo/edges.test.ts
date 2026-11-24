import { describe, expect, it } from 'vitest';
import type { Pt } from './geometry';
import { type EdgeMap, edgeMapFromPixels, followEdge, simplify, snapPoint } from './edges';

/** A w × h picture painted by `color(x, y)` (RGB). */
function picture(w: number, h: number, color: (x: number, y: number) => [number, number, number], scale = 1): EdgeMap {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...color(x, y), 255], (y * w + x) * 4);
  return edgeMapFromPixels(px, w, h, scale);
}

/** A 200 × 80 picture: light sky above a dark roof whose edge rises to a peak at x = 100. */
const roofY = (x: number) => 50 - 12 * Math.max(0, 1 - Math.abs(x - 100) / 90);
const roof = () => picture(200, 80, (x, y) => (y > roofY(x) ? [60, 60, 60] : [210, 210, 210]));

/** y on a polyline at x. */
const yOn = (path: Pt[], x: number) => {
  const i = Math.max(1, path.findIndex(([px]) => px >= x));
  const [x0, y0] = path[i - 1];
  const [x1, y1] = path[i];
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
};

describe('following edges in the photo', () => {
  it('traces along the roof edge between two taps instead of cutting straight across', () => {
    const f = followEdge(roof(), [10, 50], [190, 50], 6);
    const path: Pt[] = [f.start, ...f.points];
    expect(f.start).toEqual([10, 50]);
    expect(Math.hypot(path[path.length - 1][0] - 190, path[path.length - 1][1] - 50)).toBeLessThanOrEqual(3);
    expect(path.length).toBeLessThan(8); // simplified to a few points
    // Every step along the traced line stays on the roof edge (the edge is ~4 px thick)…
    for (let x = 12; x <= 186; x += 6) expect(Math.abs(yOn(path, x) - roofY(x))).toBeLessThanOrEqual(3);
    // …so it goes up over the peak, where the straight line would stay at y = 50.
    expect(yOn(path, 100)).toBeLessThan(42);
  });

  it('snaps a tap to the nearest strong edge, and leaves it alone on a plain area', () => {
    const map = roof();
    const [, y] = snapPoint(map, [100, 43], 6);
    expect(Math.abs(y - roofY(100))).toBeLessThanOrEqual(1.5);
    expect(snapPoint(map, [100, 10], 6)).toEqual([100, 10]); // open sky: nothing to snap to
  });

  it('keeps the straight line where there is no edge to follow', () => {
    const flat = picture(60, 40, () => [200, 200, 200], 2);
    expect(followEdge(flat, [10, 10], [100, 60], 12)).toEqual({ start: [10, 10], points: [[100, 60]] });
  });

  it('sees blue sky over a grey roof of the same brightness', () => {
    // Same luminance (about 134), different colour: a grey-only filter sees nothing here.
    const map = picture(80, 60, (_, y) => (y < 30 ? [90, 140, 220] : [134, 134, 134]));
    const [, y] = snapPoint(map, [40, 24], 10);
    expect(Math.abs(y - 29.5)).toBeLessThanOrEqual(1.5);
  });

  it('ends on the roof edge near the tap instead of hooking down a gutter return', () => {
    // A rake rising from (20, 70) to (160, 20), sky above; at its top end a dark downspout
    // runs straight down. The tap lands beside the downspout, below the end of the rake.
    const rakeY = (x: number) => 70 - (50 * (x - 20)) / 140;
    const map = picture(200, 100, (x, y) => {
      if (x >= 160 && x <= 166 && y >= 20) return [40, 40, 40];
      return x <= 160 && y > rakeY(x) ? [70, 70, 70] : [215, 225, 235];
    });
    const f = followEdge(map, [20, 70], [170, 34], 20);
    const end = f.points[f.points.length - 1];
    expect(Math.hypot(end[0] - 160, end[1] - 20)).toBeLessThanOrEqual(5); // the corner, not the downspout
    expect(f.points).toHaveLength(1); // one straight line up the rake
  });

  it('draws a slightly wobbly edge as one straight line, and may slide the first tap onto it', () => {
    // Roof edge at y ≈ 40 with a pixel of wobble (haze, photo noise); the first tap is 4 px off.
    const map = picture(200, 80, (x, y) => (y > 40 + ((x * 7) % 3) - 1 ? [60, 60, 60] : [200, 210, 225]));
    const f = followEdge(map, [12, 36], [188, 41], 8, { freeStart: true });
    expect(f.points).toHaveLength(1);
    expect(Math.abs(f.start[1] - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(f.points[0][1] - 40)).toBeLessThanOrEqual(2);
  });

  it('simplifies a wiggle-free line to its ends', () => {
    const line: Pt[] = Array.from({ length: 20 }, (_, i) => [i, 2 * i]);
    expect(simplify(line, 0.5)).toEqual([[0, 0], [19, 38]]);
  });
});
