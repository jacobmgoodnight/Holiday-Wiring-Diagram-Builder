/**
 * Cord and plug labels, e.g. "C02: K01-left → S02": the item's ID, where it plugs in, and
 * what plugs into it. Generated from the plan, in outline order, outlet by outlet.
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { powerChildren, socketLabels } from '../model/graph';
import type { Display } from '../model/types';

export interface LabelOptions {
  /** Also label things that use power (props, lights), not just cords and gear. */
  includeLoads?: boolean;
  /** Cords get two labels: one for the plug end, one for the socket end. */
  bothEnds?: boolean;
  /** Add "store in …" when a storage spot is set. */
  storage?: boolean;
}

export interface Label {
  key: string;
  id: string;
  /** Big first line: the ID, or "C02 plug" / "C02 end". */
  heading: string;
  /** Item name, e.g. "black cord". */
  name: string;
  /** Short connection line, e.g. "K01-left → S02". */
  route: string;
  storage?: string;
  /** One-line text for label makers. */
  text: string;
}

function where(display: Display, id: string): string | undefined {
  const home = homeLink(display, id);
  if (!home) return undefined;
  if (home.kind === 'signal') return `${home.signalType?.toUpperCase() ?? 'signal'} from ${home.from}`;
  const port = socketLabels(display, home.from).get(home.id);
  return port ? `${home.from}-${port}` : home.from;
}

function feeds(display: Display, id: string): string | undefined {
  const kids = powerChildren(display, id)
    .map((l) => l.to)
    .filter((x): x is string => !!x);
  if (!kids.length) return undefined;
  return kids.length <= 3 ? kids.join(', ') : `${kids.slice(0, 3).join(', ')} +${kids.length - 3}`;
}

export function labelsFor(display: Display, opts: LabelOptions = {}): Label[] {
  const out: Label[] = [];
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      const n = display.nodes[id];
      if (n.kind === 'outlet') continue; // the wall is not labelled
      if (n.kind === 'load' && !opts.includeLoads) continue;
      const from = where(display, id);
      const to = feeds(display, id);
      const storage = opts.storage && n.storage ? n.storage : undefined;
      const tail = storage ? ` (store in ${storage})` : '';
      const make = (key: string, route: string, heading = id, sep = ': '): Label => ({
        key,
        id,
        heading,
        name: n.label,
        route,
        storage,
        text: `${heading}${sep}${route}${tail}`,
      });
      if (opts.bothEnds && n.kind === 'cord') {
        out.push(make(`${id}:plug`, `→ ${from ?? 'not plugged in'}`, `${id} plug`, ' '));
        out.push(make(`${id}:end`, `→ ${to ?? 'nothing yet'}`, `${id} end`, ' '));
        continue;
      }
      const route = from && to ? `${from} → ${to}` : from ? `${from}` : to ? `→ ${to}` : 'not plugged in';
      out.push(make(id, route));
    }
  }
  return out;
}
