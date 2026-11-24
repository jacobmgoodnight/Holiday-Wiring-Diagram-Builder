import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { downloadBlob, fileSlug } from '../diagram/exportImage';
import type { Display, DisplayNode, Placement, PhotoView } from '../model/types';
import { Sheet } from '../ui/Sheet';
import { bulbColors, cablePath, toPx, wiringLines } from './geometry';
import { BulbDefs, Lights, Marker } from './PhotoEditor';

export interface PictureOptions {
  night: boolean;
  /** Item markers and run labels. */
  items: boolean;
  /** Cables between items. */
  cables: boolean;
  /** Numbered badges (install sheet): item ID → step number. */
  numbers?: Record<string, number>;
}

/** Where an item's number badge goes: a marker's top right, or the plug end of a run. */
function badgeAt(p: Placement, view: PhotoView, u: number): [number, number] {
  if (p.kind === 'point') {
    const [x, y] = toPx([p.x, p.y], view);
    return [x + 20 * u, y - 20 * u];
  }
  // Runs and bushes carry their label above the plug end: the number goes just below it.
  const [x, y] = toPx(p.points[0], view);
  return [x - 10 * u, y + 16 * u];
}

const none = () => {};

/** The photo's overlay as a standalone SVG, sized for the full photo (no zoom). */
export function MockupSvg({ display, view, night, items, cables, numbers }: { display: Display; view: PhotoView } & PictureOptions) {
  // As if the whole photo were shown about 1400 px wide: bulbs and labels stay readable.
  const u = Math.max(view.width, view.height) / 1400;
  const placed: { node: DisplayNode; placement: Placement }[] = [];
  for (const n of Object.values(display.nodes)) {
    const p = n.placements?.[view.id];
    // Zip cord drawn along the house is wiring: shown with the cords.
    if (p && (cables || n.kind !== 'cord')) placed.push({ node: n, placement: p });
  }
  const layer = (p: Placement) => (p.kind === 'area' ? 0 : p.kind === 'path' ? 1 : 2);
  placed.sort((a, b) => layer(a.placement) - layer(b.placement));
  const colors = [...new Set(placed.filter((x) => x.placement.kind !== 'point').flatMap((x) => bulbColors(x.node)))];
  const grad = (c: string) => `bc${Math.max(0, colors.indexOf(c))}`;
  const lines = cables ? wiringLines(display, view) : [];
  const lights = (node: DisplayNode, placement: Placement) => (
    <Lights key={node.id} node={node} placement={placement} view={view} u={u} ub={u} night={night} grad={grad} hideLabel={!items} />
  );
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={view.width} height={view.height} viewBox={`0 0 ${view.width} ${view.height}`}>
      <BulbDefs colors={colors} />
      {placed.filter((x) => x.placement.kind === 'area').map((x) => lights(x.node, x.placement))}
      {lines.map((l) => {
        const d = cablePath(l.from, l.to);
        return (
          <g key={l.childId} opacity={night ? 0.6 : 1}>
            <path d={d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={4.2 * u} strokeLinecap="round" />
            <path d={d} fill="none" stroke={l.color} strokeWidth={2.4 * u} strokeLinecap="round" />
          </g>
        );
      })}
      {placed.filter((x) => x.placement.kind === 'path').map((x) => lights(x.node, x.placement))}
      {items &&
        placed.map(({ node, placement }) =>
          placement.kind === 'point' ? (
            <Marker key={node.id} node={node} at={toPx([placement.x, placement.y], view)} r={17 * u} u={u} selected={false} target={false} dim={false} onDown={none} onMove={none} onUp={none} />
          ) : null,
        )}
      {numbers &&
        placed.map(({ node, placement }) => {
          const n = numbers[node.id];
          if (n === undefined) return null;
          const [x, y] = badgeAt(placement, view, u);
          return (
            <g key={`n-${node.id}`} transform={`translate(${x} ${y})`}>
              <circle r={12 * u} fill="#1d4ed8" stroke="#ffffff" strokeWidth={2.5 * u} />
              <text y={4.5 * u} fontSize={13 * u} textAnchor="middle" fontWeight={800} fill="#ffffff" fontFamily="system-ui, sans-serif">
                {n}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not draw the picture'));
    img.src = src;
  });
}

/**
 * The photo with its lights drawn on, as a JPEG at the photo's own size. The night look
 * darkens the photo the way the on-screen preview does.
 */
export async function renderPicture(display: Display, view: PhotoView, photoUrl: string, opts: PictureOptions): Promise<Blob> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(host);
  const root = createRoot(host);
  let markup: string;
  try {
    // Out of whatever React is doing now (an effect), so the render can happen right away.
    await new Promise((r) => setTimeout(r));
    flushSync(() => root.render(<MockupSvg display={display} view={view} {...opts} />));
    let svg = host.querySelector('svg');
    for (let i = 0; !svg && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 16));
      svg = host.querySelector('svg');
    }
    if (!svg) throw new Error('Could not draw the picture');
    markup = new XMLSerializer().serializeToString(svg);
  } finally {
    root.unmount();
    host.remove();
  }
  const overlayUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const [photo, overlay] = await Promise.all([loadImage(photoUrl), loadImage(overlayUrl)]);
    const canvas = document.createElement('canvas');
    canvas.width = view.width;
    canvas.height = view.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot make pictures');
    ctx.drawImage(photo, 0, 0, view.width, view.height);
    if (opts.night) {
      ctx.fillStyle = 'rgba(4, 8, 22, 0.7)';
      ctx.fillRect(0, 0, view.width, view.height);
    }
    ctx.drawImage(overlay, 0, 0, view.width, view.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/jpeg', 0.92));
  } finally {
    URL.revokeObjectURL(overlayUrl);
  }
}

interface Props {
  display: Display;
  view: PhotoView;
  photoUrl?: string;
  /** Start with the night look when the photo is showing it. */
  night: boolean;
  onClose: () => void;
}

/** "Save picture": the mockup with lights, day or night, to keep or share. */
export function PictureSheet({ display, view, photoUrl, night: startNight, onClose }: Props) {
  const [opts, setOpts] = useState<PictureOptions>({ night: startNight, items: false, cables: false });
  const [pic, setPic] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const name = `${fileSlug(display.title)}-${fileSlug(view.name)}${opts.night ? '-night' : ''}.jpg`;

  useEffect(() => {
    if (!photoUrl) return;
    let live = true;
    setBusy(true);
    setError('');
    renderPicture(display, view, photoUrl, opts)
      .then((blob) => {
        if (!live) return;
        const url = URL.createObjectURL(blob);
        setPic((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url, blob };
        });
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [display, view, photoUrl, opts]);
  useEffect(() => () => setPic((old) => (old && URL.revokeObjectURL(old.url), null)), []);

  const file = useMemo(() => (pic ? new File([pic.blob], name, { type: 'image/jpeg' }) : undefined), [pic, name]);
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <Sheet title="Save picture" onClose={onClose} className="picture-sheet">
      <div className="picture-preview">
        {pic ? <img src={pic.url} alt={`Preview: ${view.name} with the lights drawn on`} className={busy ? 'busy' : ''} /> : <div className="picture-wait">{photoUrl ? 'Making the picture…' : 'Loading photo…'}</div>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="picture-opts">
        <div className="seg" role="group" aria-label="Look">
          <button type="button" className={!opts.night ? 'on' : ''} aria-pressed={!opts.night} onClick={() => setOpts((o) => ({ ...o, night: false }))}>
            ☀️ Day
          </button>
          <button type="button" className={opts.night ? 'on' : ''} aria-pressed={opts.night} onClick={() => setOpts((o) => ({ ...o, night: true }))}>
            🌙 Night
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={opts.items} onChange={(e) => setOpts((o) => ({ ...o, items: e.target.checked }))} />
          Show items and labels
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.cables} onChange={(e) => setOpts((o) => ({ ...o, cables: e.target.checked }))} />
          Show cords
        </label>
      </div>
      <p className="muted small">Lights only makes a picture to show family; add items, labels and cords for whoever helps install.</p>
      <div className="row confirm-row">
        {canShare && (
          <button type="button" disabled={busy || !file} onClick={() => file && void navigator.share({ files: [file], title: display.title }).catch(() => {})}>
            Share…
          </button>
        )}
        <button type="button" className="primary" disabled={busy || !pic} onClick={() => pic && downloadBlob(pic.blob, name)}>
          Save picture
        </button>
      </div>
    </Sheet>
  );
}
