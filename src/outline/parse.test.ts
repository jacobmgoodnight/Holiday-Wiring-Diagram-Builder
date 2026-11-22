import { describe, expect, it } from 'vitest';
import { parseContent, parseLines } from './parse';

const c = (text: string, depth = 1) => parseContent(text, depth);

describe('parseContent: tokens', () => {
  it('reads length, quantity, watts and amps anywhere on the line', () => {
    const p = c('Roofline C9 warm white, front  x2  300W');
    expect(p.fields).toMatchObject({ kind: 'load', label: 'Roofline C9 warm white, front', qty: 2, watts: 300 });
    expect(p.inferred.category).toBe('c9');
    expect(c('Inflatable 2.5A').fields.amps).toBe(2.5);
    expect(c('Wreaths  60W').fields.watts).toBe(60);
    expect(c('Mini lights 40 watts').fields.watts).toBe(40);
    expect(c('C02 black cord 10ft').fields).toMatchObject({ explicitId: 'C02', kind: 'cord', label: 'black cord', lengthFt: 10 });
  });

  it('marks ~ values as approximate', () => {
    const p = c('C04 ~5ft cord');
    expect(p.fields).toMatchObject({ lengthFt: 5, lengthApprox: true, label: 'cord' });
    expect(p.signal).toBeUndefined();
    expect(c('Blower ~150W').fields).toMatchObject({ watts: 150, wattsApprox: true });
  });

  it('keeps hyphenated sizes and model numbers in the name', () => {
    expect(c('12-ft Skelly').fields).toMatchObject({ label: '12-ft Skelly', lengthFt: undefined });
    expect(c('6.5-ft Ultra Skelly').fields.lengthFt).toBeUndefined();
    expect(c('Dukane 8120WIA').fields).toMatchObject({ label: 'Dukane 8120WIA', watts: undefined });
    expect(c('Epson EX3210 + Micca G3').fields.qty).toBeUndefined();
    expect(c('Micca 4K').fields.label).toBe('Micca 4K');
  });

  it('reads outlet breaker rating and GFCI', () => {
    const p = c('O01 Front porch outlet @15A GFCI', 0);
    expect(p.fields).toMatchObject({ kind: 'outlet', label: 'Front porch outlet', breakerAmps: 15, gfci: true, amps: undefined });
    expect(c('Garage @20A', 0).fields.breakerAmps).toBe(20);
  });

  it('warns about a breaker rating on something that is not an outlet', () => {
    expect(c('Spotlight @15A').warnings).toHaveLength(1);
  });
});

describe('parseContent: ports, IDs, kinds', () => {
  it('reads port prefixes', () => {
    expect(c('left: C02 black cord').port).toBe('left');
    expect(c('Right: S03 stake').port).toBe('right');
    expect(c('3: S08 3-way splitter').port).toBe('3');
    expect(c('tap: Tombstone spotlight').port).toBe('tap');
    expect(c('end: C04 cord').port).toBe('end');
    expect(c('Note: not a port').port).toBeUndefined();
  });

  it('only treats O/K/C/S/T/P/L plus 2-3 digits at the start as an ID', () => {
    expect(c('C9 roofline').fields.explicitId).toBeUndefined();
    expect(c('S08 splitter').fields.explicitId).toBe('S08');
    expect(c('X01 thing').fields.explicitId).toBeUndefined();
    expect(c('Roofline C09').fields.explicitId).toBeUndefined();
  });

  it('infers kinds from keywords', () => {
    const kind = (t: string, d = 1) => c(t, d).fields.kind;
    expect(kind('Kasa 2-port smart plug')).toBe('smartplug');
    expect(kind('Dusk timer')).toBe('smartplug');
    expect(kind('black cord')).toBe('cord');
    expect(kind('long green multi-outlet extension')).toBe('cord');
    expect(kind('4-way splitter')).toBe('splitter');
    expect(kind('Internal 3-way')).toBe('splitter');
    expect(kind('green 3-way yard stake')).toBe('splitter');
    expect(kind('6-outlet power strip')).toBe('splitter');
    expect(kind('LED strip lights')).toBe('load');
    expect(kind('Projector tote')).toBe('enclosure');
    expect(kind('WLED controller')).toBe('controller');
    expect(kind('Always-on ESP32')).toBe('controller');
    expect(kind('Pixel power supply')).toBe('controller');
    expect(kind('Inflatable snowman')).toBe('load');
    expect(kind('Pathway lights stake')).toBe('load');
  });

  it('defaults top-level lines to outlets unless a load keyword matches (D2)', () => {
    expect(c('Garage window', 0).fields.kind).toBe('outlet');
    expect(c('Inflatable snowman', 0).fields.kind).toBe('load');
    expect(c('Garage window', 1).fields.kind).toBe('load');
  });

  it('lets an explicit [kind] win over ID prefix and keywords', () => {
    expect(c('Singing-pumpkin tote [tote]').fields.kind).toBe('enclosure');
    expect(c('Extension thing [load]').fields.kind).toBe('load');
    const p = c('C10 lights [load]');
    expect(p.fields.kind).toBe('load');
    expect(p.warnings[0]).toMatch(/overrides/);
    expect(c('Thing [strip]')).toMatchObject({ explicitKind: 'splitter', explicitSubtype: 'strip' });
  });

  it('reads status, flags and free tags from brackets', () => {
    const p = c('S08 3-way splitter [installed] [new] [roofline, porch]');
    expect(p.fields).toMatchObject({ status: 'installed', isNew: true, tags: ['roofline', 'porch'], label: '3-way splitter' });
    expect(c('Old wreath [retired]').fields.retired).toBe(true);
  });

  it('infers socket counts and cord colour from the label', () => {
    expect(c('S02 4-way splitter').inferred.outputs).toBe(4);
    expect(c('Kasa 2-port smart plug').inferred.outputs).toBe(2);
    expect(c('C08 brown cord 3-socket end').inferred).toMatchObject({ outputs: 3, color: 'brown' });
  });
});

describe('parseContent: signal links and unused sockets', () => {
  it('reads a leading ~TYPE', () => {
    const p = c('~HDMI Epson 880 (signal)');
    expect(p.signal).toBe('hdmi');
    expect(p.fields.label).toBe('Epson 880');
    expect(c('~BLE 6.5-ft Ultra Skelly').signal).toBe('ble');
    expect(c('~Wi-Fi WLED tree').signal).toBe('wifi');
  });

  it('defaults an unknown ~word to a data link and keeps the word', () => {
    const p = c('~Epson projector');
    expect(p.signal).toBe('data');
    expect(p.fields.label).toBe('Epson projector');
  });

  it('reads a trailing (signal) and infers its type', () => {
    const p = c('Micca 3.5mm AUX -> rechargeable speaker (signal)');
    expect(p.signal).toBe('aux');
    expect(p.fields.label).toBe('Micca 3.5mm AUX -> rechargeable speaker');
  });

  it('does not treat HDMI in a name as a signal link', () => {
    expect(c('Epson EX3210 + Micca G3 (HDMI-to-VGA)').signal).toBeUndefined();
  });

  it('reads Unused socket placeholders', () => {
    expect(c('3: Unused socket')).toMatchObject({ unused: true, port: '3' });
    expect(c('unused').unused).toBe(true);
  });
});

describe('parseLines: structure and bad input', () => {
  it('nests by two-space indentation and normalises tabs', () => {
    const lines = parseLines('O01 outlet\n\tK01 plug\n\t\tC01 cord');
    expect(lines.map((l) => [l.depth, l.parent])).toEqual([
      [0, undefined],
      [1, 0],
      [2, 1],
    ]);
    expect(lines.every((l) => l.warnings.length === 0)).toBe(true);
  });

  it('repairs odd indentation and level jumps with warnings', () => {
    const lines = parseLines('O01 outlet\n   K01 plug\n          C01 cord\n  Fan');
    expect(lines[1]).toMatchObject({ depth: 1, parent: 0 });
    expect(lines[1].warnings[0]).toMatch(/Odd indentation/);
    expect(lines[2]).toMatchObject({ depth: 2, parent: 1 });
    expect(lines[2].warnings[0]).toMatch(/more than one level/);
    expect(lines[3]).toMatchObject({ depth: 1, parent: 0 });
  });

  it('treats a first indented line as top level with a warning', () => {
    const lines = parseLines('    Fan');
    expect(lines[0]).toMatchObject({ depth: 0, parent: undefined });
    expect(lines[0].warnings[0]).toMatch(/nothing above/);
  });

  it('keeps comments in place without making them parents', () => {
    const lines = parseLines('O01 outlet\n  # note about the plug\n  K01 plug');
    expect(lines[1]).toMatchObject({ type: 'comment', parent: 0 });
    expect(lines[2]).toMatchObject({ parent: 0, depth: 1 });
  });

  it('never throws on junk', () => {
    const junk = ['', '\n\n', '\r\n  \r\n', ':::', '[', ']]][[', '~', '~~~~', '@A', 'x', '0: ', '1:', '#', '   #', '\u0000 ', 'a'.repeat(5000)];
    for (const text of junk) expect(() => parseLines(text)).not.toThrow();
  });
});
