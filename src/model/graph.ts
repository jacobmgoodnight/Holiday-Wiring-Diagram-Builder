/** Read-only graph helpers shared by the diagram, checks and tests. */
import type { Display, DisplayNode, Link } from './types';

/** Light strings that have female connectors (end-to-end, or inline taps). */
export const RUN_CATEGORIES = new Set(['c9', 'mini', 'icicle', 'pathway']);

/** SPT-1 zip cord, multi-outlet cords and light strings: a wire with female taps along it. */
export function isRun(node: Pick<DisplayNode, 'kind' | 'subtype' | 'category'> | undefined): boolean {
  if (!node) return false;
  if (node.kind === 'cord') return node.subtype === 'spt' || node.subtype === 'multi-outlet';
  return node.kind === 'load' && RUN_CATEGORIES.has(node.category ?? '');
}

/** A C9 stringer: bulk SPT-1 wire with sockets, cut to length (not a pre-made string). */
export function isStringer(node: Pick<DisplayNode, 'category' | 'label'>): boolean {
  return node.category === 'c9' && /\b(stringer|spool|bulk)\b/i.test(node.label);
}

/**
 * Wire you can splice a vampire female into anywhere: SPT-1 zip cord and C9 stringer.
 * (Pre-made light strings and multi-outlet cords have their females where they were made.)
 */
export function spliceable(node: Pick<DisplayNode, 'kind' | 'subtype' | 'category' | 'label'> | undefined): boolean {
  if (!node) return false;
  return (node.kind === 'cord' && node.subtype === 'spt') || isStringer(node);
}

/**
 * Socket names of a run with a known socket count: inline females `tap1`…`tapN`, then `end`
 * (unless it has no female at the end). Undefined for anything else.
 */
export function runSockets(node: DisplayNode | undefined): string[] | undefined {
  if (!node || !isRun(node) || node.outputs === undefined) return undefined;
  const end = node.endFemale !== false;
  const taps = Math.max(0, node.outputs - (end ? 1 : 0));
  return [...Array.from({ length: taps }, (_, i) => `tap${i + 1}`), ...(end ? ['end'] : [])];
}

/** Inline female taps on a run (0 when it has none or is not a run). */
export function inlineFemales(node: DisplayNode | undefined): number {
  const names = runSockets(node);
  return names ? names.filter((n) => n.startsWith('tap')).length : 0;
}

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
  const names = runSockets(node);
  if (names) {
    // Runs: unlabelled items fill the inline females in order, then the end female.
    const taken = new Set(children.map((l) => l.port).filter(Boolean) as string[]);
    const out = new Map<string, string | undefined>();
    let extra = names.filter((n) => n.startsWith('tap')).length;
    for (const link of children) {
      if (link.port) {
        out.set(link.id, link.port);
        continue;
      }
      let name = names.find((n) => !taken.has(n));
      if (!name) {
        while (taken.has(`tap${++extra}`));
        name = `tap${extra}`;
      }
      taken.add(name);
      out.set(link.id, name);
    }
    return out;
  }
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
