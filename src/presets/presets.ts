/**
 * Preset library for the icon picker. Watts are rough LED-era estimates, always stored as
 * approximate (`~`), and meant to be replaced with the number on the label.
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
  /** Estimated watts for one item (flagged as an estimate). */
  watts?: number;
  keywords?: string;
}

export const PRESETS: Preset[] = [
  { id: 'outlet', name: 'Outlet', icon: '🔌', group: 'power', kind: 'outlet', label: 'Outlet', keywords: 'wall receptacle gfci' },
  { id: 'smartplug', name: 'Smart plug', icon: '📶', group: 'power', kind: 'smartplug', label: 'Smart plug', outputs: 1, keywords: 'kasa wifi' },
  { id: 'smartplug2', name: '2-port smart plug', icon: '📶', group: 'power', kind: 'smartplug', label: '2-port smart plug', outputs: 2, keywords: 'kasa ep40 outdoor' },
  { id: 'timer', name: 'Timer', icon: '⏲️', group: 'power', kind: 'smartplug', subtype: 'timer', label: 'Timer', outputs: 1, keywords: 'photocell dusk' },
  { id: 'cord', name: 'Extension cord', icon: '➰', group: 'power', kind: 'cord', label: 'Extension cord', outputs: 1, keywords: 'lead spt' },
  { id: 'multi', name: 'Multi-outlet extension', icon: '〰️', group: 'power', kind: 'cord', subtype: 'multi-outlet', label: 'Multi-outlet extension', keywords: 'tap cord' },
  { id: 'split3', name: '3-way splitter', icon: '🔱', group: 'power', kind: 'splitter', label: '3-way splitter', outputs: 3, keywords: 'cube tap adapter' },
  { id: 'split4', name: '4-way splitter', icon: '🔱', group: 'power', kind: 'splitter', label: '4-way splitter', outputs: 4 },
  { id: 'strip', name: 'Power strip', icon: '🎚️', group: 'power', kind: 'splitter', subtype: 'strip', label: '6-outlet power strip', outputs: 6, keywords: 'surge' },
  { id: 'stake', name: 'Yard stake', icon: '📍', group: 'power', kind: 'splitter', subtype: 'stake', label: '3-way yard stake', outputs: 3, keywords: 'outdoor' },
  { id: 'psu', name: 'Power supply', icon: '🔋', group: 'power', kind: 'controller', subtype: 'power-supply', label: 'Pixel power supply', keywords: 'psu 5v 12v' },
  { id: 'controller', name: 'Controller', icon: '🎛️', group: 'power', kind: 'controller', label: 'WLED controller', keywords: 'esp32 wled falcon' },
  { id: 'tote', name: 'Tote', icon: '📦', group: 'power', kind: 'enclosure', label: 'Tote', keywords: 'enclosure box bin' },

  { id: 'c9', name: 'C9 roofline run', icon: '💡', group: 'load', kind: 'load', category: 'c9', label: 'C9 roofline run', watts: 40, keywords: 'c7 bulbs eaves gutter' },
  { id: 'mini', name: 'Mini-light string', icon: '✨', group: 'load', kind: 'load', category: 'mini', label: 'Mini lights', watts: 25, keywords: 'string fairy' },
  { id: 'icicle', name: 'Icicle / net lights', icon: '🧊', group: 'load', kind: 'load', category: 'icicle', label: 'Icicle lights', watts: 30, keywords: 'net bush' },
  { id: 'pixel', name: 'Pixel tree', icon: '🌈', group: 'load', kind: 'load', category: 'pixel', label: 'Pixel tree', watts: 60, keywords: 'wled rgb mega tree' },
  { id: 'tree', name: 'Lit tree', icon: '🎄', group: 'load', kind: 'load', category: 'tree', label: 'Tree lights', watts: 50, keywords: 'christmas tree' },
  { id: 'wreath', name: 'Wreath', icon: '🎀', group: 'load', kind: 'load', category: 'wreath', label: 'Wreath', watts: 20, keywords: 'garland' },
  { id: 'pathway', name: 'Pathway lights', icon: '🍬', group: 'load', kind: 'load', category: 'pathway', label: 'Pathway lights', watts: 20, keywords: 'candy cane walkway stake' },
  { id: 'yardart', name: 'Light-up yard art', icon: '🦌', group: 'load', kind: 'load', category: 'yard-art', label: 'Light-up yard art', watts: 30, keywords: 'reindeer silhouette' },
  { id: 'inflatable', name: 'Inflatable', icon: '⛄', group: 'load', kind: 'load', category: 'inflatable', label: 'Inflatable', watts: 150, keywords: 'blow up snowman' },
  { id: 'prop', name: 'Animated prop', icon: '🎃', group: 'load', kind: 'load', category: 'prop', label: 'Animated prop', watts: 40, keywords: 'skelly animatronic scarecrow' },
  { id: 'spot', name: 'Spotlight', icon: '🔦', group: 'load', kind: 'load', category: 'spotlight', label: 'Spotlight', watts: 15, keywords: 'flood uplight blacklight uv' },
  { id: 'projector', name: 'Projector', icon: '📽️', group: 'load', kind: 'load', category: 'projector', label: 'Projector', watts: 250, keywords: 'epson dukane window' },
  { id: 'media', name: 'Media player', icon: '📺', group: 'load', kind: 'load', category: 'media', label: 'Media player', watts: 10, keywords: 'micca fire stick roku' },
  { id: 'speaker', name: 'Speaker', icon: '🔊', group: 'load', kind: 'load', category: 'speaker', label: 'Speaker', watts: 20, keywords: 'audio' },
  { id: 'fan', name: 'Fan', icon: '🌀', group: 'load', kind: 'load', category: 'fan', label: 'Fan', watts: 30, keywords: 'blower cooling' },
  { id: 'fog', name: 'Fog machine', icon: '🌫️', group: 'load', kind: 'load', category: 'fog', label: 'Fog machine', watts: 400, keywords: 'mister haze' },
  { id: 'other', name: 'Other', icon: '⭐', group: 'load', kind: 'load', category: 'other', label: 'Item', keywords: 'misc' },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Case-insensitive search over name, label and keywords; every word must match. */
export function searchPresets(query: string, list: Preset[] = PRESETS): Preset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((p) => {
    const hay = `${p.name} ${p.label} ${p.keywords ?? ''} ${p.category ?? ''} ${p.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
