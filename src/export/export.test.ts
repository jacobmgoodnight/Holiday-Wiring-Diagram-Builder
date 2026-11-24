import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addNode, deleteNode, nextNodeId, updateNode } from '../model/actions';
import { buildDisplay } from '../outline/build';
import { toStored } from '../store/db';
import { BackupError, makeBackup, parseBackup, planImport } from './backup';
import { csvCell, displayToCsv } from './csv';
import { assignTieColors, labelCandidates, labelPrep, labelsFor, tiesFor, tiesText } from './labels';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const built = () => buildDisplay(halloween, { id: 'h26' });

describe('labels', () => {
  it('are short: the ID, then a cord\'s length, where lights go, or the gear\'s name', () => {
    let d = built().display;
    const skelly = Object.values(d.nodes).find((n) => n.label === '6.5-ft Ultra Skelly')!;
    d = updateNode(d, skelly.id, { location: 'Front lawn left' }).display;
    const labels = labelsFor(d);
    expect(labels.filter((l) => l.id === 'C02').map((l) => [l.text, l.end])).toEqual([
      ['C02 10 ft', 'plug'],
      ['C02 10 ft', 'far'],
    ]); // the same on both ends
    expect(labels.find((l) => l.id === 'S02')!.text).toBe('S02 4-way splitter');
    expect(labels.find((l) => l.id === skelly.id)!.text).toBe(`${skelly.id} Front lawn left`);
    expect(labels.some((l) => l.id.startsWith('O'))).toBe(false); // walls are not labelled
    expect(labels.map((l) => l.id).slice(0, 3)).toEqual(['K01', 'C02', 'C02']);
    expect(labelsFor(d, { includeLoads: false }).some((l) => l.id.startsWith('L'))).toBe(false);
  });

  it('can add where it plugs in and the storage spot', () => {
    let d = built().display;
    d = updateNode(d, 'C02', { storage: 'Tote 3' }).display;
    const labels = labelsFor(d, { route: true, storage: true });
    expect(labels.filter((l) => l.id === 'C02').map((l) => l.text)).toEqual(['C02 10 ft · into K01 left · Tote 3', 'C02 10 ft · feeds S02 · Tote 3']);
    expect(labels.find((l) => l.id === 'S02')!.route).toBe('C02 → L01, L02, S08 +1');
    expect(labels.find((l) => l.name === 'Dukane 8120WIA')!.route).toBe('into HDMI from K03');
  });

  it('marks with zip ties: a colour per outlet and one tie per story, both optional', () => {
    let d = built().display;
    expect(labelsFor(d)[0].ties).toBeUndefined(); // off unless asked for
    d = { ...d, marks: { colors: true } };
    const colors = assignTieColors(d);
    expect(Object.keys(colors).slice(0, 2)).toEqual(['O01', 'O02']);
    expect(new Set(Object.values(colors)).size).toBe(Object.values(colors).length); // all different
    for (const [id, c] of Object.entries(colors)) d = updateNode(d, id, { tieColor: c }).display;
    d = updateNode(d, 'C02', { story: 2 }).display;
    expect(tiesFor(d, 'C02')).toEqual({ color: colors.O01, count: 1 }); // stories off: one tie
    d = { ...d, marks: { colors: true, stories: true } };
    expect(tiesFor(d, 'C02')).toEqual({ color: colors.O01, count: 2 });
    expect(tiesText(tiesFor(d, 'C02'))).toBe(`2 ${colors.O01} ties`);
    expect(tiesFor(d, 'O01')).toBeUndefined();
    // Stories only, no colours: just the count.
    expect(tiesFor({ ...d, marks: { stories: true } }, 'C02')).toEqual({ color: undefined, count: 2 });
    // What to get ready: C02's two ends need 2 ties each.
    const prep = labelPrep(labelsFor(d).filter((l) => l.id === 'C02' || l.id === 'K01'));
    expect(prep).toEqual({ labels: 3, ties: [{ color: colors.O01, count: 5 }] });
  });

  it('can say what you choose: name instead of length or place, or your own text', () => {
    let d = built().display;
    const skelly = Object.values(d.nodes).find((n) => n.label === '6.5-ft Ultra Skelly')!;
    d = updateNode(d, skelly.id, { location: 'Front lawn left' }).display;
    expect(labelsFor(d, { cordLine: 'name' }).find((l) => l.id === 'C02')!.sub).toBe('black cord');
    expect(labelsFor(d, { lightLine: 'name' }).find((l) => l.id === skelly.id)!.sub).toBe('6.5-ft Ultra Skelly');
    d = updateNode(d, 'C02', { labelText: 'Porch to splitter' }).display;
    expect(labelsFor(d).find((l) => l.id === 'C02')!.text).toBe('C02 Porch to splitter');
  });

  it('picks which: one outlet or photo, new this year, not printed yet, and leaves out unticked items', () => {
    let d = built().display;
    const all = labelsFor(d);
    expect(new Set(labelsFor(d, { ids: new Set(['C02', 'S02']) }).map((l) => l.id))).toEqual(new Set(['C02', 'S02']));
    d = updateNode(d, 'S02', { isNew: true }).display;
    expect(labelsFor(d, { only: 'new' }).map((l) => l.id)).toEqual(['S02']);
    d = updateNode(d, 'K01', { labelPrinted: true }).display;
    expect(labelsFor(d, { only: 'unprinted' }).some((l) => l.id === 'K01')).toBe(false);
    d = updateNode(d, 'C02', { labelSkip: true }).display;
    expect(labelsFor(d).some((l) => l.id === 'C02')).toBe(false);
    expect(labelCandidates(d)).toContain('C02'); // still in the list to tick again
    expect(labelsFor(d)).toHaveLength(all.length - 2); // both ends of C02
  });

  it('never hands out an ID again, so a printed label stays on the right item', () => {
    const b = buildDisplay('O01 Porch\n  C01 cord\n  C02 cord\n', { id: 'x' });
    // Delete the highest cord, then add another: it is C03, not C02.
    const del = deleteNode(b.display, 'C02', false).display;
    expect(del.idHigh).toEqual({ C: 2 });
    expect(nextNodeId(del, 'cord')).toBe('C03');
    expect(addNode(del, { kind: 'cord', label: 'cord' }, { parent: 'O01' }).nodeId).toBe('C03');
    // Through the outline too: delete the line, then type a new cord.
    const t1 = 'O01 Porch\n  C01 cord\n';
    const r1 = buildDisplay(t1, { previous: { display: b.display, text: 'O01 Porch\n  C01 cord\n  C02 cord\n', lineNodeIds: b.lineNodeIds } });
    expect(r1.display.idHigh).toEqual({ C: 2 });
    const r2 = buildDisplay(t1 + '  extension cord\n', { previous: { display: r1.display, text: t1, lineNodeIds: r1.lineNodeIds } });
    expect(Object.keys(r2.display.nodes)).toContain('C03');
    expect(r2.display.idHigh).toBeUndefined(); // nothing to remember once C03 exists
  });
});

describe('CSV', () => {
  it('escapes quotes, commas and line breaks, and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(undefined)).toBe('');
  });

  it('has one row per item with its connection', () => {
    const csv = displayToCsv(built().display);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(56);
    expect(lines[0]).toBe('id,kind,name,plugs_into,socket,link,status,qty,length_ft,sockets,tags,location,storage,new_this_year,retired,notes');
    expect(lines).toContain('C02,cord,black cord,K01,left,power,planned,,10,,,,,,,');
    expect(lines).toContain('C04,cord,cord,C03,end,power,planned,,~5,,,,,,,');
    expect(lines.find((l) => l.startsWith('S08,'))).toContain(',installed,');
  });
});

describe('JSON backup', () => {
  const rec = () => {
    const b = built();
    return toStored(halloween, b.display, b.lineNodeIds, 1000);
  };

  it('round-trips through JSON', () => {
    const backup = makeBackup([rec()], new Date('2026-11-22T00:00:00Z'));
    const back = parseBackup(JSON.stringify(backup));
    expect(back.displays[0].text).toBe(halloween);
    expect(Object.keys(back.displays[0].display.nodes)).toHaveLength(55);
  });

  it('rejects things that are not backups, with a reason', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a Wiring Sketchpad backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'wiring-sketchpad-backup', version: 99, displays: [] }))).toThrow(/newer version/);
    const broken = makeBackup([rec()]);
    (broken.displays[0].display.nodes.C02 as { label: unknown }).label = 5;
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/item C02 is damaged/);
  });

  it('carries photos, and rejects damaged ones', () => {
    const photo = { id: 'p1', type: 'image/jpeg', width: 10, height: 5, base64: 'AAAA' };
    const back = parseBackup(JSON.stringify(makeBackup([rec()], new Date(), [photo])));
    expect(back.photos).toEqual([photo]);
    const bad = makeBackup([rec()], new Date(), [{ ...photo, type: 'text/html' }]);
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/Photo 1/);
    // A version 1 file (no photos) still imports.
    expect(parseBackup(JSON.stringify({ ...makeBackup([rec()]), version: 1, photos: undefined })).displays).toHaveLength(1);
  });

  it('never overwrites: a display that already exists comes in as a copy', () => {
    const incoming = [rec(), { ...rec(), id: 'other' }];
    let n = 0;
    const planned = planImport(new Set(['h26']), incoming, () => `new${++n}`, 5000);
    expect(planned.map((r) => r.id)).toEqual(['new1', 'other']);
    expect(planned[0]).toMatchObject({ title: 'Halloween 2026 (imported)', updatedAt: 5000 });
    expect(planned[0].display.id).toBe('new1');
    expect(planned[0].text.split('\n')[0]).toBe('# Halloween 2026 (imported)');
    const rebuilt = buildDisplay(planned[0].text, { previous: { display: planned[0].display, text: planned[0].text, lineNodeIds: planned[0].lineNodeIds.map((x) => x ?? undefined) } });
    expect(rebuilt.display.title).toBe('Halloween 2026 (imported)');
    expect(Object.keys(rebuilt.display.nodes).sort()).toEqual(Object.keys(planned[0].display.nodes).sort());
  });
});
