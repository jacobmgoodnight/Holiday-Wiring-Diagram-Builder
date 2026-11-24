/**
 * Follow edges in the photo (pure, apart from loadEdgeMap): tap two roof corners and the run
 * follows the roof edge between them. The photo is shrunk, lightly blurred and run through a
 * Sobel filter on each colour (so blue sky over a grey roof of the same brightness still
 * counts); the path between two taps is the cheapest way along strong edges ("live wire"),
 * kept to a corridor around the straight line so it cannot wander off along windows or
 * shingles, and preferring edges that run the way of the line. Tuned on real house photos:
 * - the run may end anywhere on an edge near the tap (and start anywhere near the first tap),
 *   so it stays on one edge instead of hooking onto a gutter return or hopping between the
 *   parallel lines of the drip edge and trim board to reach an exact snapped point;
 * - roof edges are straight, so a path that stays close to a straight line becomes one.
 */
import type { Pt } from './geometry';

export interface EdgeMap {
  w: number;
  h: number;
  /** Photo pixels per map pixel. */
  scale: number;
  /** Edge strength per map pixel, 0..1. */
  mag: Float32Array;
  /** Unit gradient (across the edge) per map pixel. */
  nx: Float32Array;
  ny: Float32Array;
}

/** A light 3 × 3 blur so photo noise does not look like edges. */
function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = x > 0 ? src[i - 1] : src[i];
      const r = x < w - 1 ? src[i + 1] : src[i];
      tmp[i] = (l + src[i] + r) / 3;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = y > 0 ? tmp[i - w] : tmp[i];
      const d = y < h - 1 ? tmp[i + w] : tmp[i];
      out[i] = (u + tmp[i] + d) / 3;
    }
  return out;
}

/** Edge strength and direction from RGBA pixels (w × h); `scale` is photo pixels per pixel here. */
export function edgeMapFromPixels(rgba: Uint8ClampedArray, w: number, h: number, scale: number): EdgeMap {
  const chans = [0, 1, 2].map((c) => {
    const a = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = rgba[i * 4 + c];
    return blur3(a, w, h);
  });
  const mag = new Float32Array(w * h);
  const nx = new Float32Array(w * h);
  const ny = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      // Sobel on each colour; the strongest one counts.
      let best = 0;
      let bgx = 0;
      let bgy = 0;
      for (const b of chans) {
        const gx = b[y0 * w + x1] + 2 * b[y * w + x1] + b[y1 * w + x1] - b[y0 * w + x0] - 2 * b[y * w + x0] - b[y1 * w + x0];
        const gy = b[y1 * w + x0] + 2 * b[y1 * w + x] + b[y1 * w + x1] - b[y0 * w + x0] - 2 * b[y0 * w + x] - b[y0 * w + x1];
        const m = gx * gx + gy * gy;
        if (m > best) {
          best = m;
          bgx = gx;
          bgy = gy;
        }
      }
      const i = y * w + x;
      const m = Math.sqrt(best);
      mag[i] = m;
      if (m > 0) {
        nx[i] = bgx / m;
        ny[i] = bgy / m;
      }
    }
  }
  // Normalise to the strong edges of this photo (the 97th percentile counts as full strength).
  const sorted = Float32Array.from(mag).sort();
  const top = sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] || 1;
  for (let i = 0; i < mag.length; i++) mag[i] = Math.min(1, mag[i] / top);
  return { w, h, scale, mag, nx, ny };
}

/**
 * The strongest edge within `radius` photo pixels of a point (or the point itself). With
 * `dir`, edges running that way win (the roof line being drawn, not a gutter across it).
 */
export function snapPoint(map: EdgeMap, p: Pt, radius: number, dir?: Pt): Pt {
  const r = Math.max(1, Math.round(radius / map.scale));
  const cx = Math.round(p[0] / map.scale);
  const cy = Math.round(p[1] / map.scale);
  const dl = dir ? Math.hypot(dir[0], dir[1]) : 0;
  const ux = dl ? dir![0] / dl : 0;
  const uy = dl ? dir![1] / dl : 0;
  let best = -Infinity;
  let bx = cx;
  let by = cy;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * map.w + x;
      let m = map.mag[i];
      if (dl) m *= (-map.ny[i] * ux + map.nx[i] * uy) ** 2; // along the line, not across it
      // Strong edges win, but a nearer edge beats a slightly stronger one further away.
      const score = m - (0.35 * Math.hypot(x - cx, y - cy)) / r;
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return map.mag[by * map.w + bx] >= 0.3 ? [bx * map.scale, by * map.scale] : p;
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

/** Where a run along the edge begins (it may move a little when it was free) and its points after that. */
export interface Followed {
  start: Pt;
  points: Pt[];
}

/** Cost of ending a run one map pixel away from where it was meant to end. */
const END_COST = 0.3;
/** Ends of a run must be on an edge at least this strong. */
const END_EDGE = 0.3;

/**
 * The run from `from` toward `tap` (photo pixels) along the strongest edges, within a
 * corridor around the straight line. It may end on any edge within `radius` of the tap (and,
 * with `freeStart`, begin on any edge within `radius` of `from`); ending further from the tap
 * costs a little, so it ends as near the tap as the edge goes. The path is straightened (or
 * simplified to a few points). Falls back to the straight line, with its ends snapped, when
 * the edges do not help.
 */
export function followEdge(map: EdgeMap, from: Pt, tap: Pt, radius: number, opts: { freeStart?: boolean } = {}): Followed {
  const s = map.scale;
  const { w, h, mag, nx, ny } = map;
  const freeStart = !!opts.freeStart;
  const fx = from[0] / s;
  const fy = from[1] / s;
  const tx = tap[0] / s;
  const ty = tap[1] / s;
  const R = Math.max(1, radius / s);
  const len = Math.hypot(tx - fx, ty - fy);
  const way: Pt = [tap[0] - from[0], tap[1] - from[1]];
  const straight = (): Followed => ({ start: freeStart ? snapPoint(map, from, radius, way) : from, points: [snapPoint(map, tap, radius, way)] });
  const sx = Math.round(fx);
  const sy = Math.round(fy);
  if (len < 4 || sx < 0 || sy < 0 || sx >= w || sy >= h) return straight();
  const ux = (tx - fx) / len;
  const uy = (ty - fy) / len;
  const corridor = Math.max(4, len * 0.12);
  /** Distance from the segment from–tap (map pixels). */
  const off = (x: number, y: number) => {
    const t = Math.max(0, Math.min(1, ((x - fx) * (tx - fx) + (y - fy) * (ty - fy)) / (len * len)));
    return Math.hypot(x - (fx + (tx - fx) * t), y - (fy + (ty - fy) * t));
  };
  const x0 = Math.max(0, Math.floor(Math.min(fx, tx) - corridor - R));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(fx, tx) + corridor + R));
  const y0 = Math.max(0, Math.floor(Math.min(fy, ty) - corridor - R));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(fy, ty) + corridor + R));
  const dist = new Float64Array(w * h).fill(Infinity); // same precision as the heap, or nodes get skipped
  const prev = new Int32Array(w * h).fill(-1);
  const heap = new Heap();
  const seed = (i: number, cost: number) => {
    if (cost < dist[i]) {
      dist[i] = cost;
      heap.push(cost, i);
    }
  };
  if (freeStart) {
    for (let y = Math.max(0, Math.floor(fy - R)); y <= Math.min(h - 1, Math.ceil(fy + R)); y++)
      for (let x = Math.max(0, Math.floor(fx - R)); x <= Math.min(w - 1, Math.ceil(fx + R)); x++) {
        const d = Math.hypot(x - fx, y - fy);
        if (d <= R && mag[y * w + x] >= END_EDGE) seed(y * w + x, END_COST * d);
      }
    seed(sy * w + sx, 0.5); // starting off the edge is allowed, but dearer
  } else seed(sy * w + sx, 0);
  let best = Infinity;
  let bestAt = -1;
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d >= best) break; // nothing cheaper can come
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    const dt = Math.hypot(x - tx, y - ty);
    if (dt <= R && mag[i] >= END_EDGE && d + END_COST * dt < best) {
      best = d + END_COST * dt;
      bestAt = i;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue;
        const o = off(xx, yy);
        if (o > corridor && Math.hypot(xx - tx, yy - ty) > R && Math.hypot(xx - fx, yy - fy) > R) continue;
        const j = yy * w + xx;
        const m = mag[j];
        const L = dx && dy ? Math.SQRT2 : 1;
        const across = Math.abs(nx[j] * dx + ny[j] * dy) / L; // 0 when stepping along the edge
        const along = -ny[j] * ux + nx[j] * uy; // ±1 when the edge runs the way of the line
        // Cheap along strong edges that run the way of the line; dear across flat areas, across
        // edges, and a little dearer the further from the line (so it does not take a detour).
        const step = L * (0.04 + (1 - m) ** 2 + 0.6 * m * across * across + 0.6 * m * (1 - along * along) + 0.12 * (Math.min(o, corridor) / corridor) ** 2);
        if (d + step < dist[j]) {
          dist[j] = d + step;
          prev[j] = i;
          heap.push(d + step, j);
        }
      }
    }
  }
  if (bestAt < 0) return straight();
  const cells: Pt[] = [];
  for (let i = bestAt; i >= 0; i = prev[i]) cells.push([(i % w) * s, Math.floor(i / w) * s]);
  cells.reverse();
  // Only worth it when the path really runs along edges; otherwise keep the straight line.
  let strength = 0;
  for (const [x, y] of cells) strength += mag[Math.round(y / s) * w + Math.round(x / s)];
  if (strength / cells.length < 0.35) return straight();
  // Roof edges are straight: a path that stays near the straight line between its ends
  // becomes that line (haze and photo noise make the raw path wobble).
  const [ax, ay] = cells[0];
  const [bx, by] = cells[cells.length - 1];
  const cl = Math.hypot(bx - ax, by - ay) || 1;
  let dev = 0;
  for (const [x, y] of cells) dev = Math.max(dev, Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / cl);
  const pts = dev <= Math.max(3 * s, 0.03 * cl) ? [cells[0], cells[cells.length - 1]] : simplify(cells, 2 * s);
  if (pts.length < 2) return straight();
  // Carry the ends on along their straight edge while that brings them nearer the taps, so a
  // tap beside a corner ends at the corner (the path itself may stop a little short there).
  const n = pts.length;
  pts[n - 1] = extend(map, pts[n - 2], pts[n - 1], tap, R);
  if (freeStart) pts[0] = extend(map, pts[1], pts[0], from, R);
  return { start: freeStart ? pts[0] : from, points: pts.slice(1) };
}

/** Move `end` on along the line from `back`, while it stays on an edge running that way and gets nearer `aim`. */
function extend(map: EdgeMap, back: Pt, end: Pt, aim: Pt, maxSteps: number): Pt {
  const s = map.scale;
  const { w, h, mag, nx, ny } = map;
  const ex = end[0] / s;
  const ey = end[1] / s;
  const l = Math.hypot(ex - back[0] / s, ey - back[1] / s);
  if (l < 1) return end;
  const ux = (ex - back[0] / s) / l;
  const uy = (ey - back[1] / s) / l;
  let best = 0;
  let near = Math.hypot(aim[0] / s - ex, aim[1] / s - ey);
  for (let t = 1; t <= maxSteps; t++) {
    const x = Math.round(ex + ux * t);
    const y = Math.round(ey + uy * t);
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    const i = y * w + x;
    if (mag[i] < END_EDGE || Math.abs(-ny[i] * ux + nx[i] * uy) < 0.8) break;
    const d = Math.hypot(aim[0] / s - (ex + ux * t), aim[1] / s - (ey + uy * t));
    if (d >= near) break;
    near = d;
    best = t;
  }
  return best ? [(ex + ux * best) * s, (ey + uy * best) * s] : end;
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
