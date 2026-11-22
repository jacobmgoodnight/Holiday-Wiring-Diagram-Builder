/** Photo view actions (pure). Placing items never changes their wiring. */
import { type ActionResult, ActionError, type NewItem, addNode } from '../model/actions';
import type { Display, Placement, PhotoView } from '../model/types';

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
  return p.kind === 'point' ? ok(p.x) && ok(p.y) : p.points.length >= 2 && p.points.every(([x, y]) => ok(x) && ok(y));
}

/** Put an item on a photo (or take it off with null). */
export function setPlacement(display: Display, nodeId: string, viewId: string, placement: Placement | null): ActionResult {
  if (!display.nodes[nodeId]) throw new ActionError(`No item ${nodeId}`);
  if (!display.views?.some((v) => v.id === viewId)) throw new ActionError('That photo is no longer here');
  if (placement && !valid(placement)) throw new ActionError('A light run needs at least two points on the photo');
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
 * guessed) unless a parent is given.
 */
export function addPlacedNode(display: Display, item: NewItem, viewId: string, placement: Placement, parent: string | null = null): ActionResult {
  const added = addNode(display, item, { parent });
  const placed = setPlacement(added.display, added.nodeId!, viewId, placement);
  return { ...placed, warning: added.warning };
}
