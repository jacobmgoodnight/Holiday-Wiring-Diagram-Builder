/**
 * Shopping list (pure): feet of lights by type and colour, bulbs, zip cord and its females,
 * extension cords by length, gear and props, from the plan and what is drawn on photos.
 * Lengths come from the item (its "ft") or, failing that, from a measured photo.
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { inlineFemales, isRun } from '../model/graph';
import type { Display, DisplayNode } from '../model/types';
import { PALETTES, areaSizeFt, areaStyle, bulbColors, bulbCount, drawnAsLights, paletteOf, runLengthFt, runStyle, spacingInOf, wiringLines } from '../photo/geometry';

export interface TakeoffLine {
  /** What to buy, e.g. "C9 bulbs · Warm white · 12″ apart". */
  item: string;
  /** How much, e.g. "~132 ft" or "× 2". */
  qty: string;
  /** Extra detail, e.g. "≈ 136 bulbs · buy ~145 ft with 10% for corners". */
  detail?: string;
  ids: string[];
}

export interface TakeoffSection {
  title: string;
  lines: TakeoffLine[];
}

export interface TakeoffOptions {
  /** Only items marked "New this year" (what you still have to buy). */
  onlyNew?: boolean;
  /**
   * Only what one photo needs: the items on it, and the cords and gear feeding them. Lengths
   * come from that photo first.
   */
  viewId?: string;
}

/** Items on a photo plus everything upstream of them (cords, splitters, timers). */
export function photoItems(display: Display, viewId: string): Set<string> {
  const out = new Set<string>();
  for (const n of Object.values(display.nodes)) {
    if (!n.placements?.[viewId]) continue;
    for (let id: string | undefined = n.id; id && !out.has(id); ) {
      out.add(id);
      const home = homeLink(display, id);
      id = home?.kind === 'power' ? home.from : undefined;
    }
  }
  return out;
}

const STYLE_NAME = { c9: 'C9/C7 light strings', mini: 'Mini light strings', icicle: 'Icicle lights', pixel: 'Pixels', pathway: 'Ground stake lights', plain: 'Lights' } as const;

/**
 * A C9 stringer is bulk wire with sockets every few inches, cut to length, with bulbs and
 * plugs bought separately; pre-made C9 strings come with bulbs and plugs on both ends.
 */
export function isStringer(node: Pick<DisplayNode, 'category' | 'label'>): boolean {
  return node.category === 'c9' && /\b(stringer|spool|bulk)\b/i.test(node.label);
}

/** Common stringer spool lengths. */
const SPOOLS_FT = [25, 50, 100, 250, 500, 1000];
/** Bulbs per pre-made string: 25 for C9/C7 sets, 100 for mini strings. */
const PER_STRING: Partial<Record<keyof typeof STYLE_NAME, number>> = { c9: 25, mini: 100 };
const EXTRA_NAMES: Record<string, string> = { '#ffd60a': 'Yellow', '#ff6fb5': 'Pink' };

export function colorName(c: string): string {
  const single = PALETTES.find((p) => p.colors.length === 1 && p.colors[0].toLowerCase() === c.toLowerCase());
  return single?.name ?? EXTRA_NAMES[c.toLowerCase()] ?? c;
}

/** "Warm white", "Red & green", or the colours by name. */
export function colorsName(colors: string[]): string {
  const id = paletteOf(colors);
  return id ? PALETTES.find((p) => p.id === id)!.name : colors.map(colorName).join(' & ');
}

/** Length of a run: from the plan, else measured on a photo with a scale. */
export function lengthOf(display: Display, node: DisplayNode, viewId?: string): { ft: number; approx: boolean } | undefined {
  if (node.lengthFt !== undefined) return { ft: node.lengthFt, approx: !!node.lengthApprox };
  const views = [...(display.views ?? [])].sort((a, b) => Number(b.id === viewId) - Number(a.id === viewId));
  for (const view of views) {
    const p = node.placements?.[view.id];
    const ft = p ? runLengthFt(p, view, node.smooth) : undefined;
    if (ft !== undefined) return { ft, approx: true };
  }
  return undefined;
}

const fmtFt = (ft: number, approx: boolean) => `${approx ? '~' : ''}${Math.round(ft)} ft`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function takeoff(display: Display, opts: TakeoffOptions = {}): TakeoffSection[] {
  // Outline order, outlet by outlet, so IDs read naturally.
  const nodes = clusterMembers(display)
    .flatMap((g) => g.members)
    .map((id) => display.nodes[id])
    .filter((n) => n && !n.retired && (!opts.onlyNew || n.isNew));
  const only = opts.viewId ? photoItems(display, opts.viewId) : undefined;
  if (only) nodes.splice(0, nodes.length, ...nodes.filter((n) => only.has(n.id)));
  const views = (display.views ?? []).filter((v) => !opts.viewId || v.id === opts.viewId);
  const onBush = (n: DisplayNode) => views.some((v) => n.placements?.[v.id]?.kind === 'area');

  // Lights along the house, by type, colours and spacing.
  type RunGroup = {
    item: string;
    style: keyof typeof STYLE_NAME;
    stringer: boolean;
    ft: number;
    approx: boolean;
    bulbs: number;
    perColor: Map<string, number>;
    missing: string[];
    ids: string[];
    /** Stringers: female ends and inline females to fit. */
    females: number;
  };
  const runs = new Map<string, RunGroup>();
  // Bushes and trees: one line each.
  const bushes: TakeoffLine[] = [];
  // Zip cord and multi-outlet cords.
  type ZipGroup = { ft: number; approx: boolean; inline: number; ends: number; missing: string[]; ids: string[] };
  const zip = new Map<string, ZipGroup>();
  const cords = new Map<string, { item: string; n: number; ids: string[]; len: number }>();
  const gear = new Map<string, { item: string; n: number; ids: string[] }>();
  const props = new Map<string, { item: string; n: number; ids: string[] }>();
  const count = (m: Map<string, { item: string; n: number; ids: string[] }>, item: string, n: DisplayNode) => {
    const key = item.toLowerCase();
    const g = m.get(key) ?? { item, n: 0, ids: [] };
    g.n += n.qty ?? 1;
    g.ids.push(n.id);
    m.set(key, g);
  };

  for (const n of nodes) {
    if (n.kind === 'load' && drawnAsLights(n) && onBush(n)) {
      const size = views.map((v) => (n.placements?.[v.id] ? areaSizeFt(n.placements[v.id], v) : undefined)).find(Boolean);
      const net = areaStyle(n) === 'net';
      const detail = size
        ? net
          ? `≈ ${plural(Math.max(1, Math.ceil((size.w * size.h) / 24)), '4×6 ft net')}`
          : `about ${Math.round(size.w)} ft across`
        : 'measure the photo for its size';
      bushes.push({ item: `${n.label} · ${colorsName(bulbColors(n))}`, qty: size ? `~${Math.round(size.w)}×${Math.round(size.h)} ft` : '1 bush', detail, ids: [n.id] });
      continue;
    }
    if (n.kind === 'load' && drawnAsLights(n)) {
      const style = runStyle(n);
      const colors = bulbColors(n);
      const spacing = spacingInOf(n);
      const stringer = isStringer(n);
      const item = stringer ? `C9 stringer · ${colorsName(colors)} · sockets ${spacing}″ apart` : `${STYLE_NAME[style]} · ${colorsName(colors)} · ${spacing}″ apart`;
      const g: RunGroup = runs.get(item) ?? { item, style, stringer, ft: 0, approx: false, bulbs: 0, perColor: new Map(), missing: [], ids: [], females: 0 };
      if (stringer && n.outputs !== undefined) g.females += n.outputs;
      const len = lengthOf(display, n, opts.viewId);
      g.ids.push(n.id);
      if (len) {
        const copies = n.qty ?? 1;
        g.ft += len.ft * copies;
        g.approx ||= len.approx;
        const bulbs = bulbCount(len.ft, spacing) * copies;
        g.bulbs += bulbs;
        // Colours repeat along the run: red, green, blue, red…
        for (let i = 0; i < colors.length; i++) {
          const k = Math.floor(bulbs / colors.length) + (i < bulbs % colors.length ? 1 : 0);
          g.perColor.set(colors[i], (g.perColor.get(colors[i]) ?? 0) + k);
        }
      } else g.missing.push(n.id);
      runs.set(item, g);
      continue;
    }
    if (n.kind === 'cord' && isRun(n)) {
      const item = n.subtype === 'spt' ? 'SPT-1 zip cord' : 'Multi-outlet extension cord';
      const g: ZipGroup = zip.get(item) ?? { ft: 0, approx: false, inline: 0, ends: 0, missing: [], ids: [] };
      const len = lengthOf(display, n, opts.viewId);
      if (len) {
        g.ft += len.ft;
        g.approx ||= len.approx;
      } else g.missing.push(n.id);
      if (n.outputs !== undefined) {
        g.inline += inlineFemales(n);
        g.ends += n.endFemale !== false ? 1 : 0;
      }
      g.ids.push(n.id);
      zip.set(item, g);
      continue;
    }
    if (n.kind === 'cord') {
      const len = n.lengthFt;
      const item = [len !== undefined ? `${Math.round(len)} ft` : 'length not set', n.color ?? ''].filter(Boolean).join(' ') + ' extension cord';
      const key = item.toLowerCase();
      const g = cords.get(key) ?? { item: cap(item), n: 0, ids: [], len: len ?? Infinity };
      g.n += n.qty ?? 1;
      g.ids.push(n.id);
      cords.set(key, g);
      continue;
    }
    if (n.kind === 'splitter' || n.kind === 'smartplug' || n.kind === 'controller') count(gear, n.label || n.kind, n);
    else if (n.kind === 'load') count(props, n.label || 'Item', n);
  }

  const sections: TakeoffSection[] = [];
  // Cords that no longer reach (something was moved after they were sized): fix these first.
  const short = new Map<string, TakeoffLine & { need: number }>();
  for (const v of views) {
    for (const l of wiringLines(display, v)) {
      if (!l.short || (only && !only.has(l.childId))) continue;
      const key = l.via.join('+');
      if ((short.get(key)?.need ?? 0) >= l.short.need) continue;
      const cords = l.via.map((id) => display.nodes[id]);
      const item = cords.length === 1 ? `${cords[0].id} ${cords[0].label} (${l.short.have} ft)` : `${l.via.join(' + ')} (${l.short.have} ft together)`;
      short.set(key, {
        item,
        qty: `needs ~${l.short.need} ft`,
        detail: `to reach ${l.childId} on “${v.name}”${l.short.fix ? ` · use a ${l.short.fix} ft cord` : ''}`,
        ids: [...l.via, l.childId],
        need: l.short.need,
      });
    }
  }
  if (short.size) sections.push({ title: 'Check these cords', lines: [...short.values()].map(({ need: _n, ...line }) => line) });
  if (runs.size)
    sections.push({
      title: 'Lights along the house',
      lines: [...runs.values()].map((g) => {
        const parts: string[] = [];
        if (g.ft > 0) {
          const split = g.perColor.size > 1 ? `: ${[...g.perColor].map(([c, k]) => `${k} ${colorName(c).toLowerCase()}`).join(', ')}` : '';
          const buy = Math.ceil(g.ft * 1.1);
          if (g.stringer) {
            // Wire with sockets: bulbs, a male plug per run and the females are extra.
            const spool = SPOOLS_FT.find((x) => x >= buy);
            parts.push(`${plural(g.bulbs, 'bulb')} to buy${split}`);
            parts.push(`wire ~${buy} ft with 10% for corners${spool ? ` (a ${spool} ft spool)` : ''}`);
            parts.push(`${plural(g.ids.length - g.missing.length, 'male plug')}${g.females ? ` + ${plural(g.females, 'female')}` : ''}`);
          } else {
            const per = PER_STRING[g.style];
            if (per) parts.push(`≈ ${plural(Math.ceil(g.bulbs / per), `string`)} of ${per} bulbs (${g.bulbs} bulbs)`);
            else if (g.style === 'pathway') parts.push(`≈ ${plural(g.bulbs, 'stake')}${split}`);
            parts.push(`buy ~${buy} ft with 10% for corners`);
          }
        }
        if (g.missing.length) parts.push(`${plural(g.missing.length, 'run')} without a length (${g.missing.join(', ')})`);
        return { item: g.item, qty: g.ft > 0 ? fmtFt(g.ft, g.approx) : 'length not set', detail: parts.join(' · ') || undefined, ids: g.ids };
      }),
    });
  if (bushes.length) sections.push({ title: 'Bushes and trees', lines: bushes });
  if (zip.size)
    sections.push({
      title: 'Zip cord and multi-outlet cords',
      lines: [...zip].map(([item, g]) => {
        const parts: string[] = [];
        if (g.inline || g.ends) parts.push(`${plural(g.inline, 'inline female')} + ${plural(g.ends, 'end female')}`);
        if (g.missing.length) parts.push(`${plural(g.missing.length, 'run')} without a length (${g.missing.join(', ')})`);
        return { item, qty: g.ft > 0 ? fmtFt(g.ft, g.approx) : 'length not set', detail: parts.join(' · ') || undefined, ids: g.ids };
      }),
    });
  if (cords.size)
    sections.push({
      title: 'Extension cords',
      lines: [...cords.values()].sort((a, b) => a.len - b.len).map((g) => ({ item: g.item, qty: `× ${g.n}`, ids: g.ids })),
    });
  if (gear.size) sections.push({ title: 'Splitters, timers and controllers', lines: [...gear.values()].map((g) => ({ item: g.item, qty: `× ${g.n}`, ids: g.ids })) });
  if (props.size) sections.push({ title: 'Props and other lights', lines: [...props.values()].map((g) => ({ item: g.item, qty: `× ${g.n}`, ids: g.ids })) });
  return sections;
}

/** The list as plain text, for copying into a note or a message. */
export function takeoffText(title: string, sections: TakeoffSection[]): string {
  const out = [`Shopping list · ${title}`];
  for (const s of sections) {
    out.push('', s.title);
    for (const l of s.lines) out.push(`- ${l.item}: ${l.qty}${l.detail ? ` (${l.detail})` : ''} [${l.ids.join(', ')}]`);
  }
  return out.join('\n') + '\n';
}

/** Rows for a CSV: section, item, quantity, detail, IDs. */
export function takeoffRows(sections: TakeoffSection[]): string[][] {
  return [['section', 'item', 'quantity', 'detail', 'ids'], ...sections.flatMap((s) => s.lines.map((l) => [s.title, l.item, l.qty, l.detail ?? '', l.ids.join(' ')]))];
}
