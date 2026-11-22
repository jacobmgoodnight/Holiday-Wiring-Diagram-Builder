/** CSV export: one row per item with its connection. Safe to open in a spreadsheet. */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { socketLabels } from '../model/graph';
import type { Display } from '../model/types';

/** Quote when needed, and neutralise text a spreadsheet would run as a formula. */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const ITEM_COLUMNS = [
  'id',
  'kind',
  'name',
  'plugs_into',
  'socket',
  'link',
  'status',
  'qty',
  'length_ft',
  'sockets',
  'tags',
  'storage',
  'new_this_year',
  'retired',
  'notes',
] as const;

export function displayToCsv(display: Display): string {
  const rows: unknown[][] = [[...ITEM_COLUMNS]];
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      const n = display.nodes[id];
      const home = homeLink(display, id);
      const socket = home?.kind === 'power' ? socketLabels(display, home.from).get(home.id) : undefined;
      rows.push([
        n.id,
        n.kind,
        n.label,
        home?.from,
        socket,
        home ? (home.kind === 'power' ? 'power' : (home.signalType ?? 'signal')) : '',
        n.status,
        n.qty,
        n.lengthFt !== undefined ? `${n.lengthApprox ? '~' : ''}${n.lengthFt}` : '',
        n.outputs,
        n.tags.join('; '),
        n.storage,
        n.isNew ? 'yes' : '',
        n.retired ? 'yes' : '',
        n.notes,
      ]);
    }
  }
  return toCsv(rows);
}
