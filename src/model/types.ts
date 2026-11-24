/** Core data model. Framework-free; shared by the outline editor, diagram and load checks. */

export type NodeKind = 'outlet' | 'smartplug' | 'cord' | 'splitter' | 'controller' | 'enclosure' | 'load';

export const NODE_KINDS: readonly NodeKind[] = [
  'outlet',
  'smartplug',
  'cord',
  'splitter',
  'controller',
  'enclosure',
  'load',
];

export const ID_PREFIX: Record<NodeKind, string> = {
  outlet: 'O',
  smartplug: 'K',
  cord: 'C',
  splitter: 'S',
  controller: 'P',
  enclosure: 'T',
  load: 'L',
};

export type Status = 'planned' | 'installed' | 'verified';
export const STATUSES: readonly Status[] = ['planned', 'installed', 'verified'];

export type LoadCategory =
  | 'c9'
  | 'mini'
  | 'icicle'
  | 'pixel'
  | 'tree'
  | 'wreath'
  | 'pathway'
  | 'yard-art'
  | 'inflatable'
  | 'prop'
  | 'spotlight'
  | 'projector'
  | 'media'
  | 'speaker'
  | 'fan'
  | 'fog'
  | 'other';

export const LOAD_CATEGORIES: readonly LoadCategory[] = [
  'c9',
  'mini',
  'icicle',
  'pixel',
  'tree',
  'wreath',
  'pathway',
  'yard-art',
  'inflatable',
  'prop',
  'spotlight',
  'projector',
  'media',
  'speaker',
  'fan',
  'fog',
  'other',
];

export type SignalType = 'hdmi' | 'vga' | 'ble' | 'wifi' | 'aux' | 'dmx' | 'data';
export const SIGNAL_TYPES: readonly SignalType[] = ['hdmi', 'vga', 'ble', 'wifi', 'aux', 'dmx', 'data'];

/** Fields that the outline text can express. The serializer compares exactly these. */
export interface OutlineFields {
  kind: NodeKind;
  label: string;
  /** Explicit ID typed in the text, if any. */
  explicitId?: string;
  qty?: number;
  /** Line total, see PLAN.md decision D1. */
  watts?: number;
  wattsApprox?: boolean;
  amps?: number;
  ampsApprox?: boolean;
  lengthFt?: number;
  lengthApprox?: boolean;
  breakerAmps?: number;
  gfci?: boolean;
  status: Status;
  isNew?: boolean;
  retired?: boolean;
  tags: string[];
}

export interface DisplayNode {
  id: string;
  kind: NodeKind;
  label: string;
  status: Status;
  tags: string[];
  subtype?: string;
  category?: LoadCategory;
  /** Known number of power outputs (sockets/ports). Undefined = unknown. */
  outputs?: number;
  qty?: number;
  watts?: number;
  wattsApprox?: boolean;
  amps?: number;
  ampsApprox?: boolean;
  lengthFt?: number;
  lengthApprox?: boolean;
  breakerAmps?: number;
  gfci?: boolean;
  isNew?: boolean;
  retired?: boolean;
  color?: string;
  // Model-only fields (not expressible in the outline; survive text edits).
  notes?: string;
  circuit?: string;
  location?: string;
  storage?: string;
  /** Outlets: the zip-tie colour for everything plugged into it (when colours are on). */
  tieColor?: string;
  /** Which story it goes on (1 = ground or first floor, 2 = second story…): zip ties to put on it. */
  story?: number;
  scheduleGroup?: string;
  /** Teardown: packed away this season (model-only). */
  packed?: boolean;
  /**
   * Runs (SPT-1 zip cord, light strings) with a known socket count: the last socket is a
   * female at the end of the run (default true); the others are inline female taps.
   */
  endFemale?: boolean;
  /** Light runs: bulb colours, repeating along the run (CSS colours). */
  bulbColors?: string[];
  /** Light runs: bulb spacing in inches (default 12). */
  spacingIn?: number;
  /** Light runs on the photo: a smooth curve through the points (ground stakes, garland). */
  smooth?: boolean;
  /** Light runs: wire colour (green, white, black, brown). */
  wireColor?: string;
  /** Where this item sits on each photo view (model-only; survives text edits). */
  placements?: Record<string, Placement>;
  /** Raw outline line content (after indentation) that created this node. */
  src?: string;
  /** For top-level nodes: position among top-level entries. */
  seq?: number;
  /** Blank lines before this node's outline line (layout of the text only). */
  blankBefore?: number;
}

export type LinkKind = 'power' | 'signal';

export interface Link {
  id: string;
  kind: LinkKind;
  from: string;
  /** null = explicitly unused socket (power links only). */
  to: string | null;
  /** Port label as written (`left`, `2`, `tap`). Undefined = unlabelled. */
  port?: string;
  signalType?: SignalType;
  /** Order among the `from` node's outline children. */
  seq: number;
  /**
   * Signal links only: true when this outline line defines the target node (a signal-only
   * item such as a projector with no power parent). False when it references a node that
   * lives elsewhere in the outline.
   */
  owns?: boolean;
  /** Raw line content for lines that are not node definitions (unused sockets, signal references). */
  src?: string;
  blankBefore?: number;
}

export interface Comment {
  id: string;
  /** null = top level. */
  parent: string | null;
  seq: number;
  /** `# ...` text, or (raw) a line that could not be placed in the graph, kept verbatim. */
  text: string;
  raw?: boolean;
  blankBefore?: number;
}

export type Season = 'halloween' | 'christmas' | 'other';

export interface Display {
  id: string;
  title: string;
  season: Season;
  year?: number;
  nodes: Record<string, DisplayNode>;
  links: Link[];
  comments: Comment[];
  /** Blank lines at the end of the outline. */
  trailingBlank?: number;
  /** Display this one was copied from ("Copy for next year"), for the changes view. */
  copiedFrom?: string;
  /** Photos of the house that items are placed on. */
  views?: PhotoView[];
  /**
   * The light look last chosen for each kind of light (e.g. "c9", "icicle:bush"), so new
   * runs match the rest of the house (model-only).
   */
  lightLooks?: Record<string, LightLook>;
  /** How labelled items are also marked with zip ties (model-only). Both off when absent. */
  marks?: Marks;
  /**
   * Highest ID number ever used per prefix, kept only where it is above the IDs still in the
   * plan (something was deleted), so a printed label never ends up on a different item.
   */
  idHigh?: Record<string, number>;
}

/** Zip-tie marks on labelled items. */
export interface Marks {
  /** One colour per outlet: the ties on everything it powers. */
  colors?: boolean;
  /** As many ties as the story it goes on (1 = first floor, 2 = second story). */
  stories?: boolean;
}

/** Bulb colours, spacing, wire colour and smoothing chosen for a kind of light. */
export interface LightLook {
  bulbColors?: string[];
  spacingIn?: number;
  wireColor?: string;
  smooth?: boolean;
}

/** One "Measure": a line on the photo over something of known length. */
export interface Measure {
  a: [number, number];
  b: [number, number];
  ft: number;
  /** What was measured, e.g. "Double garage door". */
  name?: string;
}

/**
 * A photo of the house. Coordinates of placements are fractions (0..1) of the photo's width
 * and height, so they survive any resize of the stored image.
 */
export interface PhotoView {
  id: string;
  name: string;
  /** Key of the image in local storage (photos table). */
  photoId: string;
  width: number;
  height: number;
  /** Real-world feet per photo pixel, from "Measure" (undefined until set). */
  feetPerPx?: number;
  /** The measurements behind feetPerPx; several are combined for a steadier scale. */
  measures?: Measure[];
}

export type Placement =
  | { kind: 'point'; x: number; y: number }
  /**
   * A run drawn along the house: at least two points. `taps` places its inline females
   * (tap1, tap2…) as fractions 0..1 along the drawn run, in order.
   */
  | { kind: 'path'; points: [number, number][]; taps?: number[] }
  /** Lights covering an area (a bush or tree): a closed outline of at least three points. */
  | { kind: 'area'; points: [number, number][] };

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** 1-based line number in the outline. */
  line: number;
  severity: Severity;
  message: string;
}
