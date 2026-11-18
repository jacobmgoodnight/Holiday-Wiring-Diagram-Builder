/**
 * Serializer: Display model → outline text.
 *
 * A node's original line is reused verbatim whenever re-parsing it still describes the node
 * exactly; otherwise a canonical line is written. Diagram edits therefore only rewrite the
 * lines they touched.
 */
import type { Comment, Display, DisplayNode, Link, OutlineFields, SignalType } from '../model/types';
import { ID_PREFIX } from '../model/types';
import { inferKind, inferPowerKind } from './infer';
import { type ContentParse, KIND_WORD, SUBTYPE_WORD, kindForId, parseContent } from './parse';

const SIGNAL_WORD: Record<SignalType, string> = {
  hdmi: 'HDMI',
  vga: 'VGA',
  ble: 'BLE',
  wifi: 'WiFi',
  aux: 'AUX',
  dmx: 'DMX',
  data: 'DATA',
};

const fmt = (n: number) => String(Number(n.toFixed(3)));

const same = <T>(a: T | undefined, b: T | undefined) => (a ?? undefined) === (b ?? undefined);
const flag = (b: boolean | undefined) => !!b;

/** True when the parsed line describes `node` (reached through `link`) exactly. */
export function lineMatchesNode(p: ContentParse, node: DisplayNode, link?: Link): boolean {
  const f: OutlineFields = p.fields;
  if (p.unused) return false;
  if (!same(p.port, link?.kind === 'power' ? link.port : undefined)) return false;
  if (!same(p.signal, link?.kind === 'signal' ? link.signalType : undefined)) return false;
  if (f.explicitId && f.explicitId !== node.id) return false;
  if (p.explicitSubtype && p.explicitSubtype !== node.subtype) return false;
  return (
    f.kind === node.kind &&
    f.label === node.label &&
    f.status === node.status &&
    same(f.qty, node.qty) &&
    same(f.watts, node.watts) &&
    flag(f.wattsApprox) === flag(node.wattsApprox) &&
    same(f.amps, node.amps) &&
    flag(f.ampsApprox) === flag(node.ampsApprox) &&
    same(f.lengthFt, node.lengthFt) &&
    flag(f.lengthApprox) === flag(node.lengthApprox) &&
    same(f.breakerAmps, node.breakerAmps) &&
    flag(f.gfci) === flag(node.gfci) &&
    flag(f.isNew) === flag(node.isNew) &&
    flag(f.retired) === flag(node.retired) &&
    f.tags.length === node.tags.length &&
    f.tags.every((t, i) => t === node.tags[i])
  );
}

/** Canonical line content for a node. Power gear gets its ID written; loads do not (D3). */
export function canonicalLine(node: DisplayNode, link: Link | undefined, depth: number, forceId = false): string {
  const parts: string[] = [];
  const prefix = link?.kind === 'power' && link.port ? `${link.port}: ` : '';
  if (link?.kind === 'signal') parts.push('~' + SIGNAL_WORD[link.signalType ?? 'data']);
  const writeId = forceId || node.kind !== 'load' || kindForId(node.id) !== 'load';
  if (writeId) parts.push(node.id);
  if (node.label) parts.push(node.label);
  if (node.qty !== undefined) parts.push(`x${node.qty}`);
  if (node.lengthFt !== undefined) parts.push(`${node.lengthApprox ? '~' : ''}${fmt(node.lengthFt)}ft`);
  if (node.watts !== undefined) parts.push(`${node.wattsApprox ? '~' : ''}${fmt(node.watts)}W`);
  if (node.amps !== undefined) parts.push(`${node.ampsApprox ? '~' : ''}${fmt(node.amps)}A`);
  if (node.breakerAmps !== undefined) parts.push(`@${fmt(node.breakerAmps)}A`);
  if (node.gfci) parts.push('GFCI');

  // Only write a kind word when inference from what is written would get it wrong.
  const idKind = writeId ? kindForId(node.id) : undefined;
  const guess = inferKind(node.label, depth);
  const inferredKind = idKind ?? guess.kind;
  const inferredSubtype = (() => {
    const power = inferPowerKind(node.label);
    return power && power.kind === node.kind ? power.subtype : undefined;
  })();
  const subtypeWord = node.subtype ? SUBTYPE_WORD[node.subtype] : undefined;
  if (subtypeWord && inferredSubtype !== node.subtype) parts.push(`[${subtypeWord}]`);
  else if (inferredKind !== node.kind) parts.push(`[${KIND_WORD[node.kind]}]`);

  if (node.status !== 'planned') parts.push(`[${node.status}]`);
  if (node.isNew) parts.push('[new]');
  if (node.retired) parts.push('[retired]');
  for (const tag of node.tags) parts.push(`[${tag}]`);
  return prefix + parts.join(' ');
}

export interface SerializeResult {
  text: string;
  /** For each output line, the node it defines (if any). */
  lineNodeIds: (string | undefined)[];
}

type Entry =
  | { type: 'node'; seq: number; node: DisplayNode; link?: Link }
  | { type: 'link'; seq: number; link: Link }
  | { type: 'comment'; seq: number; comment: Comment };

export function serializeOutline(display: Display): SerializeResult {
  const out: string[] = [];
  const lineNodeIds: (string | undefined)[] = [];
  const emit = (text: string, blankBefore: number | undefined, nodeId?: string) => {
    for (let i = 0; i < (blankBefore ?? 0); i++) {
      out.push('');
      lineNodeIds.push(undefined);
    }
    out.push(text);
    lineNodeIds.push(nodeId);
  };

  const linksFrom = new Map<string, Link[]>();
  const homed = new Set<string>(); // nodes placed under a parent
  for (const link of display.links) {
    linksFrom.set(link.from, [...(linksFrom.get(link.from) ?? []), link]);
    if (link.to && (link.kind === 'power' || link.owns)) homed.add(link.to);
  }
  const commentsOf = new Map<string | null, Comment[]>();
  for (const c of display.comments) commentsOf.set(c.parent, [...(commentsOf.get(c.parent) ?? []), c]);

  // Signal references written by ID need that ID visible on the target's own line.
  const labelCount = new Map<string, number>();
  for (const n of Object.values(display.nodes)) {
    const k = n.label.toLowerCase();
    labelCount.set(k, (labelCount.get(k) ?? 0) + 1);
  }
  const signalOwned = new Set(display.links.filter((l) => l.kind === 'signal' && l.owns && l.to).map((l) => l.to!));
  // The builder only resolves names against items that are not themselves signal-only.
  const refByLabel = (target: DisplayNode) =>
    !!target.label && !signalOwned.has(target.id) && labelCount.get(target.label.toLowerCase()) === 1;
  const needsId = new Set<string>();
  for (const link of display.links) {
    if (link.kind !== 'signal' || link.owns || !link.to) continue;
    const target = display.nodes[link.to];
    if (!target) continue;
    const typed = link.src ? parseContent(link.src, 1).fields.explicitId : undefined;
    if (typed || !refByLabel(target)) needsId.add(target.id);
  }

  const visited = new Set<string>();

  const childEntries = (parent: string | null): Entry[] => {
    const entries: Entry[] = [];
    if (parent === null) {
      const roots = Object.values(display.nodes).filter((n) => !homed.has(n.id));
      roots.forEach((node) => entries.push({ type: 'node', seq: node.seq ?? Number.MAX_SAFE_INTEGER, node }));
    } else {
      for (const link of linksFrom.get(parent) ?? []) {
        const home = link.to && (link.kind === 'power' || link.owns) ? display.nodes[link.to] : undefined;
        if (home) entries.push({ type: 'node', seq: link.seq, node: home, link });
        else entries.push({ type: 'link', seq: link.seq, link });
      }
    }
    for (const comment of commentsOf.get(parent) ?? []) entries.push({ type: 'comment', seq: comment.seq, comment });
    // Stable order: seq, then nodes created without a seq by id.
    return entries.sort((a, b) => a.seq - b.seq || keyOf(a).localeCompare(keyOf(b)));
  };

  const walk = (parent: string | null, depth: number) => {
    const indent = '  '.repeat(depth);
    for (const entry of childEntries(parent)) {
      if (entry.type === 'comment') {
        emit(indent + entry.comment.text, entry.comment.blankBefore);
      } else if (entry.type === 'link') {
        emit(indent + linkLine(display, entry.link, depth, refByLabel), entry.link.blankBefore);
      } else {
        const { node, link } = entry;
        if (visited.has(node.id)) continue; // a loop or second parent; never emit twice
        visited.add(node.id);
        emit(indent + nodeLine(node, link, depth, needsId.has(node.id)), node.blankBefore, node.id);
        walk(node.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  // Items unreachable from the top level (only possible if the model has a power loop) are
  // still written out, at the top level, so text never silently loses them.
  for (const node of Object.values(display.nodes).sort((a, b) => a.id.localeCompare(b.id))) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    emit(nodeLine(node, undefined, 0, needsId.has(node.id)), node.blankBefore, node.id);
    walk(node.id, 1);
  }
  for (let i = 0; i < (display.trailingBlank ?? 0); i++) {
    out.push('');
    lineNodeIds.push(undefined);
  }
  return { text: out.join('\n'), lineNodeIds };
}

function keyOf(e: Entry): string {
  return e.type === 'node' ? e.node.id : e.type === 'link' ? e.link.id : e.comment.id;
}

function nodeLine(node: DisplayNode, link: Link | undefined, depth: number, needsId: boolean): string {
  if (node.src) {
    const p = parseContent(node.src, depth);
    if (lineMatchesNode(p, node, link) && (!needsId || p.fields.explicitId)) return node.src;
  }
  return canonicalLine(node, link, depth, needsId);
}

/** Unused sockets and signal references. */
function linkLine(display: Display, link: Link, depth: number, refByLabel: (n: DisplayNode) => boolean): string {
  if (link.to === null) {
    if (link.src) {
      const p = parseContent(link.src, depth);
      if (p.unused && same(p.port, link.port)) return link.src;
    }
    return `${link.port ? `${link.port}: ` : ''}Unused socket`;
  }
  const target = display.nodes[link.to];
  if (link.src && target) {
    const p = parseContent(link.src, depth);
    const f = p.fields;
    const pointsAtTarget = f.explicitId
      ? f.explicitId === target.id
      : refByLabel(target) && f.label.toLowerCase() === target.label.toLowerCase();
    if (p.signal === link.signalType && pointsAtTarget) return link.src;
  }
  const word = `~${SIGNAL_WORD[link.signalType ?? 'data']}`;
  if (target && refByLabel(target)) return `${word} ${target.label}`;
  return `${word} ${link.to}${target?.label ? ` ${target.label}` : ''}`;
}

/** Prefix used for new nodes of a kind (re-exported for UI code). */
export const prefixFor = (kind: DisplayNode['kind']) => ID_PREFIX[kind];
