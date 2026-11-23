/** Light options (pure): what a run looks like, and which of those choices to store. */
import type { Display, DisplayNode } from '../model/types';
import { WIRE_COLORS, bulbColors, drawnAsLights, drawsAsArea, runStyle, spacingInOf } from './geometry';

/** How a light run looks: bulb colours, spacing in inches, wire colour, smooth curve. */
export interface LightOpts {
  bulbColors: string[];
  spacingIn: number;
  smooth: boolean;
  wireColor: string;
}

type LightFields = Pick<DisplayNode, 'label' | 'category' | 'color' | 'bulbColors' | 'spacingIn' | 'smooth' | 'wireColor'>;

export const SPACINGS = [3, 4, 6, 8, 12, 15, 18, 24, 36];

/** The options an item is drawn with now (its own, or the defaults for its kind and name). */
export function lightOptsOf(node: LightFields): LightOpts {
  const wire = (WIRE_COLORS as readonly string[]).includes(node.wireColor ?? '') ? node.wireColor! : (WIRE_COLORS as readonly string[]).includes(node.color ?? '') ? node.color! : 'green';
  return { bulbColors: bulbColors(node), spacingIn: spacingInOf(node), smooth: !!node.smooth, wireColor: wire };
}

/**
 * The fields to store for these options: only what differs from the item's defaults, so a
 * renamed "red" string still turns red unless colours were picked by hand.
 */
export function lightPatch(node: LightFields, opts: LightOpts): Pick<DisplayNode, 'bulbColors' | 'spacingIn' | 'smooth' | 'wireColor'> {
  const base = lightOptsOf({ label: node.label, category: node.category, color: node.color });
  return {
    bulbColors: opts.bulbColors.join() === base.bulbColors.join() ? undefined : opts.bulbColors,
    spacingIn: opts.spacingIn === base.spacingIn ? undefined : opts.spacingIn,
    smooth: opts.smooth ? true : undefined,
    wireColor: opts.wireColor === base.wireColor ? undefined : opts.wireColor,
  };
}

// ---- Remembered looks: new lights match the rest of the house

type LookFields = LightFields & Pick<DisplayNode, 'kind'>;

/** Which remembered look an item uses: its kind of light, bushes kept apart from runs. */
export function lookKey(node: Pick<DisplayNode, 'label' | 'category'>): string {
  return `${runStyle(node)}${drawsAsArea(node) ? ':bush' : ''}`;
}

/**
 * The look last chosen for this kind of light in this display, if any. Built-in presets'
 * spacing and smoothing are only defaults, so the remembered look replaces them; with
 * `keepOwn` (your own saved presets) whatever the item sets itself wins.
 */
export function lookFor(display: Pick<Display, 'lightLooks'>, node: LookFields, keepOwn = false): Partial<LightOpts> | undefined {
  if (!drawnAsLights(node)) return undefined;
  const look = display.lightLooks?.[lookKey(node)];
  if (!look) return undefined;
  const out: Partial<LightOpts> = {};
  if (look.bulbColors && !(keepOwn && node.bulbColors)) out.bulbColors = look.bulbColors;
  if (look.spacingIn && !(keepOwn && node.spacingIn)) out.spacingIn = look.spacingIn;
  if (look.wireColor && !(keepOwn && node.wireColor)) out.wireColor = look.wireColor;
  if (look.smooth !== undefined && !(keepOwn && node.smooth !== undefined)) out.smooth = look.smooth;
  return out;
}

/** A new item with the remembered look of its kind applied (only what differs is stored). */
export function withLook<T extends LookFields>(display: Pick<Display, 'lightLooks'>, item: T, keepOwn = false): T {
  const look = lookFor(display, item, keepOwn);
  if (!look) return item;
  const patch = lightPatch(item, { ...lightOptsOf(item), ...look });
  return { ...item, ...patch };
}

/** Remember a look for this kind of light (returns a new display). */
export function rememberLook(display: Display, node: Pick<DisplayNode, 'label' | 'category'>, opts: LightOpts): Display {
  return { ...display, lightLooks: { ...display.lightLooks, [lookKey(node)]: { ...opts, bulbColors: [...opts.bulbColors] } } };
}

/** Items of the same kind of light as this one (same remembered look). */
export function sameKind(display: Display, node: DisplayNode): DisplayNode[] {
  const key = lookKey(node);
  return Object.values(display.nodes).filter((n) => n.kind === 'load' && drawnAsLights(n) && lookKey(n) === key);
}

/** Give every light of this kind the same look, and remember it. */
export function applyLookToAll(display: Display, node: DisplayNode, opts: LightOpts): Display {
  const d = rememberLook(structuredClone(display), node, opts);
  for (const n of sameKind(d, node)) Object.assign(n, lightPatch(n, opts));
  for (const n of sameKind(d, node)) for (const k of ['bulbColors', 'spacingIn', 'smooth', 'wireColor'] as const) if (n[k] === undefined) delete n[k];
  return d;
}
