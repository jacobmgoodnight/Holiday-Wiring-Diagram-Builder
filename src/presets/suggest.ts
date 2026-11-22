/** Picker suggestions for where something is being plugged in. */
import { childrenOf } from '../model/navigate';
import type { Display, DisplayNode } from '../model/types';
import { iconFor, presetFromNode } from './custom';
import { PRESETS, type Preset } from './presets';

/** Light strings with an end plug for the next run. */
const CHAINABLE = new Set(['c9', 'mini', 'icicle', 'pathway']);

const byId = (ids: string[]): Preset[] => ids.map((id) => PRESETS.find((p) => p.id === id)!).filter(Boolean);

/** "Another Spotlight": a preset made from an existing item, so filling sockets is one tap. */
export function anotherOf(node: DisplayNode): Preset {
  const p = presetFromNode(node, `Another ${node.label || node.id}`, iconFor(node), `like:${node.id}`);
  return { ...p, custom: false };
}

/**
 * What usually goes here: gear under outlets and plugs, splitters at the end of cords, and
 * more of the same under splitters. `like` is the item next to the socket being filled.
 */
export function suggestionsFor(display: Display, parentId: string | null, likeId?: string, max = 6): Preset[] {
  const out: Preset[] = [];
  const like = likeId ? display.nodes[likeId] : undefined;
  if (like) out.push(anotherOf(like));
  const parent = parentId ? display.nodes[parentId] : undefined;
  if (!parent) out.push(...byId(['outlet', 'smartplug2', 'cord']));
  else {
    switch (parent.kind) {
      case 'outlet':
        out.push(...byId(['smartplug2', 'smartplug', 'timer', 'cord', 'strip']));
        break;
      case 'smartplug':
        out.push(...byId(['cord', 'split3', 'stake', 'strip']));
        break;
      case 'cord':
        out.push(...byId(['split3', 'stake', 'strip', 'cord']));
        break;
      case 'load':
        // Light strings daisy-chain: another run of the same. Other loads rarely pass power on.
        if (CHAINABLE.has(parent.category ?? '')) out.push(anotherOf(parent));
        out.push(...byId(['cord', 'split3']));
        break;
      default: {
        // Splitters, totes, controllers: more of what is already plugged in, then common loads.
        for (const sib of childrenOf(display, parent.id)) {
          const n = display.nodes[sib];
          if (n && n.id !== likeId && out.every((p) => p.label !== n.label || p.kind !== n.kind)) out.push(anotherOf(n));
          if (out.length >= 3) break;
        }
        out.push(...byId(['spot', 'inflatable', 'c9', 'mini']));
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.kind}|${p.label}|${p.lengthFt ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}
