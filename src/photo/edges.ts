/**
 * Follow edges in the photo (pure, apart from loadEdgeMap): tap two roof corners and the run
 * follows the roof edge between them. The photo is shrunk, turned to grey, lightly blurred
 * and run through a Sobel filter; the path between two taps is the cheapest way along strong
 * edges ("live wire"), kept to a corridor around the straight line so it cannot wander off
 * along windows or shingles.
 */
import type { Pt } from './geometry';

export interface EdgeMap {
  w: number;
  h: number;
  /** Photo pixels per map pixel. */
  scale: number;
  /** Edge strength per map pixel, 0..1. */
  mag: Float32Array;
}

/** Edge strength from RGBA pixels (w × h); `scale` is photo pixels per pixel here. */
export function edgeMapFromPixels(rgba: Uint8ClampedArray, w: number, h: number, scale: number): EdgeMap {
  const grey = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  // A light 3 × 3 blur so photo noise does not look like edges.
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += grey[yy * w + xx];
          n++;
        }
      blur[y * w + x] = s / n;
    }
  }
  const mag = new Float32Array(w * h);
  const at = (x: number, y: number) => blur[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  }
  // Normalise to the strong edges of this photo (the 97th percentile counts as full strength).
  const sorted = Float32Array.from(mag).sort();
  const top = sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] || 1;
  for (let i = 0; i < mag.length; i++) mag[i] = Math.min(1, mag[i] / top);
  return { w, h, scale, mag };
}

/** The strongest edge within `radius` photo pixels of a point (or the point itself). */
export function snapPoint(map: EdgeMap, p: Pt, radius: number): Pt {
  const r = Math.max(1, Math.round(radius / map.scale));
  const cx = Math.round(p[0] / map.scale);
  const cy = Math.round(p[1] / map.scale);
  let best = -1;
  let bx = cx;
  let by = cy;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      // Strong edges win; among equals, the nearest.
      const score = map.mag[y * map.w + x] - 0.002 * Math.hypot(x - cx, y - cy);
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return best >= 0.3 ? [bx * map.scale, by * map.scale] : p;
}

/** Douglas-Peucker: drop points closer than `tol` to the line through their neighbours. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [x0, y0] = points[i];
    const [x1, y1] = points[j];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    let far = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((x1 - x0) * (y0 - points[k][1]) - (x0 - points[k][0]) * (y1 - y0)) / len;
      if (d > far) {
        far = d;
        at = k;
      }
    }
    if (far > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** A small binary heap of [cost, index]. */
class Heap {
  private c: number[] = [];
  private v: number[] = [];
  get size() {
    return this.c.length;
  }
  push(cost: number, i: number) {
    const c = this.c;
    const v = this.v;
    c.push(cost);
    v.push(i);
    let k = c.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (c[p] <= c[k]) break;
      [c[p], c[k]] = [c[k], c[p]];
      [v[p], v[k]] = [v[k], v[p]];
      k = p;
    }
  }
  pop(): [number, number] {
    const c = this.c;
    const v = this.v;
    const top: [number, number] = [c[0], v[0]];
    const lc = c.pop()!;
    const lv = v.pop()!;
    if (c.length) {
      c[0] = lc;
      v[0] = lv;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === k) break;
        [c[m], c[k]] = [c[k], c[m]];
        [v[m], v[k]] = [v[k], v[m]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * The run from `a` to `b` (photo pixels) along the strongest edges, within a corridor around
 * the straight line, simplified to a few points. Returns the points after `a`, ending at `b`.
 * Falls back to the straight line when the edges do not help.
 */
export function traceEdge(map: EdgeMap, a: Pt, b: Pt): Pt[] {
  const s = map.scale;
  const ax = Math.round(a[0] / s);
  const ay = Math.round(a[1] / s);
  const bx = Math.round(b[0] / s);
  const by = Math.round(b[1] / s);
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 4) return [b];
  const corridor = Math.max(4, len * 0.12);
  const inCorridor = (x: number, y: number) => {
    // Distance from the segment a–b.
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
    return Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)) <= corridor;
  };
  const { w, h, mag } = map;
  const dist = new Float64Array(w * h).fill(Infinity); // same precision as the heap, or nodes get skipped
  const from = new Int32Array(w * h).fill(-1);
  const start = ay * w + ax;
  const goal = by * w + bx;
  if (ax < 0 || ay < 0 || ax >= w || ay >= h || bx < 0 || by < 0 || bx >= w || by >= h) return [b];
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size) {
    const [d, i] = heap.pop();
    if (i === goal) break;
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !inCorridor(nx, ny)) continue;
        const j = ny * w + nx;
        // Cheap along strong edges, dear across flat areas.
        const step = (dx && dy ? Math.SQRT2 : 1) * (0.04 + (1 - mag[j]) ** 2);
        if (d + step < dist[j]) {
          dist[j] = d + step;
          from[j] = i;
          heap.push(d + step, j);
        }
      }
    }
  }
  if (from[goal] < 0) return [b];
  const cells: Pt[] = [];
  for (let i = goal; i !== start && i >= 0; i = from[i]) cells.push([(i % w) * s, Math.floor(i / w) * s]);
  cells.push([ax * s, ay * s]);
  cells.reverse();
  // Only worth it when the path really runs along edges; otherwise keep the straight line.
  let strength = 0;
  for (const [x, y] of cells) strength += mag[Math.round(y / s) * w + Math.round(x / s)];
  if (strength / cells.length < 0.35) return [b];
  const pts = simplify(cells, 1.2 * s);
  pts[pts.length - 1] = b;
  return pts.slice(1);
}

const cache = new Map<string, Promise<EdgeMap>>();

/** The edge map of a photo, worked out once per photo (about 640 px across). */
export function loadEdgeMap(photoUrl: string, width: number, height: number): Promise<EdgeMap> {
  const hit = cache.get(photoUrl);
  if (hit) return hit;
  const job = new Promise<EdgeMap>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 640 / Math.max(width, height));
      const w = Math.max(8, Math.round(width * k));
      const h = Math.max(8, Math.round(height * k));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('No canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(edgeMapFromPixels(ctx.getImageData(0, 0, w, h).data, w, h, width / w));
    };
    img.onerror = () => reject(new Error('Could not read the photo'));
    img.src = photoUrl;
  });
  cache.set(photoUrl, job);
  job.catch(() => cache.delete(photoUrl));
  return job;
}
