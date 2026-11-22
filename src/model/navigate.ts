/** Moving the selection around the tree with the arrow keys (mind-map style). */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from './actions';
import type { Display, DisplayNode } from './types';

/** Items plugged into (or signal-only items hanging off) a node, in outline order. */
export function childrenOf(display: Display, id: string): string[] {
  return display.links
    .filter((l) => l.from === id && l.to && (l.kind === 'power' || l.owns))
    .sort((a, b) => a.seq - b.seq)
    .map((l) => l.to!);
}

export function parentOf(display: Display, id: string): string | undefined {
  return homeLink(display, id)?.from;
}

/** Top-level items (outlets and unplugged items), in outline order. */
export function rootsOf(display: Display): string[] {
  return clusterMembers(display).map((g) => g.root);
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Left = what it plugs into, right = first thing plugged into it, up/down = the item above
 * or below on the same parent. Items hidden in a collapsed branch are skipped.
 */
export function navigate(display: Display, id: string, dir: Direction, collapsed: ReadonlySet<string> = new Set()): string | undefined {
  if (dir === 'left') return parentOf(display, id);
  if (dir === 'right') return collapsed.has(id) ? undefined : childrenOf(display, id)[0];
  const parent = parentOf(display, id);
  const row = parent ? childrenOf(display, parent) : rootsOf(display);
  const i = row.indexOf(id);
  const j = dir === 'up' ? i - 1 : i + 1;
  return j >= 0 && j < row.length ? row[j] : undefined;
}

/** Items matching a search: ID first, then names that start with it, then anything containing it. */
export function findNodes(display: Display, query: string, max = 8): DisplayNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [DisplayNode, number][] = [];
  for (const n of Object.values(display.nodes)) {
    const id = n.id.toLowerCase();
    const label = n.label.toLowerCase();
    const tags = n.tags.join(' ');
    let score = -1;
    if (id === q) score = 0;
    else if (id.startsWith(q)) score = 1;
    else if (label.startsWith(q)) score = 2;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 3;
    else if (label.includes(q) || tags.includes(q) || (n.storage ?? '').toLowerCase().includes(q)) score = 4;
    if (score >= 0) scored.push([n, score]);
  }
  return scored
    .sort((a, b) => a[1] - b[1] || a[0].id.localeCompare(b[0].id, undefined, { numeric: true }))
    .slice(0, max)
    .map(([n]) => n);
}
