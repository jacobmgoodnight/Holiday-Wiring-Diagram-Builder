/** Your own presets ("Save as preset") and outline autocomplete from the preset library. */
import type { DisplayNode } from '../model/types';
import { inferKind, inferPowerKind } from '../outline/infer';
import { KIND_WORD, SUBTYPE_WORD } from '../outline/parse';
import { PRESETS, type Preset } from './presets';

/** Icon of the closest built-in preset (same category, else same kind). */
export function iconFor(node: Pick<DisplayNode, 'kind' | 'category' | 'subtype'>): string {
  const match =
    PRESETS.find((p) => p.kind === node.kind && p.category && p.category === node.category) ??
    PRESETS.find((p) => p.kind === node.kind && p.subtype === node.subtype) ??
    PRESETS.find((p) => p.kind === node.kind);
  return match?.icon ?? '⭐';
}

export function presetFromNode(node: DisplayNode, name: string, icon: string, id: string): Preset {
  return {
    id,
    name: name.trim() || node.label,
    icon: icon.trim() || iconFor(node),
    group: node.kind === 'load' ? 'load' : 'power',
    kind: node.kind,
    subtype: node.subtype,
    category: node.category,
    label: node.label,
    outputs: node.outputs,
    lengthFt: node.lengthFt,
    color: node.color,
    custom: true,
  };
}

/**
 * Text for an outline line from a preset (no ID: the line gets the next free one). A kind
 * word is added only when the words alone would read as something else.
 */
export function presetText(p: Preset): string {
  const parts = [p.label];
  if (p.lengthFt !== undefined) parts.push(`${p.lengthFt}ft`);
  const power = inferPowerKind(p.label);
  const inferred = inferKind(p.label, 1);
  if (p.subtype && SUBTYPE_WORD[p.subtype] && !(power && power.kind === p.kind && power.subtype === p.subtype)) {
    parts.push(`[${SUBTYPE_WORD[p.subtype]}]`);
  } else if (inferred.kind !== p.kind) parts.push(`[${KIND_WORD[p.kind]}]`);
  return parts.join(' ');
}

/** Split an outline line into what stays (indent, socket prefix, ~TYPE) and what is typed. */
export function splitLine(line: string): { head: string; body: string } {
  const m = /^(\s*(?:(?:\d{1,2}|left|right|top|bottom|middle|tap|end|[a-d])\s*:\s*)?(?:~[A-Za-z][\w.-]*\s+)?)(.*)$/i.exec(line)!;
  return { head: m[1], body: m[2] };
}

/** Up to `max` presets matching what is typed on a line; your own presets first. */
export function suggest(line: string, presets: Preset[], max = 4): Preset[] {
  const { body } = splitLine(line);
  const typed = body.trim().toLowerCase();
  if (typed.length < 2 || /^[OKCSTPL]\d{2}/.test(body.trim()) || typed.startsWith('#')) return [];
  const words = typed.split(/\s+/);
  const score = (p: Preset): number => {
    const label = p.label.toLowerCase();
    if (label === typed || presetText(p).toLowerCase() === typed) return -1;
    const hay = `${p.name} ${p.label} ${p.keywords ?? ''}`.toLowerCase().split(/[^a-z0-9-]+/);
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) return -1;
    return (p.custom ? 2 : 0) + (label.startsWith(typed) ? 1 : 0);
  };
  return presets
    .map((p) => [p, score(p)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([p]) => p);
}
