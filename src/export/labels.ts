/**
 * Labels for the things you put up: small, so they read at a glance. The ID ties the thing to
 * the photo, the plan and the install sheet; the second line is what you need in your hand:
 * a cord's length ("C02 · 25 ft"), where lights go ("L02 · Garage peak"), or the gear's name.
 * Optionally where it plugs in, and the storage spot.
 *
 * Zip-tie marks (optional, per display): one colour per outlet, and as many ties as the story
 * the item goes on (1 = ground or first floor, 2 = second story).
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { powerChildren, socketLabels } from '../model/graph';
import type { Display, DisplayNode } from '../model/types';

export interface LabelOptions {
  /** Also label lights and props, not just cords and gear (default true). */
  includeLoads?: boolean;
  /** Cords get a label at each end (default true). */
  bothEnds?: boolean;
  /** Add where it plugs in and what plugs into it. */
  route?: boolean;
  /** Add the storage spot when one is set. */
  storage?: boolean;
}

export interface Ties {
  /** Zip-tie colour (a name from TIE_COLORS), when colours are on and the outlet has one. */
  color?: string;
  /** How many ties: the story (1 when stories are off). */
  count: number;
}

export interface Label {
  key: string;
  id: string;
  /** Big first line: the ID. */
  heading: string;
  /** Second line: length, place or name. */
  sub: string;
  /** Item name. */
  name: string;
  /** Which end of a cord this label goes on (both-end labels). */
  end?: 'plug' | 'far';
  /** "K01 left → S02" (when asked for). */
  route?: string;
  storage?: string;
  ties?: Ties;
  /** One-line text for label makers: "C02 25 ft". */
  text: string;
}

/** Zip-tie colours sold in mixed packs. Black, white and green blend in with light wire. */
export const TIE_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'red', name: 'Red', hex: '#dc2626' },
  { id: 'blue', name: 'Blue', hex: '#2563eb' },
  { id: 'yellow', name: 'Yellow', hex: '#facc15' },
  { id: 'orange', name: 'Orange', hex: '#f97316' },
  { id: 'purple', name: 'Purple', hex: '#9333ea' },
  { id: 'white', name: 'White', hex: '#f8fafc' },
  { id: 'black', name: 'Black', hex: '#111827' },
  { id: 'green', name: 'Green', hex: '#16a34a' },
  { id: 'pink', name: 'Pink', hex: '#ec4899' },
  { id: 'gray', name: 'Gray', hex: '#9ca3af' },
  { id: 'brown', name: 'Brown', hex: '#92400e' },
];
export const tieHex = (id: string | undefined) => TIE_COLORS.find((c) => c.id === id)?.hex;
export const tieName = (id: string | undefined) => TIE_COLORS.find((c) => c.id === id)?.name ?? id ?? '';

/** "1st", "2nd", "3rd". */
export const storyName = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** The outlet an item is powered from (walking up what it plugs into), if any. */
export function outletOf(display: Display, id: string): DisplayNode | undefined {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n: DisplayNode | undefined = display.nodes[cur];
    if (!n) return undefined;
    if (n.kind === 'outlet') return n;
    const home = homeLink(display, cur);
    cur = home?.kind === 'power' ? home.from : undefined;
  }
  return undefined;
}

/** The zip ties an item gets, or undefined when marks are off (outlets get none). */
export function tiesFor(display: Display, id: string): Ties | undefined {
  const m = display.marks;
  const n = display.nodes[id];
  if (!n || n.kind === 'outlet' || (!m?.colors && !m?.stories)) return undefined;
  const color = m.colors ? outletOf(display, id)?.tieColor : undefined;
  if (!m.stories && !color) return undefined;
  return { color, count: m.stories ? Math.max(1, Math.round(n.story ?? 1)) : 1 };
}

/** "2 red ties", "1 tie". */
export function tiesText(t: Ties | undefined): string {
  if (!t) return '';
  return `${t.count} ${t.color ? `${tieName(t.color).toLowerCase()} ` : ''}tie${t.count === 1 ? '' : 's'}`;
}

/** Distinct colours for outlets that do not have one yet, in outline order. */
export function assignTieColors(display: Display): Record<string, string> {
  const outlets = clusterMembers(display)
    .map((g) => display.nodes[g.root])
    .filter((n) => n?.kind === 'outlet');
  const used = new Set(outlets.map((o) => o.tieColor).filter(Boolean));
  const free = TIE_COLORS.map((c) => c.id).filter((c) => !used.has(c));
  const out: Record<string, string> = {};
  for (const o of outlets) if (!o.tieColor && free.length) out[o.id] = free.shift()!;
  return out;
}

function where(display: Display, id: string): string | undefined {
  const home = homeLink(display, id);
  if (!home) return undefined;
  if (home.kind === 'signal') return `${home.signalType?.toUpperCase() ?? 'signal'} from ${home.from}`;
  const port = socketLabels(display, home.from).get(home.id);
  return port ? `${home.from} ${port.replace(/^tap(\d+)$/, 'tap $1')}` : home.from;
}

function feeds(display: Display, id: string): string | undefined {
  const kids = powerChildren(display, id)
    .map((l) => l.to)
    .filter((x): x is string => !!x);
  if (!kids.length) return undefined;
  return kids.length <= 3 ? kids.join(', ') : `${kids.slice(0, 3).join(', ')} +${kids.length - 3}`;
}

/** The second line: a cord's length, where lights or a prop go, or the gear's name. */
export function labelSub(n: DisplayNode): string {
  const len = n.lengthFt !== undefined ? `${n.lengthApprox ? '~' : ''}${Math.round(n.lengthFt)} ft` : '';
  if (n.kind === 'cord') return len || n.label;
  if (n.kind === 'load') return n.location || n.label;
  return n.location ? `${n.label} · ${n.location}` : n.label;
}

/** Items that get a label (outlets never do), in outline order, outlet by outlet. */
export function labelledIds(display: Display, opts: Pick<LabelOptions, 'includeLoads'> = {}): string[] {
  const out: string[] = [];
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      const n = display.nodes[id];
      if (!n || n.kind === 'outlet' || n.retired) continue;
      if (n.kind === 'load' && opts.includeLoads === false) continue;
      out.push(id);
    }
  }
  return out;
}

export function labelsFor(display: Display, opts: LabelOptions = {}): Label[] {
  const out: Label[] = [];
  for (const id of labelledIds(display, opts)) {
    const n = display.nodes[id];
    const sub = labelSub(n);
    const storage = opts.storage && n.storage ? n.storage : undefined;
    const ties = tiesFor(display, id);
    const from = where(display, id);
    const to = feeds(display, id);
    const make = (key: string, route: string | undefined, end?: Label['end']): Label => {
      const text = [`${id} ${sub}`, route, storage].filter(Boolean).join(' · ');
      return { key, id, heading: id, sub, name: n.label, end, route, storage, ties, text };
    };
    if (n.kind === 'cord' && opts.bothEnds !== false) {
      // The same label on both ends, so the two ends of one cord are easy to pair up.
      out.push(make(`${id}:plug`, opts.route ? `into ${from ?? 'nothing yet'}` : undefined, 'plug'));
      out.push(make(`${id}:far`, opts.route ? (to ? `feeds ${to}` : 'feeds nothing yet') : undefined, 'far'));
      continue;
    }
    const route = !opts.route ? undefined : from && to ? `${from} → ${to}` : from ? `into ${from}` : to ? `feeds ${to}` : 'not plugged in';
    out.push(make(id, route));
  }
  return out;
}

/** What to get ready: labels, and zip ties by colour ('' = no colour). */
export function labelPrep(labels: Label[]): { labels: number; ties: { color: string; count: number }[] } {
  const by = new Map<string, number>();
  for (const l of labels) if (l.ties) by.set(l.ties.color ?? '', (by.get(l.ties.color ?? '') ?? 0) + l.ties.count);
  const order = (c: string) => (c ? TIE_COLORS.findIndex((t) => t.id === c) : 99);
  return { labels: labels.length, ties: [...by].map(([color, count]) => ({ color, count })).sort((a, b) => order(a.color) - order(b.color)) };
}
