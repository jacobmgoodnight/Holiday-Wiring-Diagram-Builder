import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { updateNode } from '../model/actions';
import { buildDisplay } from '../outline/build';
import { toStored } from '../store/db';
import { BackupError, makeBackup, parseBackup, planImport } from './backup';
import { csvCell, displayToCsv } from './csv';
import { labelsFor } from './labels';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const built = () => buildDisplay(halloween, { id: 'h26' });

describe('labels', () => {
  it('labels cords and gear in your style, in outline order', () => {
    const labels = labelsFor(built().display);
    expect(labels.find((l) => l.id === 'C02')!.text).toBe('C02: K01-left → S02');
    expect(labels.find((l) => l.id === 'S02')!.text).toBe('S02: C02 → L01, L02, S08 +1');
    expect(labels.find((l) => l.id === 'C04')!.text).toBe('C04: C03-end → L11');
    expect(labels.find((l) => l.id === 'K01')!.text).toBe('K01: O01 → C02, S03');
    expect(labels.some((l) => l.id.startsWith('O'))).toBe(false); // walls are not labelled
    expect(labels.some((l) => l.id.startsWith('L'))).toBe(false); // loads only on request
    expect(labels.map((l) => l.id).slice(0, 3)).toEqual(['K01', 'C02', 'S02']);
  });

  it('can include loads, label both ends of cords, and add storage spots', () => {
    let d = built().display;
    d = updateNode(d, 'C02', { storage: 'Tote 3' }).display;
    const labels = labelsFor(d, { includeLoads: true, bothEnds: true, storage: true });
    expect(labels.filter((l) => l.id === 'C02').map((l) => l.text)).toEqual([
      'C02 plug → K01-left (store in Tote 3)',
      'C02 end → S02 (store in Tote 3)',
    ]);
    const skelly = Object.values(d.nodes).find((n) => n.label === '6.5-ft Ultra Skelly')!;
    expect(labels.find((l) => l.id === skelly.id)!.text).toBe(`${skelly.id}: S02-2`);
    const dukane = labels.find((l) => l.name === 'Dukane 8120WIA')!;
    expect(dukane.route).toBe('HDMI from K03');
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
    expect(lines[0]).toBe('id,kind,name,plugs_into,socket,link,status,qty,length_ft,sockets,tags,storage,new_this_year,retired,notes');
    expect(lines).toContain('C02,cord,black cord,K01,left,power,planned,,10,,,,,,');
    expect(lines).toContain('C04,cord,cord,C03,end,power,planned,,~5,,,,,,');
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
