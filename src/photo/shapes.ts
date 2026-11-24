/**
 * Shapes for common decorations (pure, photo pixels): an outline around a window or door
 * from two corners, an arch from its feet, a wrap up a post or trunk from bottom to top,
 * and a mega tree (a fan of strands) from its top and the two sides of its base.
 */
import type { Pt } from './geometry';

export type DrawShape = 'free' | 'outline' | 'arch' | 'wrap';

/** Taps each shape needs. */
export const SHAPE_TAPS: Record<Exclude<DrawShape, 'free'>, number> = { outline: 2, arch: 2, wrap: 2 };

export const SHAPE_HINT: Record<DrawShape, string> = {
  free: 'Tap along the house',
  outline: 'Tap two opposite corners of the window or door',
  arch: 'Tap the two feet of the arch',
  wrap: 'Tap the bottom, then the top of the post or trunk',
};

/** A closed outline starting (and plugging in) at the first corner tapped. */
export function outlinePoints(a: Pt, b: Pt): Pt[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]], a];
}

/** A half-ellipse arch from foot `a` to foot `b`, as tall as half its width, bulging up. */
export function archPoints(a: Pt, b: Pt, steps = 16): Pt[] {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // Perpendicular to the feet, on the upper side of the photo.
  let n: Pt = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  if (n[1] > 0) n = [-n[0], -n[1]];
  const h = len / 2;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (Math.PI * i) / steps;
    out.push([m[0] + (a[0] - m[0]) * Math.cos(t) + n[0] * h * Math.sin(t), m[1] + (a[1] - m[1]) * Math.cos(t) + n[1] * h * Math.sin(t)]);
  }
  return out;
}

/**
 * A wrap up a post or trunk from `bottom` to `top`: the front of the spiral, crossing from
 * side to side. Width is about an eighth of the height (a porch post or a small trunk), one
 * turn every 1.5 widths.
 */
export function wrapPoints(bottom: Pt, top: Pt, width?: number): Pt[] {
  const len = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
  if (len < 1) return [bottom, top];
  const w = width ?? Math.max(len / 8, 6);
  const along: Pt = [(top[0] - bottom[0]) / len, (top[1] - bottom[1]) / len];
  const side: Pt = [-along[1], along[0]];
  const half = (w * 1.5) / 2; // half a turn between crossings
  const crossings = Math.max(2, Math.round(len / half));
  const out: Pt[] = [];
  for (let i = 0; i <= crossings; i++) {
    const d = (len * i) / crossings;
    const s = (i % 2 === 0 ? -1 : 1) * (w / 2);
    out.push([bottom[0] + along[0] * d + side[0] * s, bottom[1] + along[1] * d + side[1] * s]);
  }
  return out;
}

/** The points of a shape once it has all its taps (photo pixels), or undefined until then. */
export function shapePoints(shape: Exclude<DrawShape, 'free'>, taps: Pt[]): Pt[] | undefined {
  if (taps.length < SHAPE_TAPS[shape]) return undefined;
  const [a, b] = taps;
  if (shape === 'outline') return outlinePoints(a, b);
  if (shape === 'arch') return archPoints(a, b);
  return wrapPoints(a, b);
}

/** Mega tree strands, apex to base: `n` lines from the top to points across the base. */
export function megaTreeStrands(apex: Pt, left: Pt, right: Pt, n = 16): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push([apex, [left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t]]);
  }
  return out;
}

/** Strands on a mega tree (the common 16). */
export const MEGA_TREE_STRANDS = 16;
