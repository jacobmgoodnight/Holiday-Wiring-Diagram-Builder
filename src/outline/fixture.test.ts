import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayStats, socketLabels, unusedSockets } from '../model/graph';
import { buildDisplay } from './build';
import { serializeOutline } from './serialize';

const halloween = readFileSync(new URL('../../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');

describe('Halloween 2026 acceptance fixture', () => {
  const { display, diagnostics } = buildDisplay(halloween, { id: 'h26' });
  const byLabel = (label: string) => Object.values(display.nodes).filter((n) => n.label === label);
  const node = (label: string) => {
    const found = byLabel(label);
    expect(found, label).toHaveLength(1);
    return found[0];
  };
  const parentOf = (id: string) => display.links.find((l) => l.kind === 'power' && l.to === id);

  it('parses to the expected node and link counts', () => {
    expect(displayStats(display)).toEqual({
      nodes: 55,
      powerLinks: 46,
      signalLinks: 4,
      explicitUnused: 1,
      roots: 6,
      byKind: { outlet: 6, smartplug: 4, cord: 9, splitter: 7, enclosure: 2, controller: 1, load: 26 },
    });
  });

  it('has no errors or warnings', () => {
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('reads title, season and year from the heading', () => {
    expect(display).toMatchObject({ title: 'Halloween 2026', season: 'halloween', year: 2026 });
  });

  it('keeps typed IDs and assigns the next free ones', () => {
    for (const id of ['O01', 'O02', 'O03', 'K01', 'K02', 'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'S01', 'S02', 'S03', 'S04', 'S07', 'S08']) {
      expect(display.nodes[id], id).toBeDefined();
    }
    expect(node('Office outlet').id).toBe('O04');
    expect(node('Garage window').id).toBe('O05');
    expect(node('Upstairs window').id).toBe('O06');
    expect(node('Always-on ESP32').id).toBe('P01');
    expect(node('Kasa smart plug / Micca G3').id).toBe('K03');
    expect(node('Internal 3-way')).toMatchObject({ id: 'S09', kind: 'splitter', outputs: 3 });
    expect(node('Singing-pumpkin tote')).toMatchObject({ id: 'T01', kind: 'enclosure' });
    expect(node('Outdoor garage tote').id).toBe('T02');
    expect(node('Pumpkin arch').id).toBe('L01');
  });

  it('reads the K01 left/right and S02 numbered sockets', () => {
    expect(parentOf('C02')).toMatchObject({ from: 'K01', port: 'left' });
    expect(parentOf('S03')).toMatchObject({ from: 'K01', port: 'right' });
    expect(parentOf('S08')).toMatchObject({ from: 'S02', port: '3' });
    expect(display.nodes.S08.status).toBe('installed');
    expect(display.nodes.C04).toMatchObject({ lengthFt: 5, lengthApprox: true });
  });

  it('reads the C03 taps and end in order', () => {
    const out = display.links.filter((l) => l.from === 'C03').sort((a, b) => a.seq - b.seq);
    expect(out.map((l) => [l.port, l.to && display.nodes[l.to].label])).toEqual([
      ['tap', 'Tombstone spotlight (inline)'],
      ['end', 'cord'],
      ['tap', '3-way under 12-ft Skelly (yard tap)'],
    ]);
  });

  it('numbers unlabelled sockets and finds unused ones', () => {
    const c08 = socketLabels(display, 'C08');
    expect([...c08.values()]).toEqual(['1', '2', '3']);
    expect([...socketLabels(display, 'C02').values()]).toEqual([undefined]);
    expect(unusedSockets(display, 'S03')).toBe(1);
    expect(unusedSockets(display, 'K02')).toBe(1);
    expect(unusedSockets(display, 'S02')).toBe(0);
    expect(unusedSockets(display, 'S09')).toBe(3);
  });

  it('links the ESP32 BLE line to the existing Ultra Skelly instead of a duplicate', () => {
    const skelly = node('6.5-ft Ultra Skelly');
    expect(parentOf(skelly.id)).toMatchObject({ from: 'S02', port: '2' });
    expect(display.links.find((l) => l.kind === 'signal' && l.from === 'P01')).toMatchObject({ to: skelly.id, signalType: 'ble', owns: false });
  });

  it('keeps the two Dukane projectors separate, signal-only', () => {
    const dukanes = byLabel('Dukane 8120WIA');
    expect(dukanes).toHaveLength(2);
    for (const d of dukanes) {
      expect(parentOf(d.id)).toBeUndefined();
      expect(display.links.find((l) => l.to === d.id)).toMatchObject({ kind: 'signal', signalType: 'hdmi', owns: true });
    }
  });

  it('treats the tote speaker as a signal link, not power', () => {
    const speaker = node('Micca 3.5mm AUX -> rechargeable speaker');
    expect(parentOf(speaker.id)).toBeUndefined();
    expect(display.links.find((l) => l.to === speaker.id)).toMatchObject({ kind: 'signal', from: 'T01', signalType: 'aux' });
  });

  it('records the explicit unused socket on S03', () => {
    expect(display.links.find((l) => l.to === null)).toMatchObject({ from: 'S03', port: '3' });
  });

  it('never invents a connection: every power link matches an indented line', () => {
    // 55 nodes - 6 outlets - 3 signal-only items = 46 power links, one per indented item line.
    const indentedItems = halloween.split('\n').filter((l) => /^ +\S/.test(l) && !/^\s*~|\(signal\)|Unused socket/.test(l));
    expect(indentedItems).toHaveLength(46);
  });

  it('round-trips byte for byte', () => {
    expect(serializeOutline(display).text).toBe(halloween);
  });
});

describe('outline syntax example from the brief', () => {
  const text = `# Christmas 2026
O01 Front porch outlet @15A GFCI
  K01 Kasa 2-port smart plug
    left: C02 black cord 10ft
      S02 4-way splitter
        Roofline C9 warm white, front  x2  300W
        Wreaths  60W
        3: S08 3-way splitter
          C08 brown cord 3-socket end
            Candy cane pathway lights  x6  72W
          Inflatable snowman  120W
    right: S03 green 3-way yard stake
      Porch spotlight  15W
      2: C03 long green multi-outlet extension
        tap: Tree uplight  20W
        end: C04 5ft cord
          Spotlight on gable  15W
      ~HDMI Epson 880 (signal)
`;
  const { display, diagnostics } = buildDisplay(text, { id: 'x26' });

  it('parses cleanly', () => {
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(display).toMatchObject({ season: 'christmas', year: 2026 });
    expect(display.nodes.O01).toMatchObject({ breakerAmps: 15, gfci: true });
  });

  it('numbers unprefixed children around written ones', () => {
    expect([...socketLabels(display, 'S02').values()]).toEqual(['1', '2', '3']);
    expect([...socketLabels(display, 'S08').values()]).toEqual(['1', '2']);
    expect([...socketLabels(display, 'S03').values()]).toEqual(['1', '2']);
  });

  it('reads watts and quantities', () => {
    const roof = Object.values(display.nodes).find((n) => n.label.startsWith('Roofline'))!;
    expect(roof).toMatchObject({ qty: 2, watts: 300, category: 'c9' });
    const canes = Object.values(display.nodes).find((n) => n.label.startsWith('Candy cane'))!;
    expect(canes).toMatchObject({ qty: 6, watts: 72, category: 'pathway' });
  });

  it('adds the projector as a signal-only item under S03', () => {
    const epson = Object.values(display.nodes).find((n) => n.label === 'Epson 880')!;
    expect(display.links.find((l) => l.to === epson.id)).toMatchObject({ kind: 'signal', from: 'S03', signalType: 'hdmi' });
  });

  it('round-trips byte for byte', () => {
    expect(serializeOutline(display).text).toBe(text);
  });
});
