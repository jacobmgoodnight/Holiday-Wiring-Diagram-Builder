import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { homeLink, updateNode } from '../model/actions';
import { socketLabels } from '../model/graph';
import type { Display } from '../model/types';
import { buildDisplay } from '../outline/build';
import { syncFromModel } from '../outline/sync';
import { toStored } from '../store/db';
import { makeBackup, parseBackup } from './backup';
import { devicesFile, DEVICES_FORMAT } from './devices';
import { displayToWorkbook, itemsRows, WORKBOOK_COLUMNS, workbookToDisplay } from './workbook';
import { colIndex, colName, readXlsx, writeXlsx, XlsxError } from './xlsx';

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}.outline.txt`, import.meta.url), 'utf8');
const halloween = () => buildDisplay(fixture('halloween-2026'), { id: 'h26' }).display;
const christmas = () => buildDisplay(fixture('christmas-2026'), { id: 'x26' }).display;

/** What the plan says, independent of internal link ids and outline bookkeeping. */
function shape(d: Display) {
  const nodes = Object.values(d.nodes)
    .map((n) => {
      const home = homeLink(d, n.id);
      return {
        id: n.id,
        kind: n.kind,
        label: n.label,
        status: n.status,
        tags: n.tags,
        type: n.kind === 'load' ? n.category : n.subtype,
        qty: n.qty,
        watts: n.watts,
        wattsApprox: !!n.wattsApprox,
        lengthFt: n.lengthFt,
        lengthApprox: !!n.lengthApprox,
        outputs: n.outputs,
        location: n.location,
        circuit: n.circuit,
        storage: n.storage,
        notes: n.notes,
        retired: !!n.retired,
        isNew: !!n.isNew,
        home: home ? `${home.from}|${home.kind}|${home.signalType ?? ''}|${home.kind === 'power' ? socketLabels(d, home.from).get(home.id) : ''}` : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const unused = d.links.filter((l) => l.kind === 'power' && !l.to).map((l) => `${l.from}:${socketLabels(d, l.from).get(l.id)}`).sort();
  const signalRefs = d.links.filter((l) => l.kind === 'signal' && !l.owns).map((l) => `${l.from}->${l.to}:${l.signalType}`).sort();
  return { nodes, unused, signalRefs };
}

describe('xlsx reader and writer', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(['A', 'Z', 'AA', 'ZZ', 'AAA'].map(colIndex)).toEqual([0, 25, 26, 701, 702]);
  });

  it('round-trips text, numbers, booleans and gaps; formulas stay text', () => {
    const rows = [
      ['name', 'watts', 'ok'],
      ['Café <porch> & "lights"', 40.5, true],
      ['=HYPERLINK("x")', -3, false],
      [undefined, undefined, 'only C'],
      [],
      ['line\nbreak', 0, '~5'],
    ];
    const back = readXlsx(writeXlsx([{ name: 'Items', rows }, { name: 'Two/Three', rows: [['a']] }]));
    expect(back.map((s) => s.name)).toEqual(['Items', 'Two Three']);
    expect(back[0].rows[1]).toEqual(['Café <porch> & "lights"', 40.5, true]);
    expect(back[0].rows[2]).toEqual(['=HYPERLINK("x")', -3, false]);
    expect(back[0].rows[3][2]).toBe('only C');
    expect(back[0].rows[3][0]).toBeUndefined();
    expect(back[0].rows[4]).toEqual([]);
    expect(back[0].rows[5]).toEqual(['line\nbreak', 0, '~5']);
  });

  it('reads shared strings and rich text the way Excel saves them', () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const file = zipSync({
      '_rels/.rels': strToU8(`<Relationships><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/workbook.xml': strToU8(`<workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="Items" sheetId="1" r:id="rId7"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships><Relationship Id="rId7" Type="${rel}/worksheet" Target="/xl/worksheets/data.xml"/><Relationship Id="rId8" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
      'xl/sharedStrings.xml': strToU8(
        `<sst ${ns}><si><t>name</t></si><si><r><rPr><b/></rPr><t>Mega</t></r><r><t xml:space="preserve"> tree</t></r><rPh><t>x</t></rPh></si><si><t>Tom &amp; Jerry</t></si></sst>`,
      ),
      'xl/worksheets/data.xml': strToU8(
        `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="str"><f>A1</f><v>calc</v></c><c r="D3"><v>12</v></c></row><row r="4"><c r="A4" t="s"><v>2</v></c></row></sheetData></worksheet>`,
      ),
    });
    const [sheet] = readXlsx(file);
    expect(sheet.rows[0]).toEqual(['name']);
    expect(sheet.rows[1]).toEqual([]);
    expect(sheet.rows[2]).toEqual([undefined, 'Mega tree', 'calc', 12]);
    expect(sheet.rows[3]).toEqual(['Tom & Jerry']);
  });

  it('rejects files that are not workbooks', () => {
    expect(() => readXlsx(strToU8('not a zip'))).toThrow(XlsxError);
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('hi') }))).toThrow(/not an Excel workbook/);
  });
});

describe('Excel export and import', () => {
  for (const [name, make] of [
    ['Halloween fixture', halloween],
    ['Christmas fixture', christmas],
  ] as const) {
    it(`round-trips the ${name}: same items, wiring, sockets and details`, () => {
      let source = make();
      // Model-only fields the outline cannot hold must come through too.
      const first = Object.keys(source.nodes)[0];
      source = updateNode(source, first, { location: 'Front porch', circuit: 'Garage 15A', storage: 'Tote 3', notes: 'GFCI trips in rain' }).display;
      const { display, warnings } = workbookToDisplay(displayToWorkbook(source), 'imported');
      expect(warnings).toEqual([]);
      expect(display.title).toBe(source.title);
      expect(display.season).toBe(source.season);
      expect(display.year).toBe(source.year);
      expect(shape(display)).toEqual(shape(source));

      // Through the outline (as saving does), then exported again: the sheet is identical.
      const synced = syncFromModel(display);
      expect(synced.result.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
      expect(shape(synced.result.display)).toEqual(shape(source));
      expect(itemsRows(synced.result.display)).toEqual(itemsRows(source));
    });
  }

  it('carries the label setup: stories, outlet tie colours, label text, left out, printed, and the zip-tie switches', () => {
    let source: Display = { ...halloween(), marks: { colors: true, stories: true } };
    source = updateNode(source, 'O01', { tieColor: 'red' }).display;
    source = updateNode(source, 'C02', { story: 2, labelText: 'Porch to splitter', labelPrinted: true }).display;
    source = updateNode(source, 'S02', { labelSkip: true }).display;
    const { display } = workbookToDisplay(displayToWorkbook(source), 'imported');
    expect(display.marks).toEqual({ colors: true, stories: true });
    expect(display.nodes.O01.tieColor).toBe('red');
    expect(display.nodes.C02).toMatchObject({ story: 2, labelText: 'Porch to splitter', labelPrinted: true });
    expect(display.nodes.S02.labelSkip).toBe(true);
    // Through the outline (as saving does): still there.
    const synced = syncFromModel(display).result.display;
    expect(synced.marks).toEqual({ colors: true, stories: true });
    expect(synced.nodes.C02.story).toBe(2);
    // Typed by hand: a colour name works too.
    const typed = workbookToDisplay(
      writeXlsx([{ name: 'Items', rows: [['name', 'kind', 'tie_color', 'story'], ['Porch outlet', 'outlet', 'Blue', ''], ['Wreath', 'load', '', '2']] }]),
      'typed',
    ).display;
    expect(Object.values(typed.nodes).map((n) => [n.label, n.tieColor, n.story])).toEqual([
      ['Porch outlet', 'blue', undefined],
      ['Wreath', undefined, 2],
    ]);
  });

  it('writes one row per item plus written unused sockets, in diagram order', () => {
    const d = halloween();
    const rows = itemsRows(d);
    expect(rows[0]).toEqual([...WORKBOOK_COLUMNS]);
    const items = rows.slice(1).filter((r) => r[1] !== 'unused socket');
    expect(items).toHaveLength(Object.keys(d.nodes).length);
    const col = (c: (typeof WORKBOOK_COLUMNS)[number]) => WORKBOOK_COLUMNS.indexOf(c);
    const c02 = rows.find((r) => r[0] === 'C02')!;
    expect([c02[col('plugs_into')], c02[col('socket')], c02[col('length_ft')]]).toEqual(['K01', 'left', 10]);
    expect(rows.find((r) => r[0] === 'C04')![col('length_ft')]).toBe('~5');
  });

  it('imports a hand-typed sheet: fills in ids and kinds, numbers sockets, explains problems', () => {
    const file = writeXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['Name', 'Plugs into', 'Socket', 'Watts', 'Location', 'Kind'],
          ['Front porch outlet', '', '', '', 'Front porch'],
          ['4-way splitter', 'O01'],
          ['Mega tree', 'S01', '', '~120'],
          ['Wreath', 'S01', '', 15],
          ['Ghost', 'X99'],
          ['Mystery', '', '', '', '', 'gizmo'],
        ],
      },
    ]);
    const { display, warnings } = workbookToDisplay(file, 'new', 'My sheet');
    expect(display.title).toBe('My sheet');
    const by = (label: string) => Object.values(display.nodes).find((n) => n.label === label)!;
    expect(by('Front porch outlet')).toMatchObject({ id: 'O01', kind: 'outlet', location: 'Front porch' });
    expect(by('4-way splitter')).toMatchObject({ id: 'S01', kind: 'splitter' });
    expect(by('Mega tree')).toMatchObject({ kind: 'load', category: 'tree', watts: 120, wattsApprox: true });
    expect(socketLabels(display, 'S01').get(homeLink(display, by('Wreath').id)!.id)).toBe('2');
    expect(homeLink(display, by('Ghost').id)).toBeUndefined();
    expect(warnings).toEqual([
      'Row 7: kind "gizmo" is not known; used outlet.',
      'Row 6: plugs into X99, which is not in the sheet; left it not plugged in.',
    ]);
    // A loop is refused rather than written.
    const loop = writeXlsx([{ name: 'Items', rows: [['id', 'name', 'plugs_into'], ['C01', 'cord a', 'C02'], ['C02', 'cord b', 'C01']] }]);
    const looped = workbookToDisplay(loop, 'l');
    expect(looped.warnings).toEqual(['Row 3: plugging into C01 would make a loop; left it not plugged in.']);
  });

  it('refuses sheets without a name column or items', () => {
    expect(() => workbookToDisplay(writeXlsx([{ name: 'Items', rows: [['foo'], ['bar']] }]), 'x')).toThrow(/needs a "name" column/);
    expect(() => workbookToDisplay(writeXlsx([{ name: 'Items', rows: [['name']] }]), 'x')).toThrow(/has no items/);
  });

  it('survives the JSON backup after import', () => {
    const imported = syncFromModel(workbookToDisplay(displayToWorkbook(christmas()), 'imp').display);
    const rec = toStored(imported.text, imported.result.display, imported.result.lineNodeIds, 1);
    const back = parseBackup(JSON.stringify(makeBackup([rec])));
    expect(shape(back.displays[0].display)).toEqual(shape(christmas()));
  });
});

describe('device file for the dashboard', () => {
  it('lists every item with outlet, inherited zone and circuit, as plain JSON', () => {
    let d = halloween();
    d = updateNode(d, 'O01', { location: 'Front porch', circuit: 'Breaker 12' }).display;
    const file = JSON.parse(JSON.stringify(devicesFile(d, new Date('2026-11-24T00:00:00Z'))));
    expect(file.format).toBe(DEVICES_FORMAT);
    expect(file.version).toBe(1);
    expect(file.devices).toHaveLength(Object.keys(d.nodes).length);
    const c02 = file.devices.find((x: { id: string }) => x.id === 'C02');
    expect(c02).toMatchObject({ outlet: 'O01', plugsInto: 'K01', socket: 'left', link: 'power', zone: 'Front porch', location: null, circuit: 'Breaker 12', qty: 1 });
    const o01 = file.devices.find((x: { id: string }) => x.id === 'O01');
    expect(o01).toMatchObject({ outlet: 'O01', plugsInto: null, zone: 'Front porch', location: 'Front porch' });
    expect(file.signals.length).toBe(d.links.filter((l) => l.kind === 'signal' && l.to).length);
    expect(file.signals.some((s: { type: string }) => s.type === 'hdmi')).toBe(true);
  });
});
