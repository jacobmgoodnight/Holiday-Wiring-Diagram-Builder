/**
 * Install steps (pure): the plug-in order, outlet by outlet, in plain sentences, for the
 * install sheet and install mode. "Start at O01 Outlet (Front porch)", "Plug C01 Green
 * extension cord 40 ft into O01", "Plug L02 C9 roofline run into L01's end female"…
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { isRun, socketLabels } from '../model/graph';
import type { Display, DisplayNode } from '../model/types';
import { photoItems } from './takeoff';

export interface InstallStep {
  /** 1, 2, 3… in order. */
  n: number;
  id: string;
  /** "Plug L02 C9 roofline run into L01's end female." */
  text: string;
  /** The item is on the photo the steps are for (it gets a numbered badge there). */
  onPhoto: boolean;
  /** Installed (or checked) already. */
  done: boolean;
}

/** "C01 Green extension cord 40 ft": ID, name, and length when the name does not say it. */
export function itemName(n: DisplayNode): string {
  const len = n.lengthFt !== undefined && !/\d\s*(ft|feet|')/i.test(n.label) ? ` ${n.lengthApprox ? '~' : ''}${Math.round(n.lengthFt)} ft` : '';
  return `${n.id} ${n.label || '(no name)'}${len}`;
}

/** Where something plugs in, in words: "O01", "L01's end female", "C03 tap 2", "S01 socket 2". */
function intoText(display: Display, id: string): string | undefined {
  const home = homeLink(display, id);
  if (!home) return undefined;
  if (home.kind === 'signal') return `${home.from} (${home.signalType?.toUpperCase() ?? 'signal'})`;
  const parent = display.nodes[home.from];
  const port = socketLabels(display, home.from).get(home.id);
  // Any receptacle of a wall outlet will do; sockets on gear and runs matter.
  if (!port || parent?.kind === 'outlet') return home.from;
  if (isRun(parent)) return port === 'end' ? `${home.from}'s end female` : `${home.from} ${port.replace(/^tap/, 'tap ')}`;
  if (/^\d+$/.test(port)) return `${home.from} socket ${port}`;
  return `${home.from} ${port}`;
}

export function installSteps(display: Display, opts: { viewId?: string } = {}): InstallStep[] {
  const only = opts.viewId ? photoItems(display, opts.viewId) : undefined;
  const steps: InstallStep[] = [];
  const loose: string[] = [];
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      const n = display.nodes[id];
      if (!n || n.retired || (only && !only.has(id))) continue;
      const into = intoText(display, id);
      let text: string;
      if (n.kind === 'outlet') {
        const where = [n.location, n.gfci ? 'GFCI' : ''].filter(Boolean).join(', ');
        text = `Start at ${itemName(n)}${where ? ` (${where})` : ''}.`;
      } else if (into) {
        const home = homeLink(display, id);
        text = home?.kind === 'signal' ? `Connect ${itemName(n)} to ${into}.` : `Plug ${itemName(n)} into ${into}.`;
      } else {
        loose.push(id);
        continue;
      }
      steps.push({ n: 0, id, text, onPhoto: !!(opts.viewId && n.placements?.[opts.viewId]), done: n.status !== 'planned' });
    }
  }
  // Not plugged in yet: listed last so nothing is forgotten.
  for (const id of loose) {
    const n = display.nodes[id];
    steps.push({ n: 0, id, text: `Put up ${itemName(n)} (not plugged in yet in the plan).`, onPhoto: !!(opts.viewId && n.placements?.[opts.viewId]), done: n.status !== 'planned' });
  }
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}
