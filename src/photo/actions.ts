/** Photo view actions (pure). Placing items never changes their wiring. */
import { type ActionResult, ActionError, type NewItem, type Target, addNode, replug, subtreeIds } from '../model/actions';
import { inlineFemales, isRun, powerChildren, socketLabels } from '../model/graph';
import type { Display, Placement, PhotoView } from '../model/types';
import { cordFor, drawnAsRun, gapFt, plugPoint, runSocketSpots, tapPositions } from './geometry';

const clone = (d: Display): Display => structuredClone(d);

export function addView(display: Display, view: PhotoView): ActionResult {
  const d = clone(display);
  d.views = [...(d.views ?? []), view];
  return { display: d };
}

/** Remove a photo view and every placement on it (the items themselves stay). */
export function removeView(display: Display, viewId: string): ActionResult {
  const d = clone(display);
  d.views = (d.views ?? []).filter((v) => v.id !== viewId);
  if (!d.views.length) delete d.views;
  for (const n of Object.values(d.nodes)) {
    if (n.placements?.[viewId]) {
      delete n.placements[viewId];
      if (!Object.keys(n.placements).length) delete n.placements;
    }
  }
  return { display: d };
}

export function updateView(display: Display, viewId: string, patch: Partial<Pick<PhotoView, 'name' | 'feetPerPx'>>): ActionResult {
  const d = clone(display);
  const v = d.views?.find((x) => x.id === viewId);
  if (!v) throw new ActionError('That photo is no longer here');
  Object.assign(v, patch);
  if (v.feetPerPx === undefined) delete v.feetPerPx;
  return { display: d };
}

function valid(p: Placement): boolean {
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (p.kind === 'point') return ok(p.x) && ok(p.y);
  if (p.kind === 'path' && p.taps && !p.taps.every(ok)) return false;
  return p.points.length >= (p.kind === 'area' ? 3 : 2) && p.points.every(([x, y]) => ok(x) && ok(y));
}

/** Put an item on a photo (or take it off with null). */
export function setPlacement(display: Display, nodeId: string, viewId: string, placement: Placement | null): ActionResult {
  if (!display.nodes[nodeId]) throw new ActionError(`No item ${nodeId}`);
  if (!display.views?.some((v) => v.id === viewId)) throw new ActionError('That photo is no longer here');
  if (placement && !valid(placement))
    throw new ActionError(placement.kind === 'area' ? 'Outline the bush with at least three points' : 'A light run needs at least two points on the photo');
  const d = clone(display);
  const n = d.nodes[nodeId];
  if (placement) n.placements = { ...(n.placements ?? {}), [viewId]: placement };
  else if (n.placements) {
    delete n.placements[viewId];
    if (!Object.keys(n.placements).length) delete n.placements;
  }
  return { display: d, nodeId };
}

/**
 * Add a new item straight onto the photo. It starts "not plugged in yet" (wiring is never
 * guessed) unless a target is given ("+ Plug in" on the photo).
 */
export function addPlacedNode(display: Display, item: NewItem, viewId: string, placement: Placement, target: Target = { parent: null }): ActionResult {
  const added = addNode(display, item, target);
  const placed = setPlacement(added.display, added.nodeId!, viewId, placement);
  return { ...placed, warning: added.warning };
}

// ---- Inline females on a run (SPT-1 vampire plugs, C9 stringer taps)

/**
 * Put a run's inline females at new positions along it. `entries` lists every female after
 * the change, in any order: its position and its current name (null for a new one). They are
 * renumbered tap1, tap2… from the plug end, and whatever is plugged in moves with its female.
 */
function arrangeTaps(display: Display, runId: string, viewId: string, entries: { along: number; old: string | null }[]): { display: Display; names: (string | null)[] } {
  const node = display.nodes[runId];
  const before = inlineFemales(node);
  const sorted = [...entries].sort((a, b) => a.along - b.along);
  const rename = new Map<string, string>();
  sorted.forEach((e, i) => e.old && rename.set(e.old, `tap${i + 1}`));
  const shift = sorted.length - before;
  const labels = socketLabels(display, runId);
  const d = structuredClone(display);
  for (const link of powerChildren(d, runId)) {
    const lab = labels.get(link.id);
    if (!lab || !/^(tap\d+|end)$/.test(lab)) continue;
    const n = Number(lab.slice(3));
    // Names stay with their female; ones past the known taps (overflow) shift along.
    link.port = lab === 'end' ? 'end' : (rename.get(lab) ?? (n > before ? `tap${n + shift}` : lab));
  }
  const run = d.nodes[runId];
  run.outputs = sorted.length + (run.endFemale !== false ? 1 : 0);
  const order = sorted.map((e) => e.old);
  const reordered = order.some((o, i) => o !== null && o !== `tap${i + 1}`) || sorted.length !== before;
  for (const [vid, pl] of Object.entries(run.placements ?? {})) {
    if (pl.kind !== 'path') continue;
    if (vid === viewId) pl.taps = sorted.map((e) => Math.min(1, Math.max(0, e.along)));
    else if (reordered) delete pl.taps; // other photos fall back to even spacing
  }
  return { display: d, names: order };
}

function runOnPhoto(display: Display, runId: string, viewId: string) {
  const node = display.nodes[runId];
  if (!node) throw new ActionError(`No item ${runId}`);
  if (!isRun(node)) throw new ActionError(`${runId} is not a zip cord or light string, so it has no inline females`);
  const placement = node.placements?.[viewId];
  if (!placement || placement.kind !== 'path') throw new ActionError(`Draw ${runId} on this photo first`);
  const n = node.outputs === undefined ? 0 : inlineFemales(node);
  return { node, placement, positions: tapPositions(placement, n) };
}

/** Splice an inline female into a run at a spot along it (0..1). Returns its socket name. */
export function spliceFemale(display: Display, runId: string, viewId: string, along: number): ActionResult & { port: string } {
  const { positions } = runOnPhoto(display, runId, viewId);
  const entries = [...positions.map((p, i) => ({ along: p, old: `tap${i + 1}` as string | null })), { along: Math.min(0.995, Math.max(0.005, along)), old: null }];
  const r = arrangeTaps(display, runId, viewId, entries);
  return { display: r.display, nodeId: runId, port: `tap${r.names.indexOf(null) + 1}` };
}

/** Slide an inline female (0-based index) to another spot along its run. */
export function moveFemale(display: Display, runId: string, viewId: string, index: number, along: number): ActionResult {
  const { positions } = runOnPhoto(display, runId, viewId);
  if (index < 0 || index >= positions.length) throw new ActionError('That female is no longer there');
  const entries = positions.map((p, i) => ({ along: i === index ? Math.min(0.995, Math.max(0.005, along)) : p, old: `tap${i + 1}` as string | null }));
  return { display: arrangeTaps(display, runId, viewId, entries).display, nodeId: runId };
}

/** Take an empty inline female off a run. */
export function removeFemale(display: Display, runId: string, viewId: string, index: number): ActionResult {
  const { positions } = runOnPhoto(display, runId, viewId);
  const name = `tap${index + 1}`;
  const used = powerChildren(display, runId).find((l) => l.to && socketLabels(display, runId).get(l.id) === name);
  if (used) throw new ActionError(`${used.to} is plugged into ${runId} ${name.replace('tap', 'tap ')}; unplug it first`);
  const entries = positions.flatMap((p, i) => (i === index ? [] : [{ along: p, old: `tap${i + 1}` as string | null }]));
  return { display: arrangeTaps(display, runId, viewId, entries).display, nodeId: runId };
}

// ---- Plugging in on the photo

/** Where a cable leaves `target` on this photo (a female on a run, or the item itself). */
function socketPoint(display: Display, view: PhotoView, target: Target) {
  if (!target.parent) return undefined;
  const parent = display.nodes[target.parent];
  const placement = parent?.placements?.[view.id];
  if (!placement) return undefined;
  const spots = runSocketSpots(display, target.parent, view);
  const spot = spots?.find((s) => s.port === target.port) ?? spots?.find((s) => !s.childId);
  return spot ? { at: spot.at, onRun: true } : { at: plugPoint(placement, view), onRun: false };
}

/**
 * Plug an item in on the photo. When a light string (or a female on a run) is involved and
 * the two ends do not meet, an extension cord goes in between, sized from the photo's scale
 * to the next common length. `autoCord: false` plugs straight in.
 */
export function plugOnPhoto(
  display: Display,
  view: PhotoView,
  childId: string,
  target: Target,
  opts: { autoCord?: boolean; isNew?: boolean } = {},
): ActionResult & { cordId?: string; cordFt?: number } {
  const child = display.nodes[childId];
  if (!child) throw new ActionError(`No item ${childId}`);
  if (target.parent && subtreeIds(display, childId).has(target.parent)) {
    throw new ActionError(target.parent === childId ? 'An item cannot plug into itself' : `${target.parent} is plugged into ${childId}; that would make a loop`);
  }
  const from = socketPoint(display, view, target);
  const mine = child.placements?.[view.id];
  if (opts.autoCord !== false && from && mine && (from.onRun || drawnAsRun(child))) {
    const gap = gapFt(from.at, plugPoint(mine, view), view);
    if (gap > 1.5) {
      const cordFt = view.feetPerPx ? cordFor(gap) : undefined;
      const cord: NewItem = { kind: 'cord', label: 'Green extension cord', color: 'green', outputs: 1, lengthFt: cordFt, isNew: opts.isNew };
      const added = addNode(display, cord, target);
      const moved = replug(added.display, childId, { parent: added.nodeId! });
      return { display: moved.display, nodeId: childId, cordId: added.nodeId, cordFt, warning: added.warning ?? moved.warning };
    }
  }
  return replug(display, childId, target);
}
