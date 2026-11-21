/**
 * Field-mode checklists, generated from the same model as the diagram (no separate copy).
 * Install runs outlet by outlet from the outlet outwards; teardown runs each outlet in
 * reverse, so things come down from the far end back to the wall.
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from './actions';
import { socketLabels } from './graph';
import type { Display, NodeKind, SignalType, Status } from './types';

export type ChecklistMode = 'install' | 'teardown';

export interface ChecklistRow {
  id: string;
  label: string;
  kind: NodeKind;
  depth: number;
  status: Status;
  packed: boolean;
  /** What it plugs into, e.g. "K01 · left". */
  into?: string;
  signal?: SignalType;
  storage?: string;
  isNew?: boolean;
  retired?: boolean;
  done: boolean;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  rows: ChecklistRow[];
  done: number;
  total: number;
}

export function checklist(display: Display, mode: ChecklistMode): ChecklistGroup[] {
  const groups: ChecklistGroup[] = [];
  const unplugged: ChecklistRow[] = [];
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = homeLink(display, id);
    const seen = new Set([id]);
    while (cur && !seen.has(cur.from)) {
      seen.add(cur.from);
      d++;
      cur = homeLink(display, cur.from);
    }
    return d;
  };
  const row = (id: string): ChecklistRow => {
    const n = display.nodes[id];
    const home = homeLink(display, id);
    let into: string | undefined;
    if (home) {
      const port = home.kind === 'power' ? socketLabels(display, home.from).get(home.id) : undefined;
      into = port ? `${home.from} · ${port}` : home.from;
    }
    const done = mode === 'install' ? n.status !== 'planned' : !!n.packed;
    return {
      id,
      label: n.label,
      kind: n.kind,
      depth: depthOf(id),
      status: n.status,
      packed: !!n.packed,
      into,
      signal: home?.kind === 'signal' ? home.signalType : undefined,
      storage: n.storage,
      isNew: n.isNew,
      retired: n.retired,
      done,
    };
  };
  for (const g of clusterMembers(display)) {
    const rows = g.members.map(row);
    const root = display.nodes[g.root];
    if (root.kind !== 'outlet') {
      unplugged.push(...rows);
      continue;
    }
    groups.push({ id: g.root, title: `${root.id} ${root.label}`.trim(), rows, done: 0, total: 0 });
  }
  if (unplugged.length) groups.push({ id: 'unplugged', title: 'Not plugged in yet', rows: unplugged, done: 0, total: 0 });
  for (const g of groups) {
    if (mode === 'teardown') g.rows.reverse();
    g.total = g.rows.length;
    g.done = g.rows.filter((r) => r.done).length;
  }
  return groups;
}
