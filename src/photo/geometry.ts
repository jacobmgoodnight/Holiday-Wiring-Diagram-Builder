/** Photo overlay geometry and look (pure). Placements are stored as 0..1 fractions. */
import { homeLink } from '../model/actions';
import { isRun, powerChildren, runSockets, socketLabels } from '../model/graph';
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

/** Scale from a line drawn over something of known length. */
export function feetPerPxFrom(a: Pt, b: Pt, feet: number, view: Pick<PhotoView, 'width' | 'height'>): number | undefined {
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

export const WARM = '#ffcf6e';
export const COOL = '#eef6ff';
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
/** Classic multicolour: red, green, blue, orange, yellow. */
const MULTI = ['#ff3b30', '#30d158', '#3a8bff', '#ff9f0a', '#ffd60a'];

/** Bulb colour choices offered when drawing and in an item's details. */
export const PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: 'warm', name: 'Warm white', colors: [WARM] },
  { id: 'cool', name: 'Cool white', colors: [COOL] },
  { id: 'multi', name: 'Multicolor', colors: MULTI },
  { id: 'red', name: 'Red', colors: ['#ff3b30'] },
  { id: 'green', name: 'Green', colors: ['#30d158'] },
  { id: 'blue', name: 'Blue', colors: ['#3a8bff'] },
  { id: 'purple', name: 'Purple', colors: ['#bf5af2'] },
  { id: 'orange', name: 'Orange', colors: ['#ff9f0a'] },
  { id: 'redwhite', name: 'Red & white', colors: ['#ff3b30', COOL] },
  { id: 'redgreen', name: 'Red & green', colors: ['#ff3b30', '#30d158'] },
  { id: 'rgw', name: 'Red, green & white', colors: ['#ff3b30', '#30d158', COOL] },
  { id: 'bluewhite', name: 'Blue & white', colors: ['#3a8bff', COOL] },
];

/** The palette these colours match, if any. */
export function paletteOf(colors: string[]): string | undefined {
  const key = colors.join(',').toLowerCase();
  return PALETTES.find((p) => p.colors.join(',').toLowerCase() === key)?.id;
}

/** Bulb colours for a light item, from its words (cycle through the list along the run). */
export function bulbColors(node: Pick<DisplayNode, 'label' | 'category' | 'color'> & { bulbColors?: string[] }): string[] {
  if (node.bulbColors?.length) return node.bulbColors;
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

/** Load categories drawn as lights on the photo (everything else is a marker). */
export const DRAWN_CATEGORIES = new Set(['c9', 'mini', 'icicle', 'pixel', 'pathway', 'tree']);

export function drawnAsLights(node: Pick<DisplayNode, 'kind' | 'category'>): boolean {
  return node.kind === 'load' && DRAWN_CATEGORIES.has(node.category ?? '');
}

/** Drawn as a run on the photo: lights, and SPT zip cord or multi-outlet cords with females. */
export function drawnAsRun(node: Pick<DisplayNode, 'kind' | 'category' | 'subtype'>): boolean {
  return drawnAsLights(node) || (node.kind === 'cord' && isRun(node));
}

/** Net lights, bush wraps and lit trees are outlined as an area instead of a run. */
export function drawsAsArea(node: Pick<DisplayNode, 'label' | 'category'>): boolean {
  return node.category === 'tree' || /\b(net|nets|bush|bushes|shrubs?|hedges?|boxwood)\b/i.test(node.label);
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

/** Default bulb spacing in inches: C9/C7 and ground stakes 12", minis and icicles 4". */
export const DEFAULT_SPACING_IN: Record<RunStyle, number> = { c9: 12, pathway: 12, mini: 4, icicle: 4, pixel: 4, plain: 12 };

export function spacingInOf(node: Pick<DisplayNode, 'category' | 'spacingIn'>): number {
  return node.spacingIn && node.spacingIn > 0 ? node.spacingIn : DEFAULT_SPACING_IN[runStyle(node)];
}

/** One foot on the photo in pixels: real once the scale is known, else 1% of the photo. */
export function footPx(view: Pick<PhotoView, 'width' | 'height' | 'feetPerPx'>): number {
  return view.feetPerPx ? 1 / view.feetPerPx : Math.max(view.width, view.height) / 100;
}

/** Spacing between bulbs, in photo pixels: real spacing when the scale is known. */
export function bulbSpacingPx(node: Pick<DisplayNode, 'category' | 'spacingIn'>, view: Pick<PhotoView, 'width' | 'height' | 'feetPerPx'>): number {
  return Math.max(2, (spacingInOf(node) / 12) * footPx(view));
}

/** About how many bulbs fit on a run of this length (one at each end). */
export function bulbCount(lengthFt: number, spacingIn: number): number {
  return lengthFt > 0 && spacingIn > 0 ? Math.floor((lengthFt * 12) / spacingIn + 1e-9) + 1 : 0;
}

// ---- Curves

/**
 * Rounded corners: each corner becomes a curve that cuts inside it (like a cable or a row of
 * ground stakes turning a corner), reaching up to halfway along the segments on either side,
 * so a few taps make one smooth curve. Ends stay put; `closed` rounds every corner of a ring.
 */
export function smoothPath(points: Pt[], closed = false, steps = 10): Pt[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const out: Pt[] = [];
  const corner = (prev: Pt, p: Pt, next: Pt) => {
    const d1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const d2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    if (!d1 || !d2) {
      out.push(p);
      return;
    }
    const r = Math.min(d1, d2) / 2;
    const a: Pt = [p[0] + ((prev[0] - p[0]) * r) / d1, p[1] + ((prev[1] - p[1]) * r) / d1];
    const b: Pt = [p[0] + ((next[0] - p[0]) * r) / d2, p[1] + ((next[1] - p[1]) * r) / d2];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const m = 1 - t;
      out.push([m * m * a[0] + 2 * m * t * p[0] + t * t * b[0], m * m * a[1] + 2 * m * t * p[1] + t * t * b[1]]);
    }
  };
  if (closed) {
    for (let i = 0; i < n; i++) corner(points[(i - 1 + n) % n], points[i], points[(i + 1) % n]);
    out.push(out[0]);
    return out;
  }
  out.push(points[0]);
  for (let i = 1; i < n - 1; i++) corner(points[i - 1], points[i], points[i + 1]);
  out.push(points[n - 1]);
  return out;
}

/**
 * The drawn shape of a placement in photo pixels: a run (smoothed when asked), or the closed,
 * always-rounded outline of a lit bush. Undefined for a point.
 */
export function shapePx(placement: Placement, view: Pick<PhotoView, 'width' | 'height'>, smooth?: boolean): Pt[] | undefined {
  if (placement.kind === 'point') return undefined;
  const px = placement.points.map((p) => toPx(p, view));
  if (placement.kind === 'area') return smoothPath(px, true);
  return smooth ? smoothPath(px) : px;
}

/** Length of a drawn run in feet, or undefined until the photo has a scale. */
export function runLengthFt(placement: Placement, view: PhotoView, smooth?: boolean): number | undefined {
  if (placement.kind !== 'path' || !view.feetPerPx) return undefined;
  return polylineLength(shapePx(placement, view, smooth)!) * view.feetPerPx;
}

/** Width and height of a lit bush in feet, once the photo has a scale. */
export function areaSizeFt(placement: Placement, view: PhotoView): { w: number; h: number } | undefined {
  if (placement.kind !== 'area' || !view.feetPerPx) return undefined;
  const b = bounds(shapePx(placement, view)!);
  return { w: (b.x1 - b.x0) * view.feetPerPx, h: (b.y1 - b.y0) * view.feetPerPx };
}

export function bounds(points: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

export function insidePolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Nearest point on a polyline, and how far along it that is (0..1). */
export function nearestOnPolyline(points: Pt[], p: Pt): { at: Pt; along: number } {
  if (points.length < 2) return { at: points[0] ?? p, along: 0 };
  const total = polylineLength(points) || 1;
  let best = { at: points[0], along: 0, d: Infinity };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2)) : 0;
    const q: Pt = [x0 + dx * t, y0 + dy * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { at: q, along: (walked + Math.sqrt(len2) * t) / total, d };
    walked += Math.sqrt(len2);
  }
  return { at: best.at, along: best.along };
}

/** The point a fraction (0..1) of the way along a polyline. */
export function pointAlong(points: Pt[], along: number): Pt {
  if (points.length < 2) return points[0] ?? [0, 0];
  let left = Math.min(1, Math.max(0, along)) * polylineLength(points);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (left <= seg && seg > 0) return [x0 + ((x1 - x0) * left) / seg, y0 + ((y1 - y0) * left) / seg];
    left -= seg;
  }
  return points[points.length - 1];
}

/**
 * Where a run's `n` inline females sit (0..1 along it): the stored positions in order, and
 * any others spread evenly after the last stored one.
 */
export function tapPositions(placement: Placement, n: number): number[] {
  if (n <= 0) return [];
  const given = placement.kind === 'path' ? (placement.taps ?? []).slice(0, n) : [];
  const out = [...given];
  const last = given.length ? given[given.length - 1] : 0;
  const m = n - given.length;
  for (let k = 1; k <= m; k++) out.push(last + ((1 - last) * k) / (m + 1));
  return out;
}

export interface SocketSpot {
  /** Socket name: tap1, tap2… or end. */
  port: string;
  /** Photo pixels. */
  at: Pt;
  /** 0..1 along the run. */
  along: number;
  /** Inline females only: 0 for tap1. */
  index?: number;
  /** What is plugged in there. */
  childId?: string;
}

/**
 * The females of a run drawn on this photo: inline ones at their positions, the end one at
 * the end. Undefined when it is not drawn here as a run or its socket count is unknown.
 */
export function runSocketSpots(display: Display, nodeId: string, view: PhotoView): SocketSpot[] | undefined {
  const node = display.nodes[nodeId];
  const placement = node?.placements?.[view.id];
  if (!placement || placement.kind !== 'path') return undefined;
  const names = runSockets(node);
  if (!names) return undefined;
  const shape = shapePx(placement, view, node.smooth)!;
  const pos = tapPositions(placement, names.filter((x) => x !== 'end').length);
  const labels = socketLabels(display, nodeId);
  const plugged = new Map<string, string>();
  for (const l of powerChildren(display, nodeId)) {
    const lab = labels.get(l.id);
    if (lab && l.to) plugged.set(lab, l.to);
  }
  return names.map((port, i) =>
    port === 'end'
      ? { port, at: shape[shape.length - 1], along: 1, childId: plugged.get(port) }
      : { port, at: pointAlong(shape, pos[i]), along: pos[i], index: i, childId: plugged.get(port) },
  );
}

/** The nearest open female on any run on this photo, within `maxPx` of `p`. */
export function nearestOpenSocket(display: Display, view: PhotoView, p: Pt, maxPx: number, exclude?: string): { parent: string; port: string; at: Pt } | undefined {
  let best: { parent: string; port: string; at: Pt; d: number } | undefined;
  for (const n of Object.values(display.nodes)) {
    if (n.id === exclude) continue;
    for (const s of runSocketSpots(display, n.id, view) ?? []) {
      if (s.childId) continue;
      const d = Math.hypot(s.at[0] - p[0], s.at[1] - p[1]);
      if (d <= maxPx && (!best || d < best.d)) best = { parent: n.id, port: s.port, at: s.at, d };
    }
  }
  return best && { parent: best.parent, port: best.port, at: best.at };
}

/** Feet between two photo points (a rough figure: the photo is flat, the house is not). */
export function gapFt(a: Pt, b: Pt, view: Pick<PhotoView, 'width' | 'height' | 'feetPerPx'>): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / footPx(view);
}

/** Common outdoor extension cord lengths. */
export const CORD_SIZES_FT = [3, 6, 9, 15, 25, 40, 50, 75, 100];

/** The shortest common cord that spans a gap, with some slack for going around things. */
export function cordFor(gap: number): number {
  const need = gap * 1.15 + 1;
  return CORD_SIZES_FT.find((s) => s >= need) ?? Math.ceil(need / 50) * 50;
}

export type AreaStyle = 'net' | 'wrap';

/** Net lights make a diamond mesh; anything else is wrapped through the bush. */
export function areaStyle(node: Pick<DisplayNode, 'label' | 'category'>): AreaStyle {
  return /\bnet\b/i.test(node.label) || node.category === 'icicle' ? 'net' : 'wrap';
}

/** Small deterministic jitter, so wrapped bulbs stay put between renders. */
const jitter = (i: number, j: number, salt: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};

/**
 * Bulbs covering a closed outline. Net: a diamond lattice `spacing` apart (every `stride`th
 * node when zoomed out). Wrap: a jittered grid in a back-and-forth order, like a string
 * woven through the branches. Capped so a huge bush cannot stall the page.
 */
export function areaBulbs(ring: Pt[], spacing: number, style: AreaStyle, max = 1500): Pt[] {
  if (ring.length < 3 || spacing <= 0) return [];
  const b = bounds(ring);
  const out: Pt[] = [];
  if (style === 'net') {
    const h = spacing / Math.SQRT2; // lattice nodes are `spacing` apart along the mesh
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const span = Math.ceil(Math.max(b.x1 - b.x0, b.y1 - b.y0) / h / 2) + 1;
    for (let j = -span; j <= span; j++) {
      for (let i = -span; i <= span; i++) {
        if ((i + j) % 2 !== 0) continue;
        const p: Pt = [cx + i * h, cy + j * h];
        if (insidePolygon(p, ring)) out.push(p);
        if (out.length >= max) return out;
      }
    }
    return out;
  }
  const rows = Math.max(1, Math.round((b.y1 - b.y0) / spacing));
  const cols = Math.max(1, Math.round((b.x1 - b.x0) / spacing));
  for (let j = 0; j <= rows; j++) {
    const row: Pt[] = [];
    for (let i = 0; i <= cols; i++) {
      const p: Pt = [b.x0 + i * spacing + jitter(i, j, 1) * spacing * 0.8, b.y0 + j * spacing + jitter(i, j, 2) * spacing * 0.8];
      if (insidePolygon(p, ring)) row.push(p);
    }
    out.push(...(j % 2 ? row.reverse() : row));
    if (out.length >= max) return out.slice(0, max);
  }
  return out;
}

// ---- Wiring

/** Cable colours for cord colour words. */
const CABLE: Record<string, string> = {
  green: '#2f6b3a',
  orange: '#f07f1a',
  black: '#1d1d1f',
  white: '#ececec',
  brown: '#6b4a2b',
  yellow: '#efc300',
  blue: '#2f6fd6',
  red: '#cc2b2b',
  grey: '#8a8f98',
  gray: '#8a8f98',
  clear: '#d9e3e6',
};
export const WIRE_COLORS = ['green', 'white', 'black', 'brown'] as const;

export function cableColor(word: string | undefined): string | undefined {
  return word ? CABLE[word.toLowerCase()] : undefined;
}

/** Wire colour of a light run (default green, like most C9 stringers and minis). */
export function wireColorOf(node: Pick<DisplayNode, 'wireColor' | 'color'>): string {
  return cableColor(node.wireColor) ?? cableColor(node.color) ?? CABLE.green;
}

/** Where a cable leaves an item: a marker's centre, or the plug end (first point) of a run or bush. */
export function plugPoint(p: Placement, view: Pick<PhotoView, 'width' | 'height'>): Pt {
  return toPx(p.kind === 'point' ? [p.x, p.y] : p.points[0], view);
}

export interface WiringLine {
  childId: string;
  parentId: string;
  /** Photo pixels: where it plugs in on the parent (socket end, inline female, marker). */
  from: Pt;
  /** Photo pixels: the child's plug. */
  to: Pt;
  /** Cable colour: the unplaced cord in between, or the child's own lead. */
  color: string;
  /** Cords in between that are not on the photo, e.g. ["C01"]. */
  via: string[];
  /** Straight-line length in feet, once the photo has a scale. */
  lengthFt?: number;
}

/**
 * A cable from each placed item to the nearest placed item upstream of it. On a light run it
 * attaches at the end female for `end`, otherwise at the nearest point (an inline female).
 */
export function wiringLines(display: Display, view: PhotoView): WiringLine[] {
  const out: WiringLine[] = [];
  for (const n of Object.values(display.nodes)) {
    const mine = n.placements?.[view.id];
    if (!mine) continue;
    let cur = homeLink(display, n.id);
    const seen = new Set([n.id]);
    const via: string[] = [];
    while (cur && cur.kind === 'power' && !seen.has(cur.from)) {
      seen.add(cur.from);
      const parent = display.nodes[cur.from];
      const up = parent?.placements?.[view.id];
      if (up) {
        const to = plugPoint(mine, view);
        let from = plugPoint(up, view);
        const shape = shapePx(up, view, parent.smooth);
        if (shape) {
          const port = socketLabels(display, parent.id).get(cur.id);
          const spot = runSocketSpots(display, parent.id, view)?.find((x) => x.port === port);
          from = spot ? spot.at : port === 'end' && up.kind === 'path' ? shape[shape.length - 1] : nearestOnPolyline(shape, to).at;
        }
        const cord = via.length ? display.nodes[via[0]] : undefined; // the cord this item plugs into
        const color = cableColor(cord?.color) ?? (n.kind === 'load' ? wireColorOf(n) : cableColor(n.color)) ?? CABLE.green;
        out.push({ childId: n.id, parentId: parent.id, from, to, color, via: [...via].reverse(), lengthFt: view.feetPerPx ? gapFt(from, to, view) : undefined });
        break;
      }
      if (parent?.kind === 'cord') via.push(parent.id);
      cur = homeLink(display, cur.from);
    }
  }
  return out;
}

/** A hanging cable between two points: a quadratic curve that sags a little. */
export function cablePath(a: Pt, b: Pt): string {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const sag = Math.min(d * 0.18, 400);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2 + sag;
  return `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
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
