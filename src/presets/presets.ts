/**
 * Preset library for the icon picker. Presets carry a name, icon, kind and socket count only;
 * nothing is guessed about power draw.
 */
import type { LoadCategory, NodeKind } from '../model/types';

export interface Preset {
  id: string;
  name: string;
  icon: string;
  group: 'power' | 'load';
  kind: NodeKind;
  subtype?: string;
  category?: LoadCategory;
  /** Default label written into the outline. */
  label: string;
  outputs?: number;
  /** Cord length to fill in (custom presets saved from a cord). */
  lengthFt?: number;
  color?: string;
  keywords?: string;
  /** Saved by you with "Save as preset" (stored in this browser). */
  custom?: boolean;
  /** One line under the name in the picker, e.g. what sets two similar presets apart. */
  hint?: string;
  /** Runs: whether the last socket is a female at the end (default yes). */
  endFemale?: boolean;
  /** Light runs: bulb colours, spacing (inches), smooth curve on the photo, wire colour. */
  bulbColors?: string[];
  spacingIn?: number;
  smooth?: boolean;
  wireColor?: string;
}

export const PRESETS: Preset[] = [
  { id: 'outlet', name: 'Outlet', icon: '🔌', group: 'power', kind: 'outlet', label: 'Outlet', keywords: 'wall receptacle gfci' },
  { id: 'smartplug', name: 'Smart plug', icon: '📶', group: 'power', kind: 'smartplug', label: 'Smart plug', outputs: 1, keywords: 'kasa wifi' },
  { id: 'smartplug2', name: '2-port smart plug', icon: '📶', group: 'power', kind: 'smartplug', label: '2-port smart plug', outputs: 2, keywords: 'kasa ep40 outdoor' },
  { id: 'timer', name: 'Timer', icon: '⏲️', group: 'power', kind: 'smartplug', subtype: 'timer', label: 'Timer', outputs: 1, keywords: 'photocell dusk' },
  { id: 'cord', name: 'Extension cord', icon: '➰', group: 'power', kind: 'cord', label: 'Extension cord', outputs: 1, keywords: 'lead spt' },
  { id: 'multi', name: 'Multi-outlet extension', icon: '〰️', group: 'power', kind: 'cord', subtype: 'multi-outlet', label: 'Multi-outlet extension', keywords: 'tap cord' },
  { id: 'spt', name: 'SPT-1 zip cord', icon: '➿', group: 'power', kind: 'cord', subtype: 'spt', label: 'SPT-1 zip cord', outputs: 3, color: 'green', keywords: 'spt1 spt-2 zip plug vampire inline female tap wire' },
  { id: 'split3', name: '3-way splitter', icon: '🔱', group: 'power', kind: 'splitter', label: '3-way splitter', outputs: 3, keywords: 'cube tap adapter' },
  { id: 'split4', name: '4-way splitter', icon: '🔱', group: 'power', kind: 'splitter', label: '4-way splitter', outputs: 4 },
  { id: 'strip', name: 'Power strip', icon: '🎚️', group: 'power', kind: 'splitter', subtype: 'strip', label: '6-outlet power strip', outputs: 6, keywords: 'surge' },
  { id: 'stake', name: 'Yard stake', icon: '📍', group: 'power', kind: 'splitter', subtype: 'stake', label: '3-way yard stake', outputs: 3, keywords: 'outdoor' },
  { id: 'psu', name: 'Power supply', icon: '🔋', group: 'power', kind: 'controller', subtype: 'power-supply', label: 'Pixel power supply', keywords: 'psu 5v 12v' },
  { id: 'controller', name: 'Controller', icon: '🎛️', group: 'power', kind: 'controller', label: 'WLED controller', keywords: 'esp32 wled falcon' },
  { id: 'tote', name: 'Tote', icon: '📦', group: 'power', kind: 'enclosure', label: 'Tote', keywords: 'enclosure box bin' },

  { id: 'c9', name: 'C9 roofline run', icon: '💡', group: 'load', kind: 'load', category: 'c9', label: 'C9 roofline run', outputs: 1, spacingIn: 12, hint: 'Pre-made strings: bulbs and plugs included', keywords: 'c7 bulbs eaves gutter stringer' },
  { id: 'c9stringer', name: 'C9 stringer (SPT-1 + sockets)', icon: '💡', group: 'load', kind: 'load', category: 'c9', label: 'C9 stringer', outputs: 1, spacingIn: 12, hint: 'Wire with sockets, cut to length; bulbs separate', keywords: 'spt-1 spt1 sockets commercial build your own roofline inline female' },
  { id: 'mini', name: 'Mini-light string', icon: '✨', group: 'load', kind: 'load', category: 'mini', label: 'Mini lights', outputs: 1, spacingIn: 4, keywords: 'string fairy end to end' },
  { id: 'icicle', name: 'Icicle lights', icon: '🧊', group: 'load', kind: 'load', category: 'icicle', label: 'Icicle lights', outputs: 1, spacingIn: 4, keywords: 'drops eaves' },
  { id: 'net', name: 'Net lights (bush)', icon: '🌳', group: 'load', kind: 'load', category: 'icicle', label: 'Net lights', outputs: 1, spacingIn: 4, keywords: 'bush shrub hedge net' },
  { id: 'bushmini', name: 'Bush wrap (minis)', icon: '🌿', group: 'load', kind: 'load', category: 'mini', label: 'Bush mini lights', outputs: 1, spacingIn: 4, keywords: 'bush shrub hedge wrap twinkle' },
  { id: 'pixel', name: 'Pixel tree', icon: '🌈', group: 'load', kind: 'load', category: 'pixel', label: 'Pixel tree', keywords: 'wled rgb mega tree' },
  { id: 'tree', name: 'Lit tree', icon: '🎄', group: 'load', kind: 'load', category: 'tree', label: 'Tree lights', keywords: 'christmas tree' },
  { id: 'wreath', name: 'Wreath', icon: '🎀', group: 'load', kind: 'load', category: 'wreath', label: 'Wreath', keywords: 'garland' },
  { id: 'pathway', name: 'Ground stake lights', icon: '🍬', group: 'load', kind: 'load', category: 'pathway', label: 'Pathway lights', outputs: 1, spacingIn: 12, smooth: true, keywords: 'candy cane walkway stake ground c9 c7 driveway' },
  { id: 'yardart', name: 'Light-up yard art', icon: '🦌', group: 'load', kind: 'load', category: 'yard-art', label: 'Light-up yard art', keywords: 'reindeer silhouette' },
  { id: 'inflatable', name: 'Inflatable', icon: '⛄', group: 'load', kind: 'load', category: 'inflatable', label: 'Inflatable', keywords: 'blow up snowman' },
  { id: 'prop', name: 'Animated prop', icon: '🎃', group: 'load', kind: 'load', category: 'prop', label: 'Animated prop', keywords: 'skelly animatronic scarecrow' },
  { id: 'spot', name: 'Spotlight', icon: '🔦', group: 'load', kind: 'load', category: 'spotlight', label: 'Spotlight', keywords: 'flood uplight blacklight uv' },
  { id: 'projector', name: 'Projector', icon: '📽️', group: 'load', kind: 'load', category: 'projector', label: 'Projector', keywords: 'epson dukane window' },
  { id: 'media', name: 'Media player', icon: '📺', group: 'load', kind: 'load', category: 'media', label: 'Media player', keywords: 'micca fire stick roku' },
  { id: 'speaker', name: 'Speaker', icon: '🔊', group: 'load', kind: 'load', category: 'speaker', label: 'Speaker', keywords: 'audio' },
  { id: 'fan', name: 'Fan', icon: '🌀', group: 'load', kind: 'load', category: 'fan', label: 'Fan', keywords: 'blower cooling' },
  { id: 'fog', name: 'Fog machine', icon: '🌫️', group: 'load', kind: 'load', category: 'fog', label: 'Fog machine', keywords: 'mister haze' },
  { id: 'other', name: 'Other', icon: '⭐', group: 'load', kind: 'load', category: 'other', label: 'Item', keywords: 'misc' },
];

/** Look up a preset among your own (first) and the built-in ones. */
export const presetById = (id: string, custom: Preset[] = []) => custom.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === id);

/** Case-insensitive search over name, label and keywords; every word must match. */
export function searchPresets(query: string, list: Preset[] = PRESETS): Preset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((p) => {
    const hay = `${p.name} ${p.label} ${p.keywords ?? ''} ${p.category ?? ''} ${p.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
