import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDisplay } from '../outline/build';
import { INDENT, type Layout, clusterList, layoutDisplay, wrap } from './layout';
import { edgePath, layoutToSvg } from './svg';

const load = (name: string) => buildDisplay(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'), { id: name });

const overlaps = (layout: Layout) => {
  const out: string[] = [];
  const ns = layout.nodes;
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i];
      const b = ns[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id}/${b.id}`);
    }
  return out;
};

describe('layout: Halloween fixture', () => {
  const { display } = load('halloween-2026.outline.txt');
  const layout = layoutDisplay(display);

  it('draws every item once, plus unused sockets', () => {
    const items = layout.nodes.filter((n) => n.type === 'item');
    expect(items).toHaveLength(55);
    // S03 socket 3 (written), K02 second port, S09 internal 3-way x3.
    const ghosts = layout.nodes.filter((n) => n.type === 'ghost').map((n) => n.parentId);
    expect(ghosts.sort()).toEqual(['K02', 'S03', 'S09', 'S09', 'S09']);
  });

  it('makes one cluster per outlet in outline order', () => {
    expect(layout.clusters.map((c) => c.id)).toEqual(['O01', 'O02', 'O03', 'O04', 'O05', 'O06']);
    expect(layout.clusters[0].title).toBe('O01 Front porch outlet');
    for (let i = 1; i < layout.clusters.length; i++) {
      const prev = layout.clusters[i - 1];
      expect(layout.clusters[i].y).toBeGreaterThanOrEqual(prev.y + prev.h);
    }
  });

  it('keeps each item inside its cluster and nothing overlapping', () => {
    expect(overlaps(layout)).toEqual([]);
    for (const n of layout.nodes) {
      const c = layout.clusters.find((c) => c.id === n.cluster)!;
      expect(n.y, n.id).toBeGreaterThanOrEqual(c.y);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(c.y + c.h + 1);
    }
  });

  it('flows left to right: every power child is right of its parent', () => {
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const e of layout.edges.filter((e) => !e.reference)) {
      expect(byId.get(e.target)!.x, e.id).toBeGreaterThan(byId.get(e.source)!.x);
    }
  });

  it('labels sockets like the Halloween diagrams', () => {
    const label = (s: string, t: string) => layout.edges.find((e) => e.source === s && e.target === t)?.label;
    expect(label('K01', 'C02')).toBe('left');
    expect(label('K01', 'S03')).toBe('right');
    expect(label('S02', 'S08')).toBe('3');
    expect(label('C03', 'C04')).toBe('end');
    expect(label('O01', 'K01')).toBeUndefined();
    expect(layout.edges.find((e) => e.target === 'ghost:S03:0')?.label).toBe('3');
    expect(layout.edges.find((e) => e.target === 'ghost:K02:0')?.label).toBe('2');
  });

  it('stacks children in outline order, socket 1 on top', () => {
    const y = (id: string) => layout.nodes.find((n) => n.id === id)!.y;
    const children = (parent: string) => layout.edges.filter((e) => e.source === parent && e.kind === 'power').map((e) => e.target);
    for (const parent of ['S02', 'S08', 'S01', 'C03', 'S04', 'K01']) {
      const ys = children(parent).map(y);
      expect(ys, parent).toEqual([...ys].sort((a, b) => a - b));
    }
  });

  it('draws the ESP32 BLE link to the Skelly as a dashed reference', () => {
    const skelly = Object.values(display.nodes).find((n) => n.label === '6.5-ft Ultra Skelly')!;
    expect(layout.edges.find((e) => e.source === 'P01')).toMatchObject({ target: skelly.id, kind: 'signal', reference: true, label: 'BLE' });
  });

  it('colours by kind', () => {
    const tone = (id: string) => layout.nodes.find((n) => n.id === id)!.tone;
    expect(tone('S02')).toBe('power');
    expect(tone('T01')).toBe('media');
    expect(tone('P01')).toBe('media');
    expect(tone(Object.values(display.nodes).find((n) => n.label === 'Pumpkin arch')!.id)).toBe('load');
    expect(tone(Object.values(display.nodes).find((n) => n.label === 'Epson 880 + Micca 4K')!.id)).toBe('media');
  });

  it('shows one outlet on its own', () => {
    const one = layoutDisplay(display, { focus: 'O02' });
    expect(one.clusters.map((c) => c.id)).toEqual(['O02']);
    expect(one.nodes.filter((n) => n.type === 'item')).toHaveLength(11);
    expect(one.clusters[0].y).toBe(0);
    // Focusing on an item shows the outlet it belongs to.
    expect(layoutDisplay(display, { focus: 'S04' }).clusters.map((c) => c.id)).toEqual(['O01']);
  });

  it('exports an SVG with every item and the planning note', () => {
    const svg = layoutToSvg(layout, display.title);
    expect(svg.startsWith('<svg')).toBe(true);
    for (const id of Object.keys(display.nodes)) expect(svg, id).toContain(`>${id}</tspan>`);
    expect(svg).toContain('Unused socket');
    expect(svg).toContain('not an electrical inspection');
    expect(svg).toContain('AUX -&gt;');
    expect(svg).not.toMatch(/<text[^>]*>[^<]*-> /);
  });
});

describe('layout: Christmas fixture', () => {
  const { display, diagnostics } = load('christmas-2026.outline.txt');

  it('parses cleanly', () => {
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(display).toMatchObject({ season: 'christmas', year: 2026 });
  });

  it('lays out without overlaps and links the WLED controller to the pixel tree', () => {
    const layout = layoutDisplay(display);
    expect(overlaps(layout)).toEqual([]);
    const tree = Object.values(display.nodes).find((n) => n.label === 'Pixel tree, 400 pixels')!;
    expect(tree).toMatchObject({ isNew: true, tags: ['tree'] });
    expect(layout.edges.find((e) => e.source === 'P02')).toMatchObject({ target: tree.id, kind: 'signal', label: 'WIFI', reference: true });
    expect(layout.nodes.find((n) => n.id === tree.id)!.tone).toBe('new');
    expect(clusterList(display).map((c) => c.id)).toEqual(['O01', 'O02', 'O03', 'O04', 'O05']);
  });

  it('round-trips byte for byte', async () => {
    const { serializeOutline } = await import('../outline/serialize');
    const text = readFileSync(new URL('../../fixtures/christmas-2026.outline.txt', import.meta.url), 'utf8');
    expect(serializeOutline(display).text).toBe(text);
  });
});

describe('unplugged items', () => {
  it('collect into one "Not plugged in yet" cluster', () => {
    const { display } = buildDisplay('Inflatable snowman\nWreath 40W\nO01 Porch outlet\n  Spotlight');
    const layout = layoutDisplay(display);
    expect(layout.clusters.map((c) => [c.id, c.title])).toEqual([
      ['O01', 'O01 Porch outlet'],
      ['unplugged', 'Not plugged in yet'],
    ]);
  });

  it('handles an empty display', () => {
    expect(layoutDisplay(buildDisplay('').display)).toMatchObject({ nodes: [], clusters: [], height: 0 });
  });
});

describe('wrap', () => {
  it('wraps words and caps lines with an ellipsis', () => {
    expect(wrap('S04 3-way under 12-ft Skelly (yard tap)', 20)).toEqual(['S04 3-way under', '12-ft Skelly (yard', 'tap)']);
    expect(wrap('a b c d e f g h', 3, 2)).toEqual(['a b', 'c…']);
    expect(wrap('x'.repeat(40), 10)).toEqual(['xxxxxxxxx…']);
  });
});

describe('layout: tall (indented) for phones and upright pages', () => {
  const { display } = load('halloween-2026.outline.txt');
  const wide = layoutDisplay(display);
  const tall = layoutDisplay(display, { direction: 'tall' });

  it('has the same items, wires and labels as the wide layout, without overlaps', () => {
    expect(tall.direction).toBe('tall');
    expect(tall.nodes.map((n) => n.id).sort()).toEqual(wide.nodes.map((n) => n.id).sort());
    expect(tall.edges.map((e) => `${e.id}:${e.label ?? ''}`).sort()).toEqual(wide.edges.map((e) => `${e.id}:${e.label ?? ''}`).sort());
    expect(overlaps(tall)).toEqual([]);
  });

  it('puts each item under what it plugs into, one step in, in outline order', () => {
    const byId = new Map(tall.nodes.map((n) => [n.id, n]));
    for (const e of tall.edges.filter((e) => !e.reference)) {
      const s = byId.get(e.source)!;
      const t = byId.get(e.target)!;
      expect(t.x - s.x, e.id).toBe(INDENT);
      expect(t.y, e.id).toBeGreaterThan(s.y);
    }
    // Much narrower than the wide layout: it fits a phone.
    expect(tall.width).toBeLessThan(wide.width / 2);
  });

  it('draws wires down the trunk and across, with the socket label on the trunk', () => {
    const byId = new Map(tall.nodes.map((n) => [n.id, n]));
    const s = byId.get('K01')!;
    const t = byId.get('C02')!;
    const p = edgePath(s, t, true);
    expect(p.d).toBe(`M${s.x + 16},${s.y + s.h} V${t.y + t.h / 2} H${t.x}`);
    expect([p.labelX, p.labelY]).toEqual([s.x + 16, t.y + t.h / 2]);
    expect(layoutToSvg(tall, 'Halloween')).toContain('>left</text>');
  });
});
