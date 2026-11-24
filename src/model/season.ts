/** Seasons: copy a display for next year, and compare a copy with its source. */
import { homeLink } from './actions';
import { socketLabels } from './graph';
import type { Display } from './types';

/** "Halloween 2026" → "Halloween 2027"; titles without a year get " (copy)". */
export function nextTitle(title: string): string {
  const m = /\b(20\d\d)\b/.exec(title);
  if (!m) return `${title} (copy)`;
  return title.slice(0, m.index) + String(Number(m[1]) + 1) + title.slice(m.index + 4);
}

/**
 * Copy a display as next year's plan: same items, IDs and wiring; every status back to
 * planned, "new" and "packed" cleared. Retired items are kept (removing them would change
 * wiring); they stay grey until you delete them.
 */
export function copyForNextYear(source: Display, id: string, title = nextTitle(source.title)): Display {
  const d: Display = structuredClone(source);
  d.id = id;
  d.copiedFrom = source.id;
  d.title = title;
  for (const n of Object.values(d.nodes)) {
    n.status = 'planned';
    delete n.isNew;
    delete n.packed;
  }
  // The title lives in the first top-level heading line.
  const heading = d.comments
    .filter((c) => c.parent === null && !c.raw && c.text.startsWith('#'))
    .sort((a, b) => a.seq - b.seq)[0];
  if (heading) heading.text = `# ${title}`;
  else d.comments.push({ id: 'c-title', parent: null, seq: -1, text: `# ${title}` });
  return d;
}

export type ChangeKind = 'added' | 'removed' | 'moved' | 'renamed';

export interface Change {
  kind: ChangeKind;
  id: string;
  label: string;
  /** For moved: old position; for renamed: old name. */
  from?: string;
  to?: string;
}

function placeOf(d: Display, id: string): string {
  const home = homeLink(d, id);
  if (!home) return 'not plugged in';
  if (home.kind === 'signal') return `${home.signalType?.toUpperCase() ?? 'signal'} from ${home.from}`;
  const port = socketLabels(d, home.from).get(home.id);
  return port ? `${home.from} · ${port}` : home.from;
}

/** What changed between last year's display and this one, by item ID. */
export function compareDisplays(before: Display, after: Display): Change[] {
  const out: Change[] = [];
  for (const n of Object.values(after.nodes)) {
    const old = before.nodes[n.id];
    if (!old) {
      out.push({ kind: 'added', id: n.id, label: n.label, to: placeOf(after, n.id) });
      continue;
    }
    const a = placeOf(before, n.id);
    const b = placeOf(after, n.id);
    if (a !== b) out.push({ kind: 'moved', id: n.id, label: n.label, from: a, to: b });
    if (old.label !== n.label) out.push({ kind: 'renamed', id: n.id, label: n.label, from: old.label, to: n.label });
  }
  for (const n of Object.values(before.nodes)) {
    if (!after.nodes[n.id]) out.push({ kind: 'removed', id: n.id, label: n.label, from: placeOf(before, n.id) });
  }
  const order: Record<ChangeKind, number> = { added: 0, moved: 1, renamed: 2, removed: 3 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
}

export interface SnapshotMeta {
  id: number;
  at: number;
  reason: 'auto' | 'manual' | 'before-restore' | 'sync';
}

/** Snapshot ids to delete: keep every manual one and the newest `keepAuto` others. */
export function snapshotsToPrune(list: SnapshotMeta[], keepAuto = 20): number[] {
  return list
    .filter((s) => s.reason !== 'manual' && s.reason !== 'sync')
    .sort((a, b) => b.at - a.at)
    .slice(keepAuto)
    .map((s) => s.id);
}
