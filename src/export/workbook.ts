/**
 * Excel workbook export and import for one display.
 *
 * Export: an "Items" sheet (one row per item, with what it plugs into) and a small "Display"
 * sheet (title, season, year). Import reads the same layout back as a NEW display; it never
 * changes one that is already on this device.
 *
 * The workbook holds items and wiring. Photo placements, light looks and restore points live
 * only in the JSON backup, which stays the complete copy.
 */
import { clusterMembers } from '../diagram/layout';
import { homeLink, subtreeIds } from '../model/actions';
import { socketLabels } from '../model/graph';
import { inferCategory, inferKind, signalTypeFromWord } from '../outline/infer';
import { SUBTYPE_WORD } from '../outline/parse';
import { formatId, seasonFromTitle } from '../outline/build';
import {
  type Display,
  type DisplayNode,
  ID_PREFIX,
  LOAD_CATEGORIES,
  type Link,
  type LoadCategory,
  type Marks,
  NODE_KINDS,
  type NodeKind,
  type Season,
  SIGNAL_TYPES,
  type SignalType,
  STATUSES,
  type Status,
} from '../model/types';
import { type Cell, type Sheet, readXlsx, writeXlsx } from './xlsx';
import { TIE_COLORS } from './labels';

export const WORKBOOK_FORMAT = 'wiring-sketchpad-items';
export const WORKBOOK_VERSION = 1;

export const ITEMS_SHEET = 'Items';
export const DISPLAY_SHEET = 'Display';

/** Column order of the Items sheet. Import finds columns by header name, so order can change. */
export const WORKBOOK_COLUMNS = [
  'id',
  'kind',
  'type',
  'name',
  'plugs_into',
  'socket',
  'link',
  'status',
  'qty',
  'watts',
  'amps',
  'length_ft',
  'sockets',
  'end_female',
  'location',
  'circuit',
  'breaker_amps',
  'gfci',
  'color',
  'storage',
  'tags',
  'new_this_year',
  'retired',
  'packed',
  'signal_from',
  'notes',
  'story',
  'tie_color',
  'label_text',
  'no_label',
  'label_printed',
] as const;

type Column = (typeof WORKBOOK_COLUMNS)[number];

/** Row kind for an explicitly empty socket ("Unused socket" in the outline). */
export const UNUSED_KIND = 'unused socket';

const approx = (v: number | undefined, isApprox: boolean | undefined): Cell =>
  v === undefined ? undefined : isApprox ? `~${v}` : v;
const yes = (b: boolean | undefined) => (b ? 'yes' : undefined);

function itemRow(display: Display, n: DisplayNode): Cell[] {
  const home = homeLink(display, n.id);
  const socket = home?.kind === 'power' ? socketLabels(display, home.from).get(home.id) : undefined;
  // Extra signal links into this item that do not place it (e.g. a second HDMI feed).
  const signalFrom = display.links
    .filter((l) => l.kind === 'signal' && l.to === n.id && !l.owns)
    .sort((a, b) => a.from.localeCompare(b.from) || a.seq - b.seq)
    .map((l) => `${l.from} ${l.signalType ?? 'data'}`)
    .join('; ');
  const values: Record<Column, Cell> = {
    id: n.id,
    kind: n.kind,
    type: n.kind === 'load' ? n.category : n.subtype,
    name: n.label,
    plugs_into: home?.from,
    socket,
    link: home ? (home.kind === 'power' ? 'power' : (home.signalType ?? 'data')) : undefined,
    status: n.status,
    qty: n.qty,
    watts: approx(n.watts, n.wattsApprox),
    amps: approx(n.amps, n.ampsApprox),
    length_ft: approx(n.lengthFt, n.lengthApprox),
    sockets: n.outputs,
    end_female: n.endFemale === false ? 'no' : undefined,
    location: n.location,
    circuit: n.circuit,
    breaker_amps: n.breakerAmps,
    gfci: yes(n.gfci),
    color: n.color,
    storage: n.storage,
    tags: n.tags.join('; ') || undefined,
    new_this_year: yes(n.isNew),
    retired: yes(n.retired),
    packed: yes(n.packed),
    signal_from: signalFrom || undefined,
    notes: n.notes,
    story: n.story,
    tie_color: n.tieColor,
    label_text: n.labelText,
    no_label: yes(n.labelSkip),
    label_printed: yes(n.labelPrinted),
  };
  return WORKBOOK_COLUMNS.map((c) => values[c]);
}

/** Rows of the Items sheet, header first, in diagram order (each outlet, then its branches). */
export function itemsRows(display: Display): Cell[][] {
  const rows: Cell[][] = [[...WORKBOOK_COLUMNS]];
  const col = (c: Column) => WORKBOOK_COLUMNS.indexOf(c);
  for (const g of clusterMembers(display)) {
    for (const id of g.members) {
      rows.push(itemRow(display, display.nodes[id]));
      // Written "Unused socket" lines follow the item they belong to.
      const labels = socketLabels(display, id);
      for (const l of display.links.filter((x) => x.kind === 'power' && x.from === id && x.to === null).sort((a, b) => a.seq - b.seq)) {
        const r: Cell[] = WORKBOOK_COLUMNS.map(() => undefined);
        r[col('kind')] = UNUSED_KIND;
        r[col('name')] = 'Unused socket';
        r[col('plugs_into')] = id;
        r[col('socket')] = labels.get(l.id);
        r[col('link')] = 'power';
        rows.push(r);
      }
    }
  }
  return rows;
}

export function displaySheetRows(display: Display): Cell[][] {
  return [
    ['field', 'value'],
    ['title', display.title],
    ['season', display.season],
    ['year', display.year],
    ['format', WORKBOOK_FORMAT],
    ['version', WORKBOOK_VERSION],
    ['zip_tie_colors', display.marks?.colors ? 'yes' : 'no'],
    ['zip_ties_per_story', display.marks?.stories ? 'yes' : 'no'],
    ['note', 'Items and wiring only. Photos and light looks are in the JSON backup.'],
  ];
}

export function displayToWorkbook(display: Display): Uint8Array {
  return writeXlsx([
    { name: ITEMS_SHEET, rows: itemsRows(display) },
    { name: DISPLAY_SHEET, rows: displaySheetRows(display) },
  ]);
}

// ---------------------------------------------------------------- import

export class WorkbookError extends Error {}

export interface WorkbookImport {
  display: Display;
  /** Things that were fixed up on the way in, one line each, for a toast or log. */
  warnings: string[];
}

const str = (v: Cell): string => (v === undefined || v === null ? '' : String(v)).trim();

function numberCell(v: Cell): { value?: number; approx?: boolean } {
  const s = str(v);
  if (!s) return {};
  const m = /^(~)?\s*(-?\d+(?:\.\d+)?)\s*(?:w|a|ft|')?$/i.exec(s);
  if (!m) return {};
  return { value: Number(m[2]), approx: m[1] ? true : undefined };
}

const truthy = (v: Cell) => v === true || /^(yes|y|true|1|x|✓)$/i.test(str(v));
const falsy = (v: Cell) => v === false || /^(no|n|false|0)$/i.test(str(v));

function findSheet(sheets: Sheet[], name: string): Sheet | undefined {
  return sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
}

const normHeader = (h: Cell) => str(h).toLowerCase().replace(/[\s-]+/g, '_');

/** The zip-tie switches from the Display sheet (both off when missing). */
function marksFrom(sheets: Sheet[]): Marks | undefined {
  const info = new Map<string, Cell>();
  for (const r of findSheet(sheets, DISPLAY_SHEET)?.rows.slice(1) ?? []) if (r && str(r[0])) info.set(normHeader(r[0]), r[1]);
  const colors = truthy(info.get('zip_tie_colors')) || undefined;
  const stories = truthy(info.get('zip_ties_per_story')) || undefined;
  return colors || stories ? { colors, stories } : undefined;
}

/** A tie colour typed as a name ("Red") becomes the colour id ("red"). */
const tieColorFrom = (v: Cell) => {
  const s = str(v).toLowerCase();
  return s ? (TIE_COLORS.find((c) => c.id === s || c.name.toLowerCase() === s)?.id ?? s) : undefined;
};

function titleFrom(sheets: Sheet[], fallback: string): { title: string; season: Season; year?: number } {
  const info = new Map<string, Cell>();
  for (const r of findSheet(sheets, DISPLAY_SHEET)?.rows.slice(1) ?? []) if (r && str(r[0])) info.set(str(r[0]).toLowerCase(), r[1]);
  const title = str(info.get('title')) || fallback || 'Imported display';
  const guess = seasonFromTitle(title);
  const seasonText = str(info.get('season')).toLowerCase();
  const season: Season = seasonText === 'halloween' || seasonText === 'christmas' || seasonText === 'other' ? seasonText : guess.season;
  const y = numberCell(info.get('year')).value;
  return { title, season, year: y && Number.isInteger(y) ? y : guess.year };
}

/**
 * Read a workbook exported by this app (or one laid out the same way) as a new display.
 * Rows only need a name; a missing id, kind or socket is filled in the same way typing the
 * item would. Bad references become warnings and leave the item not plugged in.
 */
export function workbookToDisplay(data: Uint8Array, id: string, fallbackTitle = ''): WorkbookImport {
  const sheets = readXlsx(data);
  const sheet = findSheet(sheets, ITEMS_SHEET) ?? sheets[0];
  const header = (sheet.rows[0] ?? []).map(normHeader);
  const at = (c: Column | 'name') => header.indexOf(c);
  if (at('name') < 0) throw new WorkbookError(`The "${sheet.name}" sheet needs a "name" column in its first row.`);
  const get = (row: Cell[], c: Column): Cell => (at(c) >= 0 ? row[at(c)] : undefined);

  const { title, season, year } = titleFrom(sheets, fallbackTitle);
  const warnings: string[] = [];
  const display: Display = {
    id,
    title,
    season,
    year,
    nodes: {},
    links: [],
    comments: [{ id: 'c-title', parent: null, seq: -1, text: `# ${title}` }],
  };
  const marks = marksFrom(sheets);
  if (marks) display.marks = marks;

  interface Pending {
    row: number;
    nodeId?: string;
    parent: string;
    socket?: string;
    link: string;
    signalFrom?: string;
  }
  const pending: Pending[] = [];
  const usedIds = new Set<string>();
  const nextId = (kind: NodeKind) => {
    const prefix = ID_PREFIX[kind];
    let n = 1;
    for (const k of [...usedIds, ...Object.keys(display.nodes)]) if (k[0] === prefix) n = Math.max(n, (Number(k.slice(1)) || 0) + 1);
    return formatId(prefix, n);
  };

  // Pass 1: rows → nodes. IDs written in the sheet are kept; missing ones are numbered after.
  const rows = sheet.rows.slice(1).map((row, i) => ({ row: row ?? [], line: i + 2 }));
  for (const { row } of rows) {
    const rid = str(get(row, 'id')).toUpperCase();
    if (rid) usedIds.add(rid);
  }
  let topSeq = 0;
  for (const { row, line } of rows) {
    const name = str(get(row, 'name'));
    const kindText = str(get(row, 'kind')).toLowerCase();
    const parent = str(get(row, 'plugs_into')).toUpperCase();
    const socket = str(get(row, 'socket')) || undefined;
    const link = str(get(row, 'link')).toLowerCase() || 'power';
    if (kindText === UNUSED_KIND || (/^unused socket$/i.test(name) && !str(get(row, 'id')))) {
      if (parent) pending.push({ row: line, parent, socket, link: 'power' });
      continue;
    }
    if (!name && !str(get(row, 'id'))) continue; // blank row
    let kind = (NODE_KINDS as readonly string[]).includes(kindText) ? (kindText as NodeKind) : undefined;
    const guess = inferKind(name, parent ? 1 : 0);
    if (!kind) {
      if (kindText) warnings.push(`Row ${line}: kind "${kindText}" is not known; used ${guess.kind}.`);
      kind = guess.kind;
    }
    let nid = str(get(row, 'id')).toUpperCase();
    if (!/^[A-Z]\d+$/.test(nid) || display.nodes[nid]) {
      if (nid) warnings.push(`Row ${line}: id ${nid} ${display.nodes[nid] ? 'is used twice' : 'is not an item id'}; gave it a new one.`);
      nid = nextId(kind);
    }
    usedIds.add(nid);
    const type = str(get(row, 'type')).toLowerCase();
    const statusText = str(get(row, 'status')).toLowerCase();
    const status: Status = (STATUSES as readonly string[]).includes(statusText) ? (statusText as Status) : 'planned';
    const watts = numberCell(get(row, 'watts'));
    const amps = numberCell(get(row, 'amps'));
    const length = numberCell(get(row, 'length_ft'));
    const outputs = numberCell(get(row, 'sockets')).value;
    const qty = numberCell(get(row, 'qty')).value;
    const breaker = numberCell(get(row, 'breaker_amps')).value;
    const tags = str(get(row, 'tags'))
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const category: LoadCategory | undefined =
      kind === 'load' ? ((LOAD_CATEGORIES as readonly string[]).includes(type) ? (type as LoadCategory) : (inferCategory(name) ?? 'other')) : undefined;
    const subtype = kind !== 'load' && type && type in SUBTYPE_WORD ? type : kind !== 'load' && guess.kind === kind ? guess.subtype : undefined;
    const node: DisplayNode = {
      id: nid,
      kind,
      label: name,
      status,
      tags,
      subtype,
      category,
      outputs: outputs !== undefined && outputs >= 0 ? Math.round(outputs) : undefined,
      qty: qty !== undefined && qty > 0 ? qty : undefined,
      watts: watts.value,
      wattsApprox: watts.approx,
      amps: amps.value,
      ampsApprox: amps.approx,
      lengthFt: length.value,
      lengthApprox: length.approx,
      breakerAmps: breaker,
      gfci: truthy(get(row, 'gfci')) || undefined,
      color: str(get(row, 'color')) || undefined,
      location: str(get(row, 'location')) || undefined,
      circuit: str(get(row, 'circuit')) || undefined,
      storage: str(get(row, 'storage')) || undefined,
      notes: str(get(row, 'notes')) || undefined,
      isNew: truthy(get(row, 'new_this_year')) || undefined,
      retired: truthy(get(row, 'retired')) || undefined,
      packed: truthy(get(row, 'packed')) || undefined,
      endFemale: falsy(get(row, 'end_female')) ? false : undefined,
      story: (() => {
        const v = numberCell(get(row, 'story')).value;
        return v !== undefined && v >= 2 ? Math.round(v) : undefined;
      })(),
      tieColor: tieColorFrom(get(row, 'tie_color')),
      labelText: str(get(row, 'label_text')) || undefined,
      labelSkip: truthy(get(row, 'no_label')) || undefined,
      labelPrinted: truthy(get(row, 'label_printed')) || undefined,
    };
    for (const k of Object.keys(node) as (keyof DisplayNode)[]) if (node[k] === undefined) delete node[k];
    display.nodes[nid] = node;
    if (parent) pending.push({ row: line, nodeId: nid, parent, socket, link, signalFrom: str(get(row, 'signal_from')) || undefined });
    else {
      node.seq = topSeq++;
      if (str(get(row, 'signal_from'))) pending.push({ row: line, nodeId: nid, parent: '', link, signalFrom: str(get(row, 'signal_from')) });
    }
  }

  // Pass 2: wiring, in row order so unlabelled sockets number the same way as on export.
  const childSeq = new Map<string, number>();
  const seqFor = (from: string) => {
    const n = childSeq.get(from) ?? 0;
    childSeq.set(from, n + 1);
    return n;
  };
  let linkN = 0;
  const addLink = (l: Omit<Link, 'id' | 'seq'>) => {
    const link: Link = { id: `a${++linkN}`, seq: seqFor(l.from), ...l } as Link;
    display.links.push(link);
    return link;
  };
  const unplug = (p: Pending, why: string) => {
    warnings.push(`Row ${p.row}: ${why}; left it not plugged in.`);
    if (p.nodeId) display.nodes[p.nodeId].seq = topSeq++;
  };
  for (const p of pending) {
    if (!p.parent) continue;
    if (!display.nodes[p.parent]) {
      if (p.nodeId) unplug(p, `plugs into ${p.parent}, which is not in the sheet`);
      else warnings.push(`Row ${p.row}: unused socket on ${p.parent}, which is not in the sheet; skipped.`);
      continue;
    }
    if (p.nodeId && (p.parent === p.nodeId || subtreeIds(display, p.nodeId).has(p.parent))) {
      unplug(p, `plugging into ${p.parent} would make a loop`);
      continue;
    }
    if (p.link === 'power') {
      const link = addLink({ kind: 'power', from: p.parent, to: p.nodeId ?? null });
      // Keep the written socket only where automatic numbering would say something else.
      if (p.socket !== undefined && socketLabels(display, p.parent).get(link.id) !== p.socket) link.port = p.socket;
    } else {
      const signalType = (SIGNAL_TYPES as readonly string[]).includes(p.link) ? (p.link as SignalType) : (signalTypeFromWord(p.link) ?? 'data');
      addLink({ kind: 'signal', from: p.parent, to: p.nodeId!, signalType, owns: true });
    }
  }
  // Pass 3: extra signal links ("K03 hdmi; K04 hdmi").
  for (const p of pending) {
    if (!p.signalFrom || !p.nodeId) continue;
    for (const part of p.signalFrom.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      const [fromRaw, typeRaw] = part.split(/\s+/);
      const from = fromRaw.toUpperCase();
      if (!display.nodes[from]) {
        warnings.push(`Row ${p.row}: signal from ${from}, which is not in the sheet; skipped.`);
        continue;
      }
      const t = (typeRaw ?? 'data').toLowerCase();
      const signalType = (SIGNAL_TYPES as readonly string[]).includes(t) ? (t as SignalType) : (signalTypeFromWord(t) ?? 'data');
      addLink({ kind: 'signal', from, to: p.nodeId, signalType, owns: false });
    }
  }
  if (!Object.keys(display.nodes).length) throw new WorkbookError(`The "${sheet.name}" sheet has no items.`);
  return { display, warnings };
}
