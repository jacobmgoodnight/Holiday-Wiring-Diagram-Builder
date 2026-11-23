/** Light options (pure): what a run looks like, and which of those choices to store. */
import type { DisplayNode } from '../model/types';
import { WIRE_COLORS, bulbColors, spacingInOf } from './geometry';

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
