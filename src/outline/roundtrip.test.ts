import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Display, DisplayNode } from '../model/types';
import { type BuildResult, buildDisplay } from './build';
import { serializeOutline } from './serialize';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');

const rebuild = (prev: BuildResult, prevText: string, text: string) =>
  buildDisplay(text, { previous: { display: prev.display, text: prevText, lineNodeIds: prev.lineNodeIds } });

/** label → id, for checking that existing items kept their IDs. */
const idsByLabel = (d: Display) => {
  const out = new Map<string, string[]>();
  for (const n of Object.values(d.nodes)) out.set(n.label, [...(out.get(n.label) ?? []), n.id]);
  return out;
};

const expectSameIds = (before: Display, after: Display, except: string[] = []) => {
  const a = idsByLabel(before);
  const b = idsByLabel(after);
  for (const [label, ids] of a) if (!except.includes(label)) expect(b.get(label), label).toEqual(ids);
};

const replaceLine = (text: string, from: string, to: string) => {
  expect(text.includes(from), from).toBe(true);
  return text.replace(from, to);
};

describe('stable IDs across text edits', () => {
  const base = buildDisplay(halloween, { id: 'h' });

  it('inserting a line never renumbers existing items', () => {
    const text = replaceLine(halloween, '        3: Orange spotlight B\n', '        3: Orange spotlight B\n        Extra spotlight C\n');
    const next = rebuild(base, halloween, text);
    expectSameIds(base.display, next.display);
    expect(Object.values(next.display.nodes).find((n) => n.label === 'Extra spotlight C')!.id).toBe('L27');
  });

  it('a new splitter inserted above an auto-numbered one does not steal its ID', () => {
    const text = replaceLine(halloween, '          Internal 3-way\n', '          New 2-way splitter\n          Internal 3-way\n');
    const next = rebuild(base, halloween, text);
    expectSameIds(base.display, next.display);
    expect(Object.values(next.display.nodes).find((n) => n.label === 'New 2-way splitter')!.id).toBe('S10');
  });

  it('a fresh parse (no history) of the same insert would renumber; history prevents it', () => {
    const text = replaceLine(halloween, 'Office outlet\n', 'Shed outlet\nOffice outlet\n');
    const fresh = buildDisplay(text);
    expect(Object.values(fresh.display.nodes).find((n) => n.label === 'Office outlet')!.id).toBe('O05');
    const next = rebuild(base, halloween, text);
    expect(Object.values(next.display.nodes).find((n) => n.label === 'Office outlet')!.id).toBe('O04');
    expect(Object.values(next.display.nodes).find((n) => n.label === 'Shed outlet')!.id).toBe('O07');
  });

  it('deleting a line keeps everyone else', () => {
    const text = replaceLine(halloween, '      Pond mister\n', '');
    const next = rebuild(base, halloween, text);
    expectSameIds(base.display, next.display, ['Pond mister']);
    expect(Object.keys(next.display.nodes)).toHaveLength(54);
  });

  it('editing a line in place keeps its ID and updates its fields', () => {
    const fan = Object.values(base.display.nodes).find((n) => n.label === 'Fan')!;
    const text = replaceLine(halloween, '              Fan\n', '              Box fan 40W\n');
    const next = rebuild(base, halloween, text);
    expect(next.display.nodes[fan.id]).toMatchObject({ label: 'Box fan', watts: 40, kind: 'load' });
    expectSameIds(base.display, next.display, ['Fan']);
  });

  it('re-indenting a line keeps its ID', () => {
    const fan = Object.values(base.display.nodes).find((n) => n.label === 'Fan')!;
    const text = replaceLine(halloween, '              Fan\n', '            Fan\n');
    const next = rebuild(base, halloween, text);
    expect(next.display.nodes[fan.id].label).toBe('Fan');
    expect(next.display.links.find((l) => l.to === fan.id)).toMatchObject({ from: 'C07' });
  });

  it('cut and paste elsewhere keeps the ID', () => {
    const mister = Object.values(base.display.nodes).find((n) => n.label === 'Pond mister')!;
    let text = replaceLine(halloween, '      Pond mister\n', '');
    text = replaceLine(text, '          PC cooling fan\n', '          PC cooling fan\n          Pond mister\n');
    const next = rebuild(base, halloween, text);
    expect(next.display.nodes[mister.id]).toBeDefined();
    expect(next.display.links.find((l) => l.to === mister.id)).toMatchObject({ from: 'T02' });
  });

  it('keeps model-only fields such as notes through text edits', () => {
    const d = structuredClone(base.display);
    d.nodes.S03.notes = 'Stake is by the hose bib';
    d.nodes.S03.storage = 'Tote 4';
    const prev = { ...base, display: d };
    const text = replaceLine(halloween, '      Marine blower\n', '      Marine blower 300W\n');
    const next = rebuild(prev, halloween, text);
    expect(next.display.nodes.S03).toMatchObject({ notes: 'Stake is by the hose bib', storage: 'Tote 4' });
  });

  it('a kind change on an auto-numbered line gets an ID of the new kind', () => {
    const fan = Object.values(base.display.nodes).find((n) => n.label === 'Fan')!;
    const text = replaceLine(halloween, '              Fan\n', '              Fan cord\n');
    const next = rebuild(base, halloween, text);
    expect(next.display.nodes[fan.id]).toBeUndefined();
    const cord = Object.values(next.display.nodes).find((n) => n.label === 'Fan cord')!;
    expect(cord).toMatchObject({ kind: 'cord', id: 'C10' });
  });

  it('typing an auto-assigned ID after ~ links to that item rather than taking the ID', () => {
    const skelly = Object.values(base.display.nodes).find((n) => n.label === '12-ft Skelly')!;
    const text = replaceLine(halloween, '    ~BLE 6.5-ft Ultra Skelly\n', `    ~BLE 6.5-ft Ultra Skelly\n    ~BLE ${skelly.id}\n`);
    const next = rebuild(base, halloween, text);
    expect(next.display.nodes[skelly.id].label).toBe('12-ft Skelly');
    expect(next.display.links.filter((l) => l.kind === 'signal' && l.from === 'P01').map((l) => l.to)).toContain(skelly.id);
    expect(Object.keys(next.display.nodes)).toHaveLength(55);
  });

  it('reports a duplicate typed ID and gives the second line a new one', () => {
    const text = replaceLine(halloween, '          2: C09 short black cord\n', '          2: C02 short black cord\n');
    const next = buildDisplay(text);
    expect(next.diagnostics.find((d) => d.severity === 'error')).toMatchObject({ line: 13 });
    expect(next.display.nodes.C02.label).toBe('black cord');
    expect(Object.values(next.display.nodes).find((n) => n.label === 'short black cord')!.id).toBe('C09');
  });
});

describe('model → outline', () => {
  const base = buildDisplay(halloween, { id: 'h' });
  const lineDiff = (a: string, b: string) => {
    const x = a.split('\n');
    const y = b.split('\n');
    expect(y.length).toBe(x.length);
    return x.flatMap((line, i) => (line === y[i] ? [] : [[line, y[i]]]));
  };

  it('a diagram edit rewrites only the touched line', () => {
    const d = structuredClone(base.display);
    const fog = Object.values(d.nodes).find((n) => n.label === 'Fog machine')!;
    fog.watts = 400;
    d.nodes.C02.status = 'verified';
    const out = serializeOutline(d).text;
    expect(lineDiff(halloween, out)).toEqual([
      ['    left: C02 black cord 10ft', '    left: C02 black cord 10ft [verified]'],
      ['      Fog machine', '      Fog machine 400W'],
    ]);
  });

  it('a node added on the diagram appears as one new canonical line and keeps its ID on re-parse', () => {
    const d = structuredClone(base.display);
    d.nodes.L27 = { id: 'L27', kind: 'load', label: 'Strobe', status: 'planned', tags: ['yard'], watts: 25, isNew: true };
    d.links.push({ id: 'new1', kind: 'power', from: 'S09', to: 'L27', port: '1', seq: 0 });
    const ser = serializeOutline(d);
    expect(ser.text).toContain('\n          Internal 3-way\n            1: Strobe 25W [new] [yard]\n');
    const back = buildDisplay(ser.text, { previous: { display: d, text: ser.text, lineNodeIds: ser.lineNodeIds } });
    expect(back.display.nodes.L27).toMatchObject({ label: 'Strobe', watts: 25, isNew: true, tags: ['yard'] });
  });

  it('a changed kind is written as a bracket word only when the words would not imply it', () => {
    const d = structuredClone(base.display);
    const fan = Object.values(d.nodes).find((n) => n.label === 'PC cooling fan')!;
    fan.kind = 'enclosure';
    expect(serializeOutline(d).text).toContain(`          ${fan.id} PC cooling fan [tote]\n`);
  });

  it('canonical output (no remembered text) re-parses to the same model', () => {
    const d = structuredClone(base.display);
    const strip = (n: DisplayNode) => delete n.src;
    Object.values(d.nodes).forEach(strip);
    for (const l of d.links) delete l.src;
    const text = serializeOutline(d).text;
    const back = buildDisplay(text, { id: 'h' });
    expect(back.diagnostics.filter((x) => x.severity !== 'info')).toEqual([]);
    const pick = (x: Display) =>
      Object.values(x.nodes)
        .map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label,
          status: n.status,
          qty: n.qty,
          watts: n.watts,
          lengthFt: n.lengthFt,
          lengthApprox: n.lengthApprox,
          tags: n.tags,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(pick(back.display)).toEqual(pick(base.display));
    const links = (x: Display) => x.links.map((l) => [l.kind, l.from, l.to, l.port ?? '', l.signalType ?? '']).sort();
    expect(links(back.display)).toEqual(links(base.display));
  });

  it('writes a signal reference by ID, and the ID on its target, when the name is ambiguous', () => {
    const text = 'Office outlet\n  Spotlight\n  Spotlight\n  ESP32\n';
    const b = buildDisplay(text);
    const d = structuredClone(b.display);
    d.links.push({ id: 'sig', kind: 'signal', from: 'P01', to: 'L02', signalType: 'wifi', seq: 0 });
    const out = serializeOutline(d).text;
    expect(out).toBe('Office outlet\n  Spotlight\n  L02 Spotlight\n  ESP32\n    ~WiFi L02 Spotlight\n');
    const back = buildDisplay(out);
    expect(back.display.links.find((l) => l.kind === 'signal')).toMatchObject({ from: 'P01', to: 'L02', owns: false });
    expect(Object.keys(back.display.nodes)).toHaveLength(4);
  });

  it('never emits an item twice, even if the model has a loop', () => {
    const d = structuredClone(base.display);
    d.links.push({ id: 'loop', kind: 'power', from: 'S02', to: 'O01', seq: 99 });
    const out = serializeOutline(d).text;
    expect(out.split('\n').filter((l) => l.includes('O01'))).toHaveLength(1);
  });
});
