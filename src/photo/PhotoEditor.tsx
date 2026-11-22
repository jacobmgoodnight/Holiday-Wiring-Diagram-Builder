import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toneOf } from '../diagram/layout';
import type { Display, DisplayNode, Placement, PhotoView } from '../model/types';
import { iconFor } from '../presets/custom';
import { TONE_COLORS } from '../diagram/svg';
import {
  type Pt,
  bulbColors,
  bulbSpacingPx,
  feetPerPxFrom,
  pointsAlong,
  runLengthFt,
  runStyle,
  toFrac,
  toPx,
  wiringLines,
} from './geometry';

/** What the next tap on the photo does. */
export type PhotoIntent =
  | { type: 'place'; nodeId?: string; presetId?: string; name: string }
  | { type: 'draw'; nodeId?: string; presetId?: string; name: string }
  | { type: 'scale' }
  | { type: 'move'; nodeId: string };

interface Props {
  display: Display;
  view: PhotoView;
  photoUrl?: string;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  intent?: PhotoIntent;
  onCancelIntent: () => void;
  onPlacePoint: (intent: PhotoIntent, at: Pt) => void;
  onFinishRun: (intent: PhotoIntent, points: Pt[]) => void;
  onSetScale: (feetPerPx: number) => void;
  onMovePlacement: (nodeId: string, placement: Placement) => void;
  /** Move intent: plug the moving item into the tapped one. */
  onPlugInto: (nodeId: string, parentId: string) => void;
  /** Items that cannot be plug targets for the moving item. */
  blocked?: Set<string>;
  night: boolean;
  wiring: boolean;
  fitKey: string;
}

interface Xf {
  x: number;
  y: number;
  k: number;
}

const TAP_SLOP = 6;

export function PhotoEditor(props: Props) {
  const { display, view, photoUrl, selectedId, intent, night, wiring } = props;
  const box = useRef<HTMLDivElement>(null);
  const [xf, setXf] = useState<Xf>({ x: 0, y: 0, k: 0.3 });
  const xfRef = useRef(xf);
  xfRef.current = xf;
  const [draft, setDraft] = useState<Pt[]>([]); // fractions, for draw and scale
  const [feet, setFeet] = useState('');
  const [preview, setPreview] = useState<{ nodeId: string; placement: Placement } | null>(null);

  // ---- Fit the photo into the box.
  const fit = () => {
    const el = box.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const k = Math.min(cw / view.width, ch / view.height);
    setXf({ k, x: (cw - view.width * k) / 2, y: (ch - view.height * k) / 2 });
  };
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [props.fitKey, view.id, view.width, view.height]);
  useEffect(() => {
    setDraft([]);
    setFeet('');
  }, [intent]);

  // When the box changes size (details panel opens, phone rotates): re-fit if the photo was
  // fitted, otherwise keep the same spot in the middle.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let prev = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === prev.w && h === prev.h) return;
      const fitBefore = Math.min(prev.w / view.width, prev.h / view.height);
      const cur = xfRef.current;
      if (Math.abs(cur.k - fitBefore) < 1e-3 * fitBefore + 1e-6) fit();
      else setXf({ ...cur, x: cur.x + (w - prev.w) / 2, y: cur.y + (h - prev.h) / 2 });
      prev = { w, h };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view.id, view.width, view.height]);

  const toImage = (clientX: number, clientY: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    const { x, y, k } = xfRef.current;
    return [(clientX - r.left - x) / k, (clientY - r.top - y) / k];
  };
  const inPhoto = (p: Pt) => p[0] >= 0 && p[1] >= 0 && p[0] <= view.width && p[1] <= view.height;

  // ---- Background gestures: pan, pinch, wheel; a tap acts on the current intent.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch?: { d0: number; mid: Pt; xf: Xf }; pan?: Xf } | null>(null);

  const onDown = (e: RPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, pan: xfRef.current };
    else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const r = box.current!.getBoundingClientRect();
      gesture.current = {
        startX: 0,
        startY: 0,
        moved: true,
        pinch: { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top], xf: xfRef.current },
      };
    }
  };
  const onMove = (e: RPointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !gesture.current) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.pinch && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const r = box.current!.getBoundingClientRect();
      const mid: Pt = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
      const k = clampK(g.pinch.xf.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.d0));
      const ix = (g.pinch.mid[0] - g.pinch.xf.x) / g.pinch.xf.k;
      const iy = (g.pinch.mid[1] - g.pinch.xf.y) / g.pinch.xf.k;
      setXf({ k, x: mid[0] - ix * k, y: mid[1] - iy * k });
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
    if (g.moved && g.pan) setXf({ ...g.pan, x: g.pan.x + dx, y: g.pan.y + dy });
  };
  const onUp = (e: RPointerEvent) => {
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size) return;
    gesture.current = null;
    if (!g || g.moved) return;
    tapAt(toImage(e.clientX, e.clientY));
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    const { x, y, k } = xfRef.current;
    const nk = clampK(k * Math.exp(-e.deltaY * 0.0015));
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setXf({ k: nk, x: mx - ((mx - x) / k) * nk, y: my - ((my - y) / k) * nk });
  };
  const clampK = (k: number) => {
    const el = box.current;
    const fitK = el ? Math.min(el.clientWidth / view.width, el.clientHeight / view.height) : 0.2;
    return Math.min(4, Math.max(fitK * 0.5, k));
  };

  const tapAt = (p: Pt) => {
    if (!intent) {
      props.onSelect(undefined);
      return;
    }
    if (!inPhoto(p)) return;
    const f = toFrac(p, view);
    if (intent.type === 'place') props.onPlacePoint(intent, f);
    else if (intent.type === 'draw') setDraft((d) => [...d, f]);
    else if (intent.type === 'scale') setDraft((d) => (d.length >= 2 ? [f] : [...d, f]));
  };

  // ---- Marker and vertex drags (commit on release; a tap selects).
  const drag = useRef<{ id: string; start: Pt; base: Placement; vertex?: number; moved: boolean } | null>(null);
  const startDrag = (e: RPointerEvent, nodeId: string, base: Placement, vertex?: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: nodeId, start: [e.clientX, e.clientY], base, vertex, moved: false };
  };
  const moveDrag = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.start[0]) / xfRef.current.k;
    const dy = (e.clientY - d.start[1]) / xfRef.current.k;
    if (!d.moved && Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) <= TAP_SLOP) return;
    if (intent) return; // no dragging while placing, drawing, measuring or plugging in
    d.moved = true;
    const shift = (q: Pt): Pt => toFrac([q[0] * view.width + dx, q[1] * view.height + dy], view);
    let next: Placement;
    if (d.base.kind === 'point') {
      const [x, y] = shift([d.base.x, d.base.y]);
      next = { kind: 'point', x, y };
    } else if (d.vertex !== undefined) {
      next = { kind: 'path', points: d.base.points.map((q, i) => (i === d.vertex ? shift(q) : q)) };
    } else next = { kind: 'path', points: d.base.points.map(shift) };
    setPreview({ nodeId: d.id, placement: next });
  };
  const endDrag = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.stopPropagation();
    if (d.moved && preview && preview.nodeId === d.id) props.onMovePlacement(d.id, preview.placement);
    else if (!d.moved) {
      if (intent?.type === 'move') {
        if (d.id !== intent.nodeId && !props.blocked?.has(d.id)) props.onPlugInto(intent.nodeId, d.id);
      } else if (intent?.type === 'draw' || intent?.type === 'scale' || intent?.type === 'place') {
        // Taps on top of markers still count as photo taps in these modes.
        tapAt(toImage(e.clientX, e.clientY));
      } else props.onSelect(d.id);
    }
    setPreview(null);
  };

  // ---- Data to draw.
  const placed = useMemo(() => {
    const out: { node: DisplayNode; placement: Placement }[] = [];
    for (const n of Object.values(display.nodes)) {
      const p = preview?.nodeId === n.id ? preview.placement : n.placements?.[view.id];
      if (p) out.push({ node: n, placement: p });
    }
    // Runs underneath, markers on top; the selected item last.
    return out.sort((a, b) => Number(a.placement.kind === 'point') - Number(b.placement.kind === 'point') || Number(a.node.id === selectedId) - Number(b.node.id === selectedId));
  }, [display, view.id, preview, selectedId]);
  const lines = useMemo(() => (wiring ? wiringLines(display, view.id) : []), [display, view.id, wiring]);

  const k = xf.k;
  const u = 1 / k; // one screen pixel in photo pixels
  const markerR = 17 * u;
  const drawPx = draft.map((p) => toPx(p, view));
  const movingId = intent?.type === 'move' ? intent.nodeId : undefined;

  const scalePx = intent?.type === 'scale' && draft.length === 2 ? drawPx : null;
  const scaleFeet = Number(feet);

  return (
    <div className={`photo${night ? ' night' : ''}`}>
      <div
        className={`photo-box${intent ? ' armed' : ''}`}
        ref={box}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        role="application"
        aria-label={`Photo: ${view.name}. Drag to pan, pinch or scroll to zoom.`}
      >
        <div className="photo-stage" style={{ transform: `translate(${xf.x}px, ${xf.y}px) scale(${k})`, width: view.width, height: view.height }}>
          {photoUrl ? <img src={photoUrl} alt="" width={view.width} height={view.height} draggable={false} /> : <div className="photo-missing">Loading photo…</div>}
          <svg className="photo-svg" width={view.width} height={view.height} viewBox={`0 0 ${view.width} ${view.height}`}>
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={Math.max(1.2, 1.8 * u)} result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {lines.map((l) => {
              const a = toPx(l.from, view);
              const b = toPx(l.to, view);
              return <line key={`w-${l.childId}`} className="wire-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={2.5 * u} strokeDasharray={`${8 * u} ${6 * u}`} />;
            })}

            {placed.map(({ node, placement }) =>
              placement.kind === 'path' ? (
                <Run
                  key={node.id}
                  node={node}
                  points={placement.points.map((p) => toPx(p, view))}
                  view={view}
                  u={u}
                  night={night}
                  selected={node.id === selectedId}
                  editable={node.id === selectedId && !intent}
                  dim={!!movingId && (node.id === movingId || !!props.blocked?.has(node.id))}
                  lengthFt={runLengthFt(placement, view)}
                  onDown={(e, vertex) => startDrag(e, node.id, placement, vertex)}
                  onMove={moveDrag}
                  onUp={endDrag}
                />
              ) : (
                <Marker
                  key={node.id}
                  node={node}
                  at={toPx([placement.x, placement.y], view)}
                  r={markerR}
                  u={u}
                  selected={node.id === selectedId}
                  target={!!movingId && node.id !== movingId && !props.blocked?.has(node.id)}
                  dim={!!movingId && (node.id === movingId || !!props.blocked?.has(node.id))}
                  onDown={(e) => startDrag(e, node.id, placement)}
                  onMove={moveDrag}
                  onUp={endDrag}
                />
              ),
            )}

            {intent?.type === 'draw' && drawPx.length > 0 && (
              <g className="draft">
                <polyline points={drawPx.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={3 * u} />
                {drawPx.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={6 * u} />
                ))}
              </g>
            )}
            {intent?.type === 'scale' && drawPx.length > 0 && (
              <g className="draft scale">
                <polyline points={drawPx.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={3 * u} />
                {drawPx.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={6 * u} />
                ))}
              </g>
            )}
          </svg>
        </div>
        <button type="button" className="photo-fit" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={fit} aria-label="Fit photo">
          Fit
        </button>
      </div>

      {intent && (
        <div className="photo-banner" role="status">
          {intent.type === 'place' && (
            <span>
              Tap the photo where <b>{intent.name}</b> goes.
            </span>
          )}
          {intent.type === 'draw' && (
            <>
              <span>
                Tap along the house to draw <b>{intent.name}</b>. {draft.length ? `${draft.length} point${draft.length === 1 ? '' : 's'}.` : ''}
              </span>
              <button type="button" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>
                Undo point
              </button>
              <button type="button" className="primary" disabled={draft.length < 2} onClick={() => props.onFinishRun(intent, draft)}>
                Done
              </button>
            </>
          )}
          {intent.type === 'scale' &&
            (scalePx ? (
              <form
                className="scale-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fpp = feetPerPxFrom(draft[0], draft[1], scaleFeet, view);
                  if (fpp) props.onSetScale(fpp);
                }}
              >
                <label>
                  That line is{' '}
                  <input autoFocus inputMode="decimal" aria-label="Length in feet" value={feet} onChange={(e) => setFeet(e.target.value)} size={4} /> ft
                </label>
                <button type="submit" className="primary" disabled={!(scaleFeet > 0)}>
                  Save
                </button>
              </form>
            ) : (
              <span>Tap both ends of something you know the length of (a garage door is often 16 ft).</span>
            ))}
          {intent.type === 'move' && (
            <span>
              Tap what <b>{intent.nodeId}</b> plugs into.
            </span>
          )}
          <button type="button" onClick={props.onCancelIntent}>
            Cancel
          </button>
        </div>
      )}

    </div>
  );
}

interface MarkerProps {
  node: DisplayNode;
  at: Pt;
  r: number;
  u: number;
  selected: boolean;
  target: boolean;
  dim: boolean;
  onDown: (e: RPointerEvent) => void;
  onMove: (e: RPointerEvent) => void;
  onUp: (e: RPointerEvent) => void;
}

function Marker({ node, at, r, u, selected, target, dim, onDown, onMove, onUp }: MarkerProps) {
  const c = TONE_COLORS[toneOf(node)];
  const labelW = (node.id.length * 8 + 12) * u;
  return (
    <g
      className={`marker${selected ? ' selected' : ''}${target ? ' target' : ''}${dim ? ' dim' : ''}`}
      transform={`translate(${at[0]} ${at[1]})`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="button"
      aria-label={`${node.id} ${node.label} on photo`}
    >
      <circle r={r * 1.5} fill="transparent" />
      <circle r={r} fill="#ffffff" stroke={selected ? '#f59e0b' : c.stroke} strokeWidth={(selected ? 4 : 2.5) * u} />
      <text y={6 * u} fontSize={18 * u} textAnchor="middle">
        {iconFor(node)}
      </text>
      <rect x={-labelW / 2} y={r + 3 * u} width={labelW} height={17 * u} rx={5 * u} fill={c.fill} stroke={c.stroke} strokeWidth={u} />
      <text y={r + 15.5 * u} fontSize={12 * u} textAnchor="middle" fontWeight={700} fill={c.text} fontFamily="ui-monospace, Menlo, monospace">
        {node.id}
      </text>
    </g>
  );
}

interface RunProps {
  node: DisplayNode;
  points: Pt[];
  view: PhotoView;
  u: number;
  night: boolean;
  selected: boolean;
  /** Show draggable corner handles (selected, and not placing or drawing). */
  editable: boolean;
  dim: boolean;
  lengthFt?: number;
  onDown: (e: RPointerEvent, vertex?: number) => void;
  onMove: (e: RPointerEvent) => void;
  onUp: (e: RPointerEvent) => void;
}

/** A light run: cable plus evenly spaced bulbs in the item's colours; glows at night. */
function Run({ node, points, view, u, night, selected, editable, dim, lengthFt, onDown, onMove, onUp }: RunProps) {
  const style = runStyle(node);
  const colors = bulbColors(node);
  const spacing = bulbSpacingPx(style, view);
  // Zoomed out, real spacing can be a few screen pixels: draw every Nth bulb so each one
  // still reads as a light (zoom in to see them all).
  const stride = Math.max(1, Math.ceil((10 * u) / spacing));
  const bulbs = style === 'plain' ? [] : pointsAlong(points, spacing * stride);
  // Real proportions, but never smaller than a few screen pixels so runs read on a phone.
  const realR = style === 'c9' ? spacing * 0.2 : style === 'pathway' ? spacing * 0.12 : spacing * 0.28;
  const bulbR = Math.max(realR, (style === 'c9' || style === 'pathway' ? 2.6 : 1.8) * u);
  const line = points.map((p) => p.join(',')).join(' ');
  const label = `${node.id}${lengthFt !== undefined ? ` · ~${Math.round(lengthFt)} ft` : ''}`;
  const labelW = (label.length * 7.4 + 12) * u;
  const [lx, ly] = points[0];
  return (
    <g className={`run${selected ? ' selected' : ''}${dim ? ' dim' : ''}`} onPointerMove={onMove} onPointerUp={onUp} aria-label={`${node.id} ${node.label} light run`} role="button">
      <polyline points={line} fill="none" stroke="transparent" strokeWidth={22 * u} onPointerDown={(e) => onDown(e)} />
      <polyline points={line} fill="none" stroke={selected ? '#f59e0b' : night ? '#1c2a1c' : '#2c3e2c'} strokeWidth={(selected ? 3.5 : 2) * u} pointerEvents="none" />
      <g filter={night ? 'url(#glow)' : undefined} pointerEvents="none">
        {bulbs.map((b, i) => (
          <g key={i}>
            {style === 'icicle' && i % 2 === 0 && <line x1={b[0]} y1={b[1]} x2={b[0]} y2={b[1] + spacing * (1.5 + (i % 3))} stroke={colors[0]} strokeWidth={Math.max(1, bulbR * 0.5)} opacity={0.85} />}
            {night && <circle cx={b[0]} cy={b[1]} r={bulbR * 2} fill={colors[i % colors.length]} opacity={0.16} />}
            <circle cx={b[0]} cy={b[1]} r={night ? bulbR * 1.2 : bulbR} fill={colors[i % colors.length]} stroke={night ? 'none' : 'rgba(0,0,0,0.35)'} strokeWidth={0.6 * u} />
          </g>
        ))}
      </g>
      {style === 'plain' && <polyline points={line} fill="none" stroke={colors[0]} strokeWidth={5 * u} strokeDasharray={`${2 * u} ${6 * u}`} strokeLinecap="round" pointerEvents="none" />}
      <g transform={`translate(${lx} ${ly - 18 * u})`} pointerEvents="none">
        <rect x={-labelW / 2} y={-12 * u} width={labelW} height={18 * u} rx={5 * u} fill="rgba(255,255,255,0.92)" stroke="#475569" strokeWidth={u} />
        <text y={1.5 * u} fontSize={12 * u} textAnchor="middle" fontWeight={700} fill="#0f172a" fontFamily="ui-monospace, Menlo, monospace">
          {label}
        </text>
      </g>
      {editable &&
        points.map((p, i) => (
          <circle
            key={`v${i}`}
            className="vertex"
            cx={p[0]}
            cy={p[1]}
            r={9 * u}
            strokeWidth={2.5 * u}
            onPointerDown={(e) => onDown(e, i)}
            aria-label={`Point ${i + 1} of ${node.id}`}
          />
        ))}
    </g>
  );
}
