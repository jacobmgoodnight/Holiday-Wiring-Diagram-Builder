/**
 * Diagram layout (pure): one left-to-right tidy-tree layout per outlet cluster, clusters stacked
 * top to bottom. Shared by the on-screen diagram and SVG/PNG export.
 * Layout never changes the model or its connections.
 */
import { powerChildren, socketLabels, unusedSockets } from '../model/graph';
import type { Display, DisplayNode, SignalType } from '../model/types';

export type Tone = 'power' | 'load' | 'media' | 'new' | 'retired' | 'unused';

export interface LayoutNode {
  /** Diagram id: the model node id, or `ghost:<parent>:<n>` for an unused socket. */
  id: string;
  type: 'item' | 'ghost';
  /** Model node id (items only). */
  nodeId?: string;
  /** Ghosts: the item whose socket this is. */
  parentId?: string;
  cluster: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  /** Wrapped text; the first line starts with the ID for items. */
  lines: string[];
  meta?: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  kind: 'power' | 'signal';
  label?: string;
  signalType?: SignalType;
  /** Signal link to an item drawn elsewhere (not part of the tree layout). */
  reference?: boolean;
}

export interface Cluster {
  /** Root node id, or `unplugged`. */
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  clusters: Cluster[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Show only the cluster with this root id. */
  focus?: string | null;
}

export const NODE_W = 210;
export const GHOST_W = 128;
export const GHOST_H = 30;
export const LINE_H = 17;
const PAD_Y = 9;
const META_H = 16;
const WRAP = 27;
const MAX_LINES = 3;
export const CLUSTER_HEADER = 30;
const CLUSTER_GAP = 28;
const RANK_GAP = 64;
const NODE_GAP = 12;
const MARGIN_X = 14;
const MARGIN_Y = 12;

const MEDIA_CATEGORIES = new Set(['projector', 'media', 'speaker']);

export function toneOf(node: DisplayNode): Tone {
  if (node.retired) return 'retired';
  if (node.isNew) return 'new';
  if (node.kind === 'load') return node.category && MEDIA_CATEGORIES.has(node.category) ? 'media' : 'load';
  if (node.kind === 'controller' || node.kind === 'enclosure') return 'media';
  return 'power';
}

/** Greedy word wrap with an ellipsis on the last allowed line. */
export function wrap(text: string, width = WRAP, maxLines = MAX_LINES): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const out = lines.map((l) => (l.length > width ? l.slice(0, width - 1) + '…' : l));
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = (last.length + 1 > width ? last.slice(0, width - 1).trimEnd() : last) + '…';
    return kept;
  }
  return out;
}

const fmt = (n: number) => String(Number(n.toFixed(2)));

export function metaOf(node: DisplayNode): string | undefined {
  const parts = [
    node.qty !== undefined ? `x${node.qty}` : '',
    node.lengthFt !== undefined ? `${node.lengthApprox ? '~' : ''}${fmt(node.lengthFt)} ft` : '',
    node.watts !== undefined ? `${node.wattsApprox ? '~' : ''}${fmt(node.watts)} W` : '',
    node.amps !== undefined ? `${node.ampsApprox ? '~' : ''}${fmt(node.amps)} A` : '',
    node.breakerAmps !== undefined ? `${fmt(node.breakerAmps)} A breaker` : '',
    node.gfci ? 'GFCI' : '',
    node.status !== 'planned' ? node.status : '',
    node.isNew ? 'new' : '',
    node.retired ? 'retired' : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function itemBox(node: DisplayNode): Pick<LayoutNode, 'lines' | 'meta' | 'w' | 'h'> {
  const lines = wrap(`${node.id} ${node.label || '(no name)'}`);
  const meta = metaOf(node);
  return { lines, meta, w: NODE_W, h: PAD_Y * 2 + lines.length * LINE_H + (meta ? META_H : 0) };
}

/** Root ids in outline order, plus the members of each root's tree. */
export function clusterMembers(display: Display): { root: string; members: string[] }[] {
  const homed = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  for (const link of [...display.links].sort((a, b) => a.seq - b.seq)) {
    if (!link.to || !(link.kind === 'power' || link.owns)) continue;
    homed.add(link.to);
    childrenOf.set(link.from, [...(childrenOf.get(link.from) ?? []), link.to]);
  }
  const roots = Object.values(display.nodes)
    .filter((n) => !homed.has(n.id))
    .sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
    .map((n) => n.id);
  const seen = new Set<string>();
  const collect = (root: string) => {
    const members: string[] = [];
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !display.nodes[id]) continue;
      seen.add(id);
      members.push(id);
      stack.push(...[...(childrenOf.get(id) ?? [])].reverse());
    }
    return members;
  };
  const out = roots.map((root) => ({ root, members: collect(root) }));
  // Anything unreachable (only possible with a power loop) still gets drawn.
  for (const id of Object.keys(display.nodes).sort()) if (!seen.has(id)) out.push({ root: id, members: collect(id) });
  return out;
}

export function clusterTitle(display: Display, root: string): string {
  const n = display.nodes[root];
  return n.kind === 'outlet' ? `${n.id} ${n.label}`.trim() : 'Not plugged in yet';
}

export function layoutDisplay(display: Display, options: LayoutOptions = {}): Layout {
  const groups = clusterMembers(display);
  // Unplugged items share one cluster, so a fresh idea list doesn't become many tiny boxes.
  const merged: { id: string; title: string; members: string[] }[] = [];
  const unplugged: string[] = [];
  for (const g of groups) {
    if (display.nodes[g.root].kind === 'outlet') merged.push({ id: g.root, title: clusterTitle(display, g.root), members: g.members });
    else unplugged.push(...g.members);
  }
  if (unplugged.length) merged.push({ id: 'unplugged', title: 'Not plugged in yet', members: unplugged });

  const visible = options.focus ? merged.filter((c) => c.id === options.focus || c.members.includes(options.focus!)) : merged;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const clusters: Cluster[] = [];
  const drawn = new Set<string>();
  let cursorY = 0;
  let width = 0;

  for (const cluster of visible) {
    const memberSet = new Set(cluster.members);
    const boxes = new Map<string, LayoutNode>();
    /** Ordered children (items and unused-socket ghosts) for each member, in outline order. */
    const kids = new Map<string, string[]>();
    const add = (parent: string, child: string) => kids.set(parent, [...(kids.get(parent) ?? []), child]);

    for (const id of cluster.members) {
      const node = display.nodes[id];
      boxes.set(id, { id, type: 'item', nodeId: id, cluster: cluster.id, x: 0, y: 0, tone: toneOf(node), ...itemBox(node) });
    }
    for (const id of cluster.members) {
      const labels = socketLabels(display, id);
      const usedLabels = new Set([...labels.values()].filter(Boolean) as string[]);
      let ghostN = 0;
      const addGhost = (label: string | undefined) => {
        const gid = `ghost:${id}:${ghostN++}`;
        boxes.set(gid, { id: gid, type: 'ghost', parentId: id, cluster: cluster.id, x: 0, y: 0, w: GHOST_W, h: GHOST_H, tone: 'unused', lines: ['Unused socket'] });
        add(id, gid);
        edges.push({ id: `e:${gid}`, source: id, target: gid, kind: 'power', label });
      };
      const out = display.links.filter((l) => l.from === id).sort((a, b) => a.seq - b.seq);
      for (const link of out) {
        if (link.kind === 'power' && link.to === null) addGhost(labels.get(link.id));
        else if (link.kind === 'power' && link.to && memberSet.has(link.to)) {
          add(id, link.to);
          edges.push({ id: link.id, source: id, target: link.to, kind: 'power', label: labels.get(link.id) });
        } else if (link.kind === 'signal' && link.owns && link.to && memberSet.has(link.to)) {
          add(id, link.to);
          edges.push({ id: link.id, source: id, target: link.to, kind: 'signal', label: link.signalType?.toUpperCase(), signalType: link.signalType });
        }
      }
      // Sockets known to exist (e.g. "4-way") but not written: show them as unused too.
      const explicit = powerChildren(display, id).filter((l) => l.to === null).length;
      let next = 1;
      for (let i = explicit; i < unusedSockets(display, id); i++) {
        while (usedLabels.has(String(next))) next++;
        usedLabels.add(String(next));
        addGhost(String(next));
      }
    }

    // Tidy tree: one column per depth, leaves stacked in outline order, parents centred on
    // their children. Deterministic, so socket 1 is always above socket 2.
    const top = cursorY + CLUSTER_HEADER + MARGIN_Y;
    let leafY = top;
    const colBottom = new Map<number, number>();
    let maxX = 0;
    const placed = new Set<string>();
    const place = (id: string, depth: number): number => {
      placed.add(id);
      const box = boxes.get(id)!;
      box.x = MARGIN_X + depth * (NODE_W + RANK_GAP);
      const children = (kids.get(id) ?? []).filter((c) => !placed.has(c));
      let y: number;
      if (!children.length) {
        y = leafY;
      } else {
        const centres = children.map((c) => place(c, depth + 1));
        y = (centres[0] + centres[centres.length - 1]) / 2 - box.h / 2;
      }
      y = Math.max(y, colBottom.get(depth) ?? -Infinity, top);
      box.y = Math.round(y);
      colBottom.set(depth, box.y + box.h + NODE_GAP);
      leafY = Math.max(leafY, box.y + box.h + NODE_GAP);
      maxX = Math.max(maxX, box.x + box.w);
      return box.y + box.h / 2;
    };
    const roots = cluster.members.filter((id) => !cluster.members.some((p) => (kids.get(p) ?? []).includes(id)));
    for (const r of roots) place(r, 0);

    let bottom = top;
    for (const n of boxes.values()) {
      nodes.push(n);
      if (n.nodeId) drawn.add(n.nodeId);
      bottom = Math.max(bottom, n.y + n.h);
    }
    const w = Math.max(maxX + MARGIN_X, 260);
    const h = bottom + MARGIN_Y - cursorY;
    clusters.push({ id: cluster.id, title: cluster.title, x: 0, y: cursorY, w, h });
    width = Math.max(width, w);
    cursorY += h + CLUSTER_GAP;
  }

  // Signal references (e.g. an ESP32 to a prop on another outlet), drawn but not laid out.
  for (const link of display.links) {
    if (link.kind !== 'signal' || link.owns || !link.to) continue;
    if (!drawn.has(link.from) || !drawn.has(link.to)) continue;
    edges.push({ id: link.id, source: link.from, target: link.to, kind: 'signal', label: link.signalType?.toUpperCase(), signalType: link.signalType, reference: true });
  }

  return { nodes, edges, clusters, width, height: Math.max(0, cursorY - CLUSTER_GAP) };
}

/** Cluster ids with titles, for the "One outlet" picker. */
export function clusterList(display: Display): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  let unplugged = false;
  for (const g of clusterMembers(display)) {
    if (display.nodes[g.root].kind === 'outlet') out.push({ id: g.root, title: clusterTitle(display, g.root) });
    else unplugged = true;
  }
  if (unplugged) out.push({ id: 'unplugged', title: 'Not plugged in yet' });
  return out;
}

/** The cluster (outlet id or `unplugged`) an item is drawn in. */
export function clusterOf(display: Display, nodeId: string): string | undefined {
  for (const g of clusterMembers(display)) {
    if (!g.members.includes(nodeId)) continue;
    return display.nodes[g.root].kind === 'outlet' ? g.root : 'unplugged';
  }
  return undefined;
}
