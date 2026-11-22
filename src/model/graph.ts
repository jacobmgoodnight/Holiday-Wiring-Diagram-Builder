/** Read-only graph helpers shared by the diagram, checks and tests. */
import type { Display, Link } from './types';

export function powerChildren(display: Display, nodeId: string): Link[] {
  return display.links.filter((l) => l.kind === 'power' && l.from === nodeId).sort((a, b) => a.seq - b.seq);
}

export function powerParent(display: Display, nodeId: string): Link | undefined {
  return display.links.find((l) => l.kind === 'power' && l.to === nodeId);
}

/**
 * Effective socket label for each power link out of a node: the written port, or the lowest
 * number not already written on a sibling. Unlabelled single outputs (a plain cord) get none.
 */
export function socketLabels(display: Display, nodeId: string): Map<string, string | undefined> {
  const children = powerChildren(display, nodeId);
  const node = display.nodes[nodeId];
  const numbered = (node?.outputs ?? 0) > 1 || children.length > 1;
  const used = new Set(children.map((l) => l.port).filter((p): p is string => !!p && /^\d+$/.test(p)));
  const out = new Map<string, string | undefined>();
  let next = 1;
  for (const link of children) {
    if (link.port) {
      out.set(link.id, link.port);
      continue;
    }
    if (!numbered) {
      out.set(link.id, undefined);
      continue;
    }
    while (used.has(String(next))) next++;
    used.add(String(next));
    out.set(link.id, String(next));
  }
  return out;
}

/** Known outputs that have nothing plugged in (explicit `Unused socket` lines included). */
export function unusedSockets(display: Display, nodeId: string): number {
  const children = powerChildren(display, nodeId);
  const explicitUnused = children.filter((l) => l.to === null).length;
  const used = children.length - explicitUnused;
  const outputs = display.nodes[nodeId]?.outputs;
  if (outputs === undefined) return explicitUnused;
  return Math.max(outputs - used, explicitUnused);
}

export interface DisplayStats {
  nodes: number;
  powerLinks: number;
  signalLinks: number;
  explicitUnused: number;
  roots: number;
  byKind: Record<string, number>;
}

export function displayStats(display: Display): DisplayStats {
  const byKind: Record<string, number> = {};
  for (const n of Object.values(display.nodes)) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const homed = new Set(display.links.filter((l) => l.to && (l.kind === 'power' || l.owns)).map((l) => l.to!));
  return {
    nodes: Object.keys(display.nodes).length,
    powerLinks: display.links.filter((l) => l.kind === 'power' && l.to).length,
    signalLinks: display.links.filter((l) => l.kind === 'signal').length,
    explicitUnused: display.links.filter((l) => l.kind === 'power' && !l.to).length,
    roots: Object.keys(display.nodes).filter((id) => !homed.has(id)).length,
    byKind,
  };
}
