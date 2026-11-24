/**
 * Device list for other tools (the show-control dashboard). A flat, documented JSON file so a
 * dashboard reads this app's items instead of keeping a third inventory. Read-only: nothing
 * imports it back; the wiring diagram stays the one place devices are edited.
 *
 * Format (holiday-devices v1), see README "Device file for other tools":
 *   { format, version, exportedAt, display: {id,title,season,year},
 *     devices: [{ id, name, kind, type, outlet, plugsInto, socket, link, zone, location,
 *                 circuit, watts, amps, qty, status, retired, storage, tags, notes }],
 *     signals: [{ from, to, type }] }
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink } from '../model/actions';
import { powerParent, socketLabels } from '../model/graph';
import type { Display, NodeKind, Season, SignalType, Status } from '../model/types';

export const DEVICES_FORMAT = 'holiday-devices';
export const DEVICES_VERSION = 1;

export interface DeviceRecord {
  id: string;
  name: string;
  kind: NodeKind;
  /** Load category (c9, projector, inflatable…) or power subtype (spt, timer…). */
  type: string | null;
  /** The wall outlet this item's power ultimately comes from (null when not plugged in). */
  outlet: string | null;
  plugsInto: string | null;
  socket: string | null;
  /** "power", or the signal type for items placed by a signal link (hdmi, ble…). */
  link: string | null;
  /** The item's own location, else the nearest one above it (usually the outlet's). */
  zone: string | null;
  location: string | null;
  /** The item's own circuit, else the nearest one above it. */
  circuit: string | null;
  /** As entered: the total for the line (qty included). Null when not known. */
  watts: number | null;
  amps: number | null;
  qty: number;
  status: Status;
  retired: boolean;
  storage: string | null;
  tags: string[];
  notes: string | null;
}

export interface DeviceFile {
  format: typeof DEVICES_FORMAT;
  version: number;
  exportedAt: string;
  display: { id: string; title: string; season: Season; year: number | null };
  devices: DeviceRecord[];
  signals: { from: string; to: string; type: SignalType }[];
}

/** Walk up the power/home links, returning the first value `pick` finds (the item itself first). */
function inherited(display: Display, id: string, pick: (id: string) => string | undefined): string | null {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const v = pick(cur);
    if (v) return v;
    cur = homeLink(display, cur)?.from;
  }
  return null;
}

/** The wall outlet at the top of this item's power chain (power links only), or null. */
function rootOutlet(display: Display, id: string): string | null {
  const seen = new Set<string>([id]);
  let cur = id;
  for (let up = powerParent(display, cur); up && !seen.has(up.from); up = powerParent(display, cur)) {
    seen.add(up.from);
    cur = up.from;
  }
  return display.nodes[cur]?.kind === 'outlet' ? cur : null;
}

export function devicesFile(display: Display, now = new Date()): DeviceFile {
  const devices: DeviceRecord[] = [];
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      const n = display.nodes[id];
      const home = homeLink(display, id);
      const socket = home?.kind === 'power' ? socketLabels(display, home.from).get(home.id) : undefined;
      devices.push({
        id,
        name: n.label,
        kind: n.kind,
        type: (n.kind === 'load' ? n.category : n.subtype) ?? null,
        outlet: rootOutlet(display, id),
        plugsInto: home?.from ?? null,
        socket: socket ?? null,
        link: home ? (home.kind === 'power' ? 'power' : (home.signalType ?? 'data')) : null,
        zone: inherited(display, id, (x) => display.nodes[x]?.location),
        location: n.location ?? null,
        circuit: inherited(display, id, (x) => display.nodes[x]?.circuit),
        watts: n.watts ?? null,
        amps: n.amps ?? null,
        qty: n.qty ?? 1,
        status: n.status,
        retired: !!n.retired,
        storage: n.storage ?? null,
        tags: [...n.tags],
        notes: n.notes ?? null,
      });
    }
  }
  const signals = display.links
    .filter((l): l is typeof l & { to: string } => l.kind === 'signal' && !!l.to)
    .map((l) => ({ from: l.from, to: l.to, type: l.signalType ?? 'data' }));
  return {
    format: DEVICES_FORMAT,
    version: DEVICES_VERSION,
    exportedAt: now.toISOString(),
    display: { id: display.id, title: display.title, season: display.season, year: display.year ?? null },
    devices,
    signals,
  };
}
