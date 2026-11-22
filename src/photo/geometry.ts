/** Photo overlay geometry and look (pure). Placements are stored as 0..1 fractions. */
import { homeLink } from '../model/actions';
import type { Display, DisplayNode, Placement, PhotoView } from '../model/types';
import { clusterMembers } from '../diagram/layout';

export type Pt = [number, number];

export const toPx = (p: Pt, v: Pick<PhotoView, 'width' | 'height'>): Pt => [p[0] * v.width, p[1] * v.height];
export const toFrac = (p: Pt, v: Pick<PhotoView, 'width' | 'height'>): Pt => [clamp01(p[0] / v.width), clamp01(p[1] / v.height)];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function polylineLength(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

/** Length of a drawn run in feet, or undefined until the photo has a scale. */
export function runLengthFt(placement: Placement, view: PhotoView): number | undefined {
  if (placement.kind !== 'path' || !view.feetPerPx) return undefined;
  return polylineLength(placement.points.map((p) => toPx(p, view))) * view.feetPerPx;
}

/** Scale from a line drawn over something of known length. */
export function feetPerPxFrom(a: Pt, b: Pt, feet: number, view: PhotoView): number | undefined {
  const px = polylineLength([toPx(a, view), toPx(b, view)]);
  return px > 0 && feet > 0 ? feet / px : undefined;
}

/** Evenly spaced points along a polyline (pixel space), starting at its first point. */
export function pointsAlong(points: Pt[], spacing: number): Pt[] {
  if (!points.length) return [];
  if (spacing <= 0) return [points[0]];
  const out: Pt[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  return out.slice(0, 2000);
}

const WARM = '#ffcf6e';
const COOL = '#eef6ff';
const NAMED: [RegExp, string][] = [
  [/\bwarm\b/, WARM],
  [/\b(cool|pure|bright) white\b/, COOL],
  [/\bred\b/, '#ff3b30'],
  [/\bgreen\b/, '#30d158'],
  [/\bblue\b/, '#3a8bff'],
  [/\b(purple|violet)\b/, '#bf5af2'],
  [/\borange\b/, '#ff9f0a'],
  [/\b(pink)\b/, '#ff6fb5'],
  [/\b(yellow|gold)\b/, '#ffd60a'],
  [/\bwhite\b/, COOL],
];
const MULTI = ['#ff3b30', '#30d158', '#3a8bff', '#ff9f0a', '#bf5af2'];

/** Bulb colours for a light item, from its words (cycle through the list along the run). */
export function bulbColors(node: Pick<DisplayNode, 'label' | 'category' | 'color'>): string[] {
  const t = node.label.toLowerCase();
  if (/\b(multi|multicolou?r|rainbow)\b/.test(t) || node.category === 'pixel') return MULTI;
  // "warm white" is one colour, not warm plus white: match bare "white" only outside it.
  const bare = t.replace(/\b(warm|cool|pure|bright) white\b/g, '$1');
  const found = NAMED.filter(([re], i) => (i === NAMED.length - 1 ? re.test(bare) : re.test(t))).map(([, c]) => c);
  if (/\b(red and white|candy ?cane)\b/.test(t)) return ['#ff3b30', COOL];
  if (found.length) return [...new Set(found)].slice(0, 3);
  if (node.color) {
    const c = NAMED.find(([re]) => re.test(node.color!));
    if (c && node.color !== 'black' && node.color !== 'brown' && node.color !== 'grey') return [c[1]];
  }
  return [WARM];
}

export type RunStyle = 'c9' | 'mini' | 'icicle' | 'pixel' | 'pathway' | 'plain';

export function runStyle(node: Pick<DisplayNode, 'category'>): RunStyle {
  switch (node.category) {
    case 'c9':
    case 'mini':
    case 'icicle':
    case 'pixel':
    case 'pathway':
      return node.category;
    case 'tree':
    case 'wreath':
      return 'mini';
    default:
      return 'plain';
  }
}

/** Spacing between drawn bulbs, in photo pixels: real spacing when the scale is known. */
export function bulbSpacingPx(style: RunStyle, view: PhotoView): number {
  const feet = style === 'c9' ? 1 : style === 'pathway' ? 3 : style === 'pixel' ? 0.33 : 0.33; // C9 ~12 in apart
  if (view.feetPerPx) return Math.max(3, feet / view.feetPerPx);
  const base = Math.max(view.width, view.height) / 100;
  return style === 'c9' ? base : style === 'pathway' ? base * 3 : base * 0.45;
}

/** Where wiring lines attach: a point, or the first point of a run (where it plugs in). */
export function anchorOf(p: Placement): Pt {
  return p.kind === 'point' ? [p.x, p.y] : p.points[0];
}

export interface WiringLine {
  childId: string;
  parentId: string;
  from: Pt;
  to: Pt;
}

/** Dashed lines from each placed item to the nearest placed item upstream of it. */
export function wiringLines(display: Display, viewId: string): WiringLine[] {
  const out: WiringLine[] = [];
  for (const n of Object.values(display.nodes)) {
    const mine = n.placements?.[viewId];
    if (!mine) continue;
    let cur = homeLink(display, n.id);
    const seen = new Set([n.id]);
    while (cur && cur.kind === 'power' && !seen.has(cur.from)) {
      seen.add(cur.from);
      const up = display.nodes[cur.from]?.placements?.[viewId];
      if (up) {
        out.push({ childId: n.id, parentId: cur.from, from: anchorOf(up), to: anchorOf(mine) });
        break;
      }
      cur = homeLink(display, cur.from);
    }
  }
  return out;
}

/** Items not on this photo yet, outlet by outlet, for "Place from plan". */
export function unplaced(display: Display, viewId: string): DisplayNode[] {
  const out: DisplayNode[] = [];
  for (const g of clusterMembers(display)) for (const id of g.members) if (!display.nodes[id].placements?.[viewId]) out.push(display.nodes[id]);
  return out;
}

/** Fit an image inside max×max without enlarging it. */
export function fitWithin(w: number, h: number, max = 2048): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
