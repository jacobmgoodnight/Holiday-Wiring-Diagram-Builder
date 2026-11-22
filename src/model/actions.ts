/**
 * Graph actions used by the diagram (tap/drag) editor. Pure: each returns a new Display.
 * Connections only change through these explicit actions; layout never changes them.
 */
import { powerChildren, socketLabels } from './graph';
import type { Display, DisplayNode, Link, LoadCategory, NodeKind } from './types';
import { ID_PREFIX } from './types';

export interface ActionResult {
  display: Display;
  /** The node the action created or changed (may have a new id after a kind change). */
  nodeId?: string;
  /** Something worth telling the user; the action still happened. */
  warning?: string;
}

export class ActionError extends Error {}

/** Where to plug something in: a parent (null = top level) and optionally a socket label. */
export interface Target {
  parent: string | null;
  port?: string;
}

export interface NewItem {
  kind: NodeKind;
  label: string;
  subtype?: string;
  category?: LoadCategory;
  outputs?: number;
  lengthFt?: number;
  color?: string;
  watts?: number;
  wattsApprox?: boolean;
  isNew?: boolean;
}

const clone = (d: Display): Display => structuredClone(d);

export function nextNodeId(display: Display, kind: NodeKind): string {
  const prefix = ID_PREFIX[kind];
  let max = 0;
  for (const id of Object.keys(display.nodes)) if (id[0] === prefix) max = Math.max(max, Number(id.slice(1)) || 0);
  return prefix + String(max + 1).padStart(2, '0');
}

function nextLinkId(display: Display): string {
  let max = 0;
  for (const l of display.links) {
    const m = /^a(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `a${max + 1}`;
}

/** The link that places a node in the outline (power parent, or owning signal link). */
export function homeLink(display: Display, id: string): Link | undefined {
  return display.links.find((l) => l.to === id && (l.kind === 'power' || l.owns));
}

/** The node and everything plugged into it, directly or further down. */
export function subtreeIds(display: Display, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const l of display.links) if (l.from === cur && l.to && (l.kind === 'power' || l.owns)) stack.push(l.to);
  }
  return out;
}

function nextSeq(display: Display, parent: string | null): number {
  let max = -1;
  if (parent === null) {
    for (const n of Object.values(display.nodes)) if (n.seq !== undefined) max = Math.max(max, n.seq);
  } else {
    for (const l of display.links) if (l.from === parent) max = Math.max(max, l.seq);
  }
  for (const c of display.comments) if (c.parent === parent) max = Math.max(max, c.seq);
  return max + 1;
}

function makeRoot(display: Display, node: DisplayNode) {
  const hasOthers = Object.values(display.nodes).some((n) => n.id !== node.id && n.seq !== undefined) || display.comments.some((c) => c.parent === null);
  node.seq = nextSeq(display, null);
  node.blankBefore = hasOthers ? 1 : undefined;
  if (node.blankBefore === undefined) delete node.blankBefore;
}

/** Plug `childId` into `target` (mutates `d`). Returns a warning if the socket was taken. */
function attach(d: Display, childId: string, target: Target): string | undefined {
  const child = d.nodes[childId];
  delete child.blankBefore;
  if (target.parent === null) {
    makeRoot(d, child);
    return undefined;
  }
  delete child.seq;
  const parent = target.parent;
  if (!d.nodes[parent]) throw new ActionError(`No item ${parent}`);
  let warning: string | undefined;
  if (target.port === undefined) {
    // No socket named: a written "Unused socket" line is the next free socket.
    const placeholder = powerChildren(d, parent).find((l) => l.to === null);
    if (placeholder) {
      placeholder.to = childId;
      delete placeholder.src;
      return undefined;
    }
  } else {
    const labels = socketLabels(d, parent);
    const kids = powerChildren(d, parent);
    const placeholder = kids.find((l) => l.to === null && labels.get(l.id) === target.port);
    if (placeholder) {
      // Fill the written "Unused socket" line in place, keeping its port and position.
      placeholder.to = childId;
      delete placeholder.src;
      return undefined;
    }
    const taken = kids.find((l) => l.to && labels.get(l.id) === target.port);
    if (taken) warning = `${parent} socket ${target.port} already feeds ${taken.to}; one output should feed only one item`;
  }
  const link: Link = { id: nextLinkId(d), kind: 'power', from: parent, to: childId, seq: nextSeq(d, parent) };
  d.links.push(link);
  if (target.port !== undefined && socketLabels(d, parent).get(link.id) !== target.port) link.port = target.port;
  return warning;
}

/**
 * Before taking `link` off its parent, write out the socket numbers of later unlabelled
 * siblings. Otherwise "3" would silently become "2" in the outline although nothing moved.
 */
function pinSiblingPorts(d: Display, link: Link) {
  if (link.kind !== 'power') return;
  const labels = socketLabels(d, link.from);
  const removed = labels.get(link.id);
  if (!removed || !/^\d+$/.test(removed)) return;
  for (const sib of powerChildren(d, link.from)) {
    if (sib.id === link.id || sib.port || sib.seq < link.seq) continue;
    const label = labels.get(sib.id);
    if (label && /^\d+$/.test(label)) sib.port = label;
  }
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function addNode(display: Display, item: NewItem, target: Target): ActionResult {
  const d = clone(display);
  const id = nextNodeId(d, item.kind);
  d.nodes[id] = clean<DisplayNode>({
    id,
    kind: item.kind,
    label: item.label,
    status: 'planned',
    tags: [],
    subtype: item.subtype,
    category: item.kind === 'load' ? (item.category ?? 'other') : undefined,
    outputs: item.outputs,
    watts: item.watts,
    wattsApprox: item.watts !== undefined ? (item.wattsApprox ?? true) : undefined,
    isNew: item.isNew,
    lengthFt: item.lengthFt,
    color: item.color,
  });
  const warning = attach(d, id, target);
  return { display: d, nodeId: id, warning };
}

/** Move a node (with everything plugged into it) to another socket. */
export function replug(display: Display, id: string, target: Target): ActionResult {
  if (!display.nodes[id]) throw new ActionError(`No item ${id}`);
  if (target.parent !== null && subtreeIds(display, id).has(target.parent)) {
    throw new ActionError(target.parent === id ? 'An item cannot plug into itself' : `${target.parent} is plugged into ${id}; that would make a loop`);
  }
  const d = clone(display);
  const home = homeLink(d, id);
  if (home && home.from === target.parent && target.port === undefined) return { display, nodeId: id };
  // The old socket simply becomes free; its neighbours keep their socket numbers.
  if (home) {
    pinSiblingPorts(d, home);
    d.links = d.links.filter((l) => l !== home);
  }
  const warning = attach(d, id, target);
  return { display: d, nodeId: id, warning };
}

/** Unplug a node; it and its children move to "Not plugged in yet". */
export function unplug(display: Display, id: string): ActionResult {
  const home = homeLink(display, id);
  if (!home) return { display, nodeId: id };
  const d = clone(display);
  pinSiblingPorts(d, d.links.find((l) => l.id === home.id)!);
  d.links = d.links.filter((l) => l.id !== home.id);
  makeRoot(d, d.nodes[id]);
  return { display: d, nodeId: id };
}

/**
 * Delete a node. `withChildren` also deletes everything plugged into it; otherwise those
 * items become unplugged (wiring is never guessed, so they are not moved up a level).
 */
export function deleteNode(display: Display, id: string, withChildren: boolean): ActionResult {
  if (!display.nodes[id]) return { display };
  const d = clone(display);
  const removed = withChildren ? subtreeIds(d, id) : new Set([id]);
  const home = homeLink(d, id);
  if (home) pinSiblingPorts(d, home);
  const orphans = withChildren
    ? []
    : d.links.filter((l) => l.from === id && l.to && (l.kind === 'power' || l.owns)).sort((a, b) => a.seq - b.seq).map((l) => l.to!);
  d.links = d.links.filter((l) => !removed.has(l.from) && !(l.to && removed.has(l.to)));
  for (const r of removed) delete d.nodes[r];
  // Comments under deleted items move up to where the deleted item was.
  const newParent = home?.from ?? null;
  for (const c of d.comments) {
    if (c.parent && removed.has(c.parent)) {
      c.parent = newParent;
      c.seq = nextSeq(d, newParent);
    }
  }
  for (const o of orphans) if (d.nodes[o]) makeRoot(d, d.nodes[o]);
  return { display: d };
}

export type NodePatch = Partial<Omit<DisplayNode, 'id' | 'kind' | 'src' | 'seq' | 'blankBefore'>>;

export function updateNode(display: Display, id: string, patch: NodePatch): ActionResult {
  if (!display.nodes[id]) throw new ActionError(`No item ${id}`);
  const d = clone(display);
  d.nodes[id] = clean({ ...d.nodes[id], ...patch });
  return { display: d, nodeId: id };
}

/** Change kind. The ID prefix follows the kind, so the item gets a new ID. */
export function changeKind(display: Display, id: string, kind: NodeKind): ActionResult {
  const node = display.nodes[id];
  if (!node) throw new ActionError(`No item ${id}`);
  if (node.kind === kind) return { display, nodeId: id };
  const d = clone(display);
  const newId = nextNodeId(d, kind);
  const moved: DisplayNode = clean({
    ...d.nodes[id],
    id: newId,
    kind,
    subtype: undefined,
    category: kind === 'load' ? (node.category ?? 'other') : undefined,
    breakerAmps: kind === 'outlet' ? node.breakerAmps : undefined,
    gfci: kind === 'outlet' ? node.gfci : undefined,
    src: undefined,
  });
  delete d.nodes[id];
  d.nodes[newId] = moved;
  for (const l of d.links) {
    if (l.from === id) l.from = newId;
    if (l.to === id) l.to = newId;
  }
  for (const c of d.comments) if (c.parent === id) c.parent = newId;
  return { display: d, nodeId: newId };
}
