/**
 * Builder: parsed outline → Display model.
 *
 * ID rules (PLAN.md):
 *  1. An ID typed in the text always wins (duplicates: the later line gets a fresh ID).
 *  2. Otherwise the line keeps the ID of the matching line in the previous version.
 *  3. Otherwise it gets max + 1 for its prefix, so inserting a line never renumbers anything.
 */
import type { Comment, Diagnostic, Display, DisplayNode, Link, Season } from '../model/types';
import { ID_PREFIX } from '../model/types';
import { matchLines } from './lineMatch';
import { type ParsedLine, parseLines } from './parse';

export interface BuildResult {
  display: Display;
  diagnostics: Diagnostic[];
  /** For each outline line, the node it defines (if any). */
  lineNodeIds: (string | undefined)[];
  /** For each outline line, the node it is about: definitions and signal references. */
  lineFocusIds: (string | undefined)[];
  lines: ParsedLine[];
}

export interface PreviousBuild {
  display: Display;
  text: string;
  lineNodeIds: (string | undefined)[];
}

export interface BuildOptions {
  previous?: PreviousBuild;
  /** Display id when there is no previous build. */
  id?: string;
}

const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function idNumber(id: string): number {
  return Number(id.slice(1)) || 0;
}

export function formatId(prefix: string, n: number): string {
  return prefix + String(n).padStart(2, '0');
}

export function seasonFromTitle(title: string): { season: Season; year?: number } {
  const season: Season = /halloween/i.test(title)
    ? 'halloween'
    : /christmas|xmas|holiday|winter/i.test(title)
      ? 'christmas'
      : 'other';
  const y = /\b(20\d\d)\b/.exec(title);
  return { season, year: y ? Number(y[1]) : undefined };
}

export function buildDisplay(text: string, options: BuildOptions = {}): BuildResult {
  const { previous } = options;
  const lines = parseLines(text);
  const diagnostics: Diagnostic[] = [];
  const diag = (index: number, severity: Diagnostic['severity'], message: string) =>
    diagnostics.push({ line: index + 1, severity, message });
  for (const l of lines) {
    for (const w of l.warnings) diag(l.index, 'warning', w);
    for (const w of l.parse?.warnings ?? []) diag(l.index, 'warning', w);
  }

  const items = lines.filter((l) => l.type === 'item');

  // ---- Classify signal lines: reference to an existing item, or a new signal-only item.
  const definers = items.filter((l) => !l.parse!.unused && !l.parse!.signal);
  const byExplicitId = new Map<string, ParsedLine>();
  for (const l of definers) {
    const id = l.parse!.fields.explicitId;
    if (id && !byExplicitId.has(id)) byExplicitId.set(id, l);
  }
  const byLabel = new Map<string, ParsedLine[]>();
  for (const l of definers) {
    const key = normLabel(l.parse!.fields.label);
    if (key) byLabel.set(key, [...(byLabel.get(key) ?? []), l]);
  }
  /** signal line index → index of the line defining the referenced item */
  const refTarget = new Map<number, number>();
  /** signal line index → explicit ID not typed on any other line */
  const pending = new Map<number, string>();
  for (const l of items) {
    const p = l.parse!;
    if (!p.signal || p.unused) continue;
    const explicit = p.fields.explicitId ? byExplicitId.get(p.fields.explicitId) : undefined;
    if (explicit) {
      refTarget.set(l.index, explicit.index);
      continue;
    }
    if (p.fields.explicitId) {
      // Maybe an auto-assigned ID seen on the diagram; resolved once IDs are carried over.
      pending.set(l.index, p.fields.explicitId);
      continue;
    }
    const matches = byLabel.get(normLabel(p.fields.label)) ?? [];
    if (matches.length === 1) refTarget.set(l.index, matches[0].index);
    else if (matches.length > 1) {
      diag(
        l.index,
        'warning',
        `"${p.fields.label}" matches ${matches.length} items (lines ${matches.map((m) => m.index + 1).join(', ')}); ` +
          'treated as a new item. Add the ID to link to one of them.',
      );
    }
  }
  const isDefiner = (l: ParsedLine) =>
    l.type === 'item' && !l.parse!.unused && !refTarget.has(l.index) && !pending.has(l.index);

  // ---- Assign IDs.
  const lineNodeIds: (string | undefined)[] = new Array(lines.length).fill(undefined);
  const taken = new Set<string>();
  const firstLineOf = new Map<string, number>();
  for (const l of items) {
    if (!isDefiner(l)) continue;
    const id = l.parse!.fields.explicitId;
    if (!id) continue;
    if (taken.has(id)) {
      diag(l.index, 'error', `Duplicate ID ${id} (first used on line ${firstLineOf.get(id)! + 1}); this line gets a new ID`);
      l.parse!.fields.explicitId = undefined;
      continue;
    }
    taken.add(id);
    firstLineOf.set(id, l.index);
    lineNodeIds[l.index] = id;
  }

  if (previous) {
    const oldLines = previous.text.replace(/\r\n?/g, '\n').split('\n');
    const match = matchLines(
      oldLines,
      lines.map((l) => l.raw),
    );
    for (const l of items) {
      if (!isDefiner(l) || lineNodeIds[l.index]) continue;
      const oldIndex = match[l.index];
      const carried = oldIndex !== undefined ? previous.lineNodeIds[oldIndex] : undefined;
      if (!carried || taken.has(carried)) continue;
      if (carried[0] !== ID_PREFIX[l.parse!.fields.kind]) continue; // kind changed: new ID
      taken.add(carried);
      lineNodeIds[l.index] = carried;
    }
  }

  // Pending signal lines: a reference if another line now holds that ID, else they define it.
  for (const [index, id] of pending) {
    const owner = lineNodeIds.findIndex((x) => x === id);
    pending.delete(index);
    if (owner >= 0) refTarget.set(index, owner);
    else {
      taken.add(id);
      lineNodeIds[index] = id;
    }
  }

  const maxByPrefix = new Map<string, number>();
  const bump = (id: string) => maxByPrefix.set(id[0], Math.max(maxByPrefix.get(id[0]) ?? 0, idNumber(id)));
  taken.forEach(bump);
  if (previous) Object.keys(previous.display.nodes).forEach(bump);
  for (const l of items) {
    if (!isDefiner(l) || lineNodeIds[l.index]) continue;
    const prefix = ID_PREFIX[l.parse!.fields.kind];
    const n = (maxByPrefix.get(prefix) ?? 0) + 1;
    maxByPrefix.set(prefix, n);
    const id = formatId(prefix, n);
    taken.add(id);
    lineNodeIds[l.index] = id;
  }

  // ---- Nodes.
  const nodes: Record<string, DisplayNode> = {};
  const prevNodes = previous?.display.nodes ?? {};
  let pendingBlank = 0;
  const blankBeforeOf = new Map<number, number>();
  for (const l of lines) {
    if (l.type === 'blank') {
      pendingBlank++;
      continue;
    }
    if (pendingBlank) blankBeforeOf.set(l.index, pendingBlank);
    pendingBlank = 0;
  }
  const trailingBlank = pendingBlank;

  for (const l of items) {
    const id = lineNodeIds[l.index];
    if (!id) continue;
    const p = l.parse!;
    const f = p.fields;
    const prev = prevNodes[id];
    const relabelled = !prev || prev.label !== f.label || prev.kind !== f.kind;
    const pick = <T>(inferred: T | undefined, old: T | undefined): T | undefined =>
      relabelled ? (inferred ?? (prev && prev.kind === f.kind ? old : undefined)) : (old ?? inferred);
    const node: DisplayNode = {
      ...(prev ?? {}),
      id,
      kind: f.kind,
      label: f.label,
      status: f.status,
      tags: [...f.tags],
      qty: f.qty,
      watts: f.watts,
      wattsApprox: f.wattsApprox,
      amps: f.amps,
      ampsApprox: f.ampsApprox,
      lengthFt: f.lengthFt,
      lengthApprox: f.lengthApprox,
      breakerAmps: f.breakerAmps,
      gfci: f.gfci,
      isNew: f.isNew,
      retired: f.retired,
      subtype: p.explicitSubtype ?? pick(p.inferred.subtype, prev?.subtype),
      category: f.kind === 'load' ? pick(p.inferred.category, prev?.category) : undefined,
      outputs: pick(p.inferred.outputs, prev?.outputs),
      color: pick(p.inferred.color, prev?.color),
      src: l.content,
      blankBefore: blankBeforeOf.get(l.index),
      seq: undefined,
    };
    for (const key of Object.keys(node) as (keyof DisplayNode)[]) {
      if (node[key] === undefined) delete node[key];
    }
    nodes[id] = node;
  }

  // ---- Links and comments.
  const links: Link[] = [];
  const comments: Comment[] = [];
  const seqOf = new Map<string | null, number>();
  const nextSeq = (parent: string | null) => {
    const n = seqOf.get(parent) ?? 0;
    seqOf.set(parent, n + 1);
    return n;
  };
  const lineFocusIds = [...lineNodeIds];
  for (const [lineIndex, target] of refTarget) lineFocusIds[lineIndex] = lineNodeIds[target];
  /** The node a line stands for when other lines are nested under it. */
  const nodeOfLine = (index: number | undefined) => (index === undefined ? undefined : lineFocusIds[index]);
  let linkCounter = 0;
  const linkId = () => `k${++linkCounter}`;
  const linkLine = new Map<string, number>();
  const addLink = (link: Link, lineIndex: number) => {
    links.push(link);
    linkLine.set(link.id, lineIndex);
  };
  let commentCounter = 0;

  const keepVerbatim = (l: ParsedLine, parent: string | null) => {
    comments.push({
      id: `c${++commentCounter}`,
      parent,
      seq: nextSeq(parent),
      text: l.content,
      raw: true,
      blankBefore: blankBeforeOf.get(l.index),
    });
  };

  for (const l of lines) {
    if (l.type === 'blank') continue;
    const parentId = nodeOfLine(l.parent) ?? null;
    if (l.type === 'comment') {
      comments.push({
        id: `c${++commentCounter}`,
        parent: parentId,
        seq: nextSeq(parentId),
        text: l.content,
        blankBefore: blankBeforeOf.get(l.index),
      });
      continue;
    }
    const p = l.parse!;
    const blankBefore = blankBeforeOf.get(l.index);

    if (p.unused) {
      if (!parentId) {
        diag(l.index, 'warning', 'An unused socket needs an item above it; line kept as text');
        keepVerbatim(l, null);
        continue;
      }
      addLink({ id: linkId(), kind: 'power', from: parentId, to: null, port: p.port, seq: nextSeq(parentId), src: l.content, blankBefore }, l.index);
      continue;
    }

    if (refTarget.has(l.index)) {
      const to = lineNodeIds[refTarget.get(l.index)!]!;
      if (!parentId || parentId === to) {
        diag(l.index, 'warning', parentId ? 'A signal link cannot point at its own item; line kept as text' : 'A signal link needs an item above it; line kept as text');
        keepVerbatim(l, parentId);
        continue;
      }
      addLink({ id: linkId(), kind: 'signal', from: parentId, to, signalType: p.signal, seq: nextSeq(parentId), owns: false, src: l.content, blankBefore }, l.index);
      diag(l.index, 'info', `Signal link to ${to} (${nodes[to]?.label || 'item'}) on line ${refTarget.get(l.index)! + 1}`);
      continue;
    }

    const id = lineNodeIds[l.index]!;
    if (!parentId) {
      if (p.port) diag(l.index, 'warning', `"${p.port}:" is ignored on a top-level line`);
      if (p.signal) diag(l.index, 'warning', 'A signal link needs an item above it; read as a top-level item');
      nodes[id].seq = nextSeq(null);
      continue;
    }
    if (p.signal) {
      addLink({ id: linkId(), kind: 'signal', from: parentId, to: id, signalType: p.signal, seq: nextSeq(parentId), owns: true }, l.index);
    } else {
      addLink({ id: linkId(), kind: 'power', from: parentId, to: id, port: p.port, seq: nextSeq(parentId) }, l.index);
    }
  }

  // Repeated ports on one item (taps on a multi-outlet cord may repeat).
  const seenPorts = new Map<string, number>();
  for (const link of links) {
    if (link.kind !== 'power' || !link.port || link.port === 'tap') continue;
    const key = `${link.from}\u0000${link.port}`;
    const line = linkLine.get(link.id)!;
    if (seenPorts.has(key)) {
      diag(line, 'warning', `${link.from} port "${link.port}" is already used on line ${seenPorts.get(key)! + 1}; one output can feed only one item`);
    } else seenPorts.set(key, line);
  }

  // Title, season, year.
  const heading = lines.find((l) => l.type === 'comment' && l.depth === 0 && l.indent === 0);
  const title = heading ? heading.content.replace(/^#+\s*/, '').trim() : previous?.display.title ?? 'Untitled display';
  const { season, year } = seasonFromTitle(title);

  const display: Display = {
    id: previous?.display.id ?? options.id ?? `display-${Date.now().toString(36)}`,
    title,
    season,
    year,
    nodes,
    links,
    comments,
    trailingBlank: trailingBlank || undefined,
    copiedFrom: previous?.display.copiedFrom,
    views: previous?.display.views,
    lightLooks: previous?.display.lightLooks,
  };
  if (!display.views?.length) delete display.views;
  if (!display.lightLooks) delete display.lightLooks;
  if (!display.trailingBlank) delete display.trailingBlank;
  if (!display.copiedFrom) delete display.copiedFrom;
  if (display.year === undefined) delete display.year;

  diagnostics.sort((a, b) => a.line - b.line);
  return { display, diagnostics, lineNodeIds, lineFocusIds, lines };
}
