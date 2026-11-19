/** Standalone, print-friendly SVG of a layout (always light colours). Pure; no DOM needed. */
import type { Layout, LayoutEdge, LayoutNode, Tone } from './layout';
import { LINE_H } from './layout';

export const TONE_COLORS: Record<Tone, { fill: string; stroke: string; text: string }> = {
  power: { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
  load: { fill: '#fdf0d5', stroke: '#b7791f', text: '#5b3a0a' },
  media: { fill: '#ede9fe', stroke: '#7c3aed', text: '#3b0764' },
  new: { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' },
  retired: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#64748b' },
  unused: { fill: '#f8fafc', stroke: '#94a3b8', text: '#64748b' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Orthogonal connector: right side of source to left side of target, bend near the target. */
export function edgePath(s: LayoutNode, t: LayoutNode): { d: string; labelX: number; labelY: number } {
  const x1 = s.x + s.w;
  const y1 = s.y + s.h / 2;
  const x2 = t.x;
  const y2 = t.y + t.h / 2;
  if (x2 <= x1 + 8) {
    // Target is not to the right (signal reference across clusters): loop around the right side.
    const out = Math.max(x1, t.x + t.w) + 30;
    return {
      d: `M${x1},${y1} H${out} V${y2} H${t.x + t.w}`,
      labelX: out,
      labelY: (y1 + y2) / 2,
    };
  }
  const bend = Math.max(x1 + 14, x2 - 30);
  return { d: `M${x1},${y1} H${bend} V${y2} H${x2}`, labelX: x2 - 15, labelY: y2 };
}

function nodeSvg(n: LayoutNode): string {
  const c = TONE_COLORS[n.tone];
  const dash = n.type === 'ghost' ? ' stroke-dasharray="4 3"' : '';
  const parts = [`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"${dash}/>`];
  const tx = n.x + 10;
  let ty = n.y + 9 + 13;
  n.lines.forEach((line, i) => {
    let content = esc(line);
    if (i === 0 && n.type === 'item' && n.nodeId && line.startsWith(n.nodeId)) {
      content = `<tspan font-weight="700" font-family="ui-monospace, Menlo, monospace">${esc(n.nodeId)}</tspan>${esc(line.slice(n.nodeId.length))}`;
    }
    const style = n.tone === 'retired' ? ' text-decoration="line-through"' : '';
    parts.push(`<text x="${tx}" y="${n.type === 'ghost' ? n.y + n.h / 2 + 4 : ty}" font-size="13" fill="${c.text}"${style}>${content}</text>`);
    ty += LINE_H;
  });
  if (n.meta) parts.push(`<text x="${tx}" y="${ty}" font-size="11.5" fill="${c.text}" opacity="0.8">${esc(n.meta)}</text>`);
  return parts.join('');
}

function edgeSvg(e: LayoutEdge, byId: Map<string, LayoutNode>): string {
  const s = byId.get(e.source);
  const t = byId.get(e.target);
  if (!s || !t) return '';
  const { d, labelX, labelY } = edgePath(s, t);
  const signal = e.kind === 'signal';
  const color = signal ? '#7c3aed' : '#475569';
  const parts = [`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${signal ? ' stroke-dasharray="6 4"' : ''}/>`];
  if (e.label) {
    const w = Math.max(18, e.label.length * 7 + 8);
    parts.push(
      `<rect x="${labelX - w / 2}" y="${labelY - 9}" width="${w}" height="18" rx="4" fill="#ffffff" stroke="${color}" stroke-width="1"/>`,
      `<text x="${labelX}" y="${labelY + 4}" font-size="11" text-anchor="middle" fill="${color}">${esc(e.label)}</text>`,
    );
  }
  return parts.join('');
}

export function layoutToSvg(layout: Layout, title: string, note = 'Planning aid only: estimates, not an electrical inspection.'): string {
  const margin = 24;
  const header = 40;
  const footer = 28;
  const w = Math.ceil(layout.width + margin * 2);
  const h = Math.ceil(layout.height + margin * 2 + header + footer);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const body: string[] = [];
  for (const c of layout.clusters) {
    body.push(
      `<rect x="${c.x - 6}" y="${c.y}" width="${c.w + 12}" height="${c.h}" rx="12" fill="#f8fafc" stroke="#cbd5e1"/>`,
      `<text x="${c.x + 8}" y="${c.y + 20}" font-size="14" font-weight="700" fill="#0f172a">${esc(c.title)}</text>`,
    );
  }
  for (const e of layout.edges) body.push(edgeSvg(e, byId));
  for (const n of layout.nodes) body.push(nodeSvg(n));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${margin}" y="${margin + 14}" font-size="20" font-weight="700" fill="#0f172a">${esc(title)}</text>`,
    `<g transform="translate(${margin + 6},${margin + header})">${body.join('')}</g>`,
    `<text x="${margin}" y="${h - 12}" font-size="11" fill="#64748b">${esc(note)}</text>`,
    `</svg>`,
  ].join('');
}
