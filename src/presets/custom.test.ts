import { describe, expect, it } from 'vitest';
import { addNode } from '../model/actions';
import { buildDisplay } from '../outline/build';
import { parseContent } from '../outline/parse';
import { iconFor, presetFromNode, presetText, splitLine, suggest } from './custom';
import { PRESETS } from './presets';

describe('save as preset', () => {
  const d = buildDisplay('O01 Porch\n  C01 green cord 25ft\n  S01 green 3-way yard stake\n  Skelly 12ft tall\n', { id: 't' }).display;

  it('keeps kind, length, colour and socket count, and picks a matching icon', () => {
    const p = presetFromNode(d.nodes.C01, '', '', 'custom-1');
    expect(p).toMatchObject({ name: 'green cord', icon: '➰', kind: 'cord', lengthFt: 25, color: 'green', custom: true, group: 'power' });
    expect(presetFromNode(d.nodes.S01, 'Green stake', '', 'x')).toMatchObject({ name: 'Green stake', outputs: 3, subtype: 'stake', icon: '📍' });
    expect(iconFor({ kind: 'load', category: 'inflatable' })).toBe('⛄');
  });

  it('adds an item with the saved details', () => {
    const p = presetFromNode(d.nodes.C01, 'Green 25', '', 'custom-1');
    const r = addNode(d, p, { parent: 'S01' });
    expect(r.display.nodes[r.nodeId!]).toMatchObject({ kind: 'cord', label: 'green cord', lengthFt: 25, color: 'green' });
  });

  it('writes outline text that reads back as the same kind', () => {
    for (const p of [...PRESETS, presetFromNode(d.nodes.C01, '', '', 'c')]) {
      const parsed = parseContent(presetText(p), 1);
      expect(parsed.fields.kind, p.id).toBe(p.kind);
      if (p.subtype) expect(parsed.inferred.subtype ?? parsed.explicitSubtype, p.id).toBe(p.subtype);
    }
    expect(presetText(presetFromNode(d.nodes.C01, '', '', 'c'))).toBe('green cord 25ft');
  });
});

describe('outline autocomplete', () => {
  const mine = { ...PRESETS.find((p) => p.id === 'cord')!, id: 'm1', name: 'Green 25', label: 'green cord', lengthFt: 25, custom: true };
  const all = [mine, ...PRESETS];

  it('splits off indentation, socket and signal prefixes', () => {
    expect(splitLine('    left: gre')).toEqual({ head: '    left: ', body: 'gre' });
    expect(splitLine('  ~HDMI proj')).toEqual({ head: '  ~HDMI ', body: 'proj' });
    expect(splitLine('Spot')).toEqual({ head: '', body: 'Spot' });
  });

  it('suggests your presets first, then built-ins, matching word starts', () => {
    expect(suggest('    gre', all).map((p) => p.id)).toEqual(['m1']);
    expect(suggest('  3: cord', all).map((p) => p.id)).toEqual(['m1', 'cord', 'multi']);
    expect(suggest('  inflat', all).map((p) => p.id)).toEqual(['inflatable']);
    expect(suggest('  candy', all).map((p) => p.id)).toEqual(['pathway']);
  });

  it('stays quiet for short text, typed IDs, comments and exact matches', () => {
    expect(suggest('  c', all)).toEqual([]);
    expect(suggest('  C02 bla', all)).toEqual([]);
    expect(suggest('# cord', all)).toEqual([]);
    expect(suggest('  Inflatable', all)).toEqual([]);
  });
});
