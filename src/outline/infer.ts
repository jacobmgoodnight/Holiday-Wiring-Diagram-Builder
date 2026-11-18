/**
 * Keyword inference. Only *types* are inferred from words; connections never are.
 */
import type { LoadCategory, NodeKind, SignalType } from '../model/types';

export interface KindGuess {
  kind: NodeKind;
  subtype?: string;
}

const has = (text: string, re: RegExp) => re.test(text);

/** Power-distribution keyword match, or undefined when the text reads like a load. */
export function inferPowerKind(text: string): KindGuess | undefined {
  const t = text.toLowerCase();
  if (has(t, /\b(tote|enclosure)\b/)) return { kind: 'enclosure' };
  if (has(t, /\b(power supply|psu|pixel supply)\b/)) return { kind: 'controller', subtype: 'power-supply' };
  if (has(t, /\b(controller|esp32|esp8266|wled|falcon|fpp|kulp|quinled)\b/)) return { kind: 'controller' };
  if (has(t, /\b(timer)\b/)) return { kind: 'smartplug', subtype: 'timer' };
  if (has(t, /\b(smart ?plug|kasa|wemo|plug)\b/)) return { kind: 'smartplug' };
  if (has(t, /\b(multi-?outlet|extension)\b/)) {
    return has(t, /\bmulti-?outlet\b/) ? { kind: 'cord', subtype: 'multi-outlet' } : { kind: 'cord' };
  }
  if (has(t, /\b(yard )?stake\b/) && !has(t, /\b(lights?|pathway)\b/)) return { kind: 'splitter', subtype: 'stake' };
  if (has(t, /\b(power strip|surge)\b/)) return { kind: 'splitter', subtype: 'strip' };
  if (has(t, /\bstrip\b/) && !has(t, /\b(led|lights?|pixels?|rgb)\b/)) return { kind: 'splitter', subtype: 'strip' };
  if (has(t, /\b(splitter|\d+-way|cube tap)\b/)) return { kind: 'splitter' };
  if (has(t, /\b(cord|spt-?[123]|feeder|zip ?cord|lead)\b/)) return { kind: 'cord' };
  if (has(t, /(^|[^-])\b(outlet|receptacle)\b/)) return { kind: 'outlet' };
  return undefined;
}

const CATEGORY_RULES: [RegExp, LoadCategory][] = [
  [/\b(projector|epson|dukane|optoma|benq|projection)\b/, 'projector'],
  [/\b(spot ?light|uplight|flood ?light|blacklight|black light|uv)\b/, 'spotlight'],
  [/\b(pixels?|wled|ws281\d|rgb tree)\b/, 'pixel'],
  [/\b(c9|c7|roofline)\b/, 'c9'],
  [/\b(icicles?|net lights?)\b/, 'icicle'],
  [/\b(mini ?lights?|minis|mini string|fairy lights)\b/, 'mini'],
  [/\b(wreaths?|garland)\b/, 'wreath'],
  [/\b(pathway|path lights|candy canes?|walkway)\b/, 'pathway'],
  [/\b(inflatables?|blow-?ups?)\b/, 'inflatable'],
  [/\b(fog|mister|haze|hazer)\b/, 'fog'],
  [/\b(fan|blower)\b/, 'fan'],
  [/\b(speakers?|soundbar)\b/, 'speaker'],
  [/\b(micca|media player|roku|fire ?stick|raspberry pi|agptek)\b/, 'media'],
  [/\b(skelly|animated|animatronic|prop|scarecrow|skull|pumpkin arch|groundbreaker)\b/, 'prop'],
  [/\b(yard art|light-?up|lit (deer|reindeer)|reindeer|silhouette)\b/, 'yard-art'],
  [/\b(tree)\b/, 'tree'],
];

/** Load category from keywords; undefined when nothing matches. */
export function inferCategory(text: string): LoadCategory | undefined {
  const t = text.toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(t)) return cat;
  return undefined;
}

/**
 * Kind for a line with no explicit kind or ID.
 * Depth 0 → outlet unless a power or load keyword says otherwise (PLAN.md D2).
 */
export function inferKind(text: string, depth: number): KindGuess {
  const power = inferPowerKind(text);
  if (power) return power;
  if (depth === 0 && !inferCategory(text)) return { kind: 'outlet' };
  return { kind: 'load' };
}

/** Number of outputs from words like "4-way", "2-port", "3-socket", "6-outlet". */
export function inferOutputs(text: string): number | undefined {
  const m = /(?:^|[^\w.])(\d{1,2})[- ](?:way|port|socket|outlet|plug)s?\b/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 48 ? n : undefined;
}

const COLORS = ['black', 'white', 'green', 'brown', 'orange', 'red', 'blue', 'grey', 'gray', 'yellow', 'purple'];

export function inferColor(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const c of COLORS) if (new RegExp(`\\b${c}\\b`).test(t)) return c === 'gray' ? 'grey' : c;
  return undefined;
}

const SIGNAL_WORDS: [RegExp, SignalType][] = [
  [/^hdmi$/i, 'hdmi'],
  [/^vga$/i, 'vga'],
  [/^(ble|bluetooth)$/i, 'ble'],
  [/^(wi-?fi|wifi|wireless)$/i, 'wifi'],
  [/^(aux|audio|3\.5mm)$/i, 'aux'],
  [/^dmx$/i, 'dmx'],
  [/^(data|signal|e1\.31|ethernet)$/i, 'data'],
];

/** Signal type from a single word such as `HDMI` or `BLE`. */
export function signalTypeFromWord(word: string): SignalType | undefined {
  for (const [re, t] of SIGNAL_WORDS) if (re.test(word)) return t;
  return undefined;
}

/** Signal type from anywhere in a line, for the `(signal)` suffix form. Defaults to data. */
export function inferSignalType(text: string): SignalType {
  for (const word of text.split(/[^\w.\-]+/)) {
    const t = signalTypeFromWord(word);
    if (t) return t;
  }
  return 'data';
}
