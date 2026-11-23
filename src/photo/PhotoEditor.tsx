import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { prettyPort, toneOf } from '../diagram/layout';
import type { Target } from '../model/actions';
import type { Display, DisplayNode, Placement, PhotoView } from '../model/types';
import { iconFor } from '../presets/custom';
import { TONE_COLORS } from '../diagram/svg';
import {
  type Pt,
  areaBulbs,
  areaSizeFt,
  areaStyle,
  bounds,
  bulbColors,
  bulbCount,
  bulbSpacingPx,
  cablePath,
  pointAlong,
  feetPerPxFrom,
  footPx,
  nearestOnPolyline,
  nearestOpenSocket,
  runSocketSpots,
  pointsAlong,
  polylineLength,
  runStyle,
  shapePx,
  spacingInOf,
  toFrac,
  toPx,
  wireColorOf,
  wiringLines,
} from './geometry';
import { type LightOpts, LightOptions, lightOptsOf } from './LightOptions';

/** What the next tap on the photo does. */
export type PhotoIntent =
  /** Tap once to put an item (or a new one from a preset) on the photo. */
  | { type: 'place'; nodeId?: string; presetId?: string; name: string; target?: Target }
  /** Tap along the house to draw lights; `area` outlines a bush instead. */
  | { type: 'draw'; nodeId?: string; presetId?: string; name: string; target?: Target; area?: boolean }
  | { type: 'scale' }
  /** Tap what this item plugs into; `fresh` right after adding it ("Later" instead of Cancel). */
  | { type: 'move'; nodeId: string; fresh?: boolean }
  /** An open female was tapped: tap the strand or item that plugs into it. */
  | { type: 'connect'; parentId: string; port: string }
  /** Tap along a run to splice inline females into it. */
  | { type: 'splice'; nodeId: string; added?: number };

/** Things of known size, for measuring the photo. */
export const MEASURE_REFS: { name: string; ft: number; size: string }[] = [
  { name: 'Double garage door', ft: 16, size: '16 ft' },
  { name: 'Single garage door', ft: 9, size: '8–9 ft' },
  { name: 'Front door, wide', ft: 3, size: '3 ft' },
  { name: 'Front door, tall', ft: 6.67, size: '6 ft 8 in' },
  { name: 'Window (often)', ft: 3, size: '3 ft' },
];

/** What a light item looks like: a plan item, or a preset about to become one. */
export type LightNode = Pick<DisplayNode, 'id' | 'kind' | 'label' | 'category' | 'color' | 'bulbColors' | 'spacingIn' | 'smooth' | 'wireColor'>;

interface Props {
  display: Display;
  view: PhotoView;
  photoUrl?: string;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  intent?: PhotoIntent;
  /** The item (or preset) being drawn or placed, for the live preview and its options. */
  draftBase?: LightNode;
  onCancelIntent: () => void;
  onPlacePoint: (intent: PhotoIntent, at: Pt) => void;
  /** `snap`: the drawing started on an open female, so the new run plugs in there. */
  onFinishRun: (intent: PhotoIntent, points: Pt[], opts?: LightOpts, snap?: Target) => void;
  /** Add the new item to the plan without putting it on the photo. */
  onSkipPlacing?: (intent: PhotoIntent) => void;
  onSetScale: (feetPerPx: number) => void;
  onMovePlacement: (nodeId: string, placement: Placement) => void;
  /** Move intent: plug the moving item into the tapped one (into the nearest open female on a run). */
  onPlugInto: (nodeId: string, parentId: string, port?: string) => void;
  /** Connect intent: plug the tapped item into the chosen female. */
  onConnect: (intent: Extract<PhotoIntent, { type: 'connect' }>, childId: string) => void;
  /** Connect intent: plug a new item from the picker into the chosen female. */
  onConnectNew: (intent: Extract<PhotoIntent, { type: 'connect' }>) => void;
  /** A female on a run was tapped (nothing else going on). */
  onSocketTap: (runId: string, port: string) => void;
  onSplice: (runId: string, along: number) => void;
  onMoveTap: (runId: string, index: number, along: number) => void;
  onRemoveFemale: (runId: string, index: number) => void;
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
/** Bulb sizes follow the zoom in steps, so pinching does not redraw every frame. */
const quantize = (k: number) => Math.pow(1.2, Math.round(Math.log(k) / Math.log(1.2)));

export function PhotoEditor(props: Props) {
  const { display, view, photoUrl, selectedId, intent, night, wiring, draftBase } = props;
  const box = useRef<HTMLDivElement>(null);
  const [xf, setXf] = useState<Xf>({ x: 0, y: 0, k: 0.3 });
  const xfRef = useRef(xf);
  xfRef.current = xf;
  const [draft, setDraft] = useState<Pt[]>([]); // fractions, for draw and scale
  const [feet, setFeet] = useState('');
  const [preview, setPreview] = useState<{ nodeId: string; placement: Placement } | null>(null);
  const [opts, setOpts] = useState<LightOpts | undefined>();
  /** Drawing started on an open female: the new run plugs in there. */
  const [snap, setSnap] = useState<{ parent: string; port: string } | undefined>();
  /** An inline female being slid along its run. */
  const [tapPreview, setTapPreview] = useState<{ runId: string; index: number; along: number } | null>(null);
  // Light options while drawing: open on wide screens, a tap away on phones.
  const [showStyle, setShowStyle] = useState(() => typeof window === 'undefined' || window.innerWidth >= 720);

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
    setSnap(undefined);
    setOpts(intent?.type === 'draw' && draftBase ? lightOptsOf(draftBase) : undefined);
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
    const u = 1 / xfRef.current.k;
    if (intent.type === 'place') props.onPlacePoint(intent, f);
    else if (intent.type === 'draw') {
      // Starting on an open female (the end of the last strand) plugs the new one in there.
      const s = draft.length ? undefined : nearestOpenSocket(display, view, p, 24 * u, intent.nodeId);
      if (s) {
        setSnap({ parent: s.parent, port: s.port });
        setDraft([toFrac(s.at, view)]);
      } else setDraft((d) => [...d, f]);
    } else if (intent.type === 'scale') setDraft((d) => (d.length >= 2 ? [f] : [...d, f]));
    else if (intent.type === 'splice') {
      const n = display.nodes[intent.nodeId];
      const pl = n?.placements?.[view.id];
      if (pl?.kind !== 'path') return;
      const near = nearestOnPolyline(shapePx(pl, view, n.smooth)!, p);
      if (Math.hypot(near.at[0] - p[0], near.at[1] - p[1]) <= 30 * u) props.onSplice(intent.nodeId, near.along);
    }
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
    } else {
      const points = d.vertex !== undefined ? d.base.points.map((q, i) => (i === d.vertex ? shift(q) : q)) : d.base.points.map(shift);
      next = { kind: d.base.kind, points };
    }
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
        if (d.id !== intent.nodeId && !props.blocked?.has(d.id)) {
          // On a run, the nearest open female to where you tapped.
          const at = toImage(e.clientX, e.clientY);
          const open = (runSocketSpots(display, d.id, view) ?? []).filter((x) => !x.childId);
          const near = open.sort((a, b) => Math.hypot(a.at[0] - at[0], a.at[1] - at[1]) - Math.hypot(b.at[0] - at[0], b.at[1] - at[1]))[0];
          props.onPlugInto(intent.nodeId, d.id, near?.port);
        }
      } else if (intent?.type === 'connect') {
        if (d.id !== intent.parentId) props.onConnect(intent, d.id);
      } else if (intent?.type === 'draw' || intent?.type === 'scale' || intent?.type === 'place' || intent?.type === 'splice') {
        // Taps on top of markers still count as photo taps in these modes.
        tapAt(toImage(e.clientX, e.clientY));
      } else props.onSelect(d.id);
    }
    setPreview(null);
  };

  // ---- Females on runs: tap to plug something in, drag an inline one along its run.
  const sockDrag = useRef<{ runId: string; port: string; index?: number; childId?: string; start: Pt; moved: boolean } | null>(null);
  const sockDown = (e: RPointerEvent, runId: string, spot: { port: string; index?: number; childId?: string }) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    sockDrag.current = { runId, port: spot.port, index: spot.index, childId: spot.childId, start: [e.clientX, e.clientY], moved: false };
  };
  const sockMove = (e: RPointerEvent) => {
    const s = sockDrag.current;
    if (!s || intent || s.index === undefined) return;
    if (!s.moved && Math.hypot(e.clientX - s.start[0], e.clientY - s.start[1]) <= TAP_SLOP) return;
    s.moved = true;
    const n = display.nodes[s.runId];
    const pl = n?.placements?.[view.id];
    if (pl?.kind !== 'path') return;
    setTapPreview({ runId: s.runId, index: s.index, along: nearestOnPolyline(shapePx(pl, view, n.smooth)!, toImage(e.clientX, e.clientY)).along });
  };
  const sockUp = (e: RPointerEvent) => {
    const s = sockDrag.current;
    sockDrag.current = null;
    if (!s) return;
    e.stopPropagation();
    if (s.moved && tapPreview && s.index !== undefined) props.onMoveTap(s.runId, s.index, tapPreview.along);
    else if (!s.moved) {
      if (intent?.type === 'move') {
        if (s.runId !== intent.nodeId && !props.blocked?.has(s.runId)) props.onPlugInto(intent.nodeId, s.runId, s.port);
      } else if (intent?.type === 'connect') {
        if (s.runId !== intent.parentId) props.onConnect(intent, s.runId);
      } else if (intent) tapAt(toImage(e.clientX, e.clientY));
      else if (s.childId) props.onSelect(s.childId);
      else props.onSocketTap(s.runId, s.port);
    }
    setTapPreview(null);
  };

  // ---- Data to draw (a drag in progress shows where it will land, cables included).
  const live = useMemo(() => {
    if (!preview || !display.nodes[preview.nodeId]) return display;
    const n = display.nodes[preview.nodeId];
    return { ...display, nodes: { ...display.nodes, [n.id]: { ...n, placements: { ...n.placements, [view.id]: preview.placement } } } };
  }, [display, preview, view.id]);
  const placed = useMemo(() => {
    const out: { node: DisplayNode; placement: Placement }[] = [];
    for (const n of Object.values(live.nodes)) {
      const p = n.placements?.[view.id];
      if (p) out.push({ node: n, placement: p });
    }
    // Bushes underneath, then runs, markers on top; the selected item last.
    const layer = (p: Placement) => (p.kind === 'area' ? 0 : p.kind === 'path' ? 1 : 2);
    return out.sort((a, b) => layer(a.placement) - layer(b.placement) || Number(a.node.id === selectedId) - Number(b.node.id === selectedId));
  }, [live, view.id, selectedId]);
  const lines = useMemo(() => (wiring ? wiringLines(live, view) : []), [live, view, wiring]);
  // Females to show: on the selected run, on zip cords while Wiring is on, and on every run
  // while plugging in or drawing.
  const sockets = useMemo(() => {
    const all = intent?.type === 'move' || intent?.type === 'connect' || intent?.type === 'draw';
    const only = intent?.type === 'splice' ? intent.nodeId : !intent ? selectedId : undefined;
    const out: { runId: string; spots: NonNullable<ReturnType<typeof runSocketSpots>> }[] = [];
    for (const n of Object.values(live.nodes)) {
      if (!all && n.id !== only && !(wiring && !intent && n.kind === 'cord')) continue;
      const spots = runSocketSpots(live, n.id, view);
      if (spots?.length) out.push({ runId: n.id, spots });
    }
    return out;
  }, [live, view, intent, selectedId, wiring]);

  const k = xf.k;
  const u = 1 / k; // one screen pixel in photo pixels
  const ub = 1 / quantize(k);
  const markerR = 17 * u;
  const drawPx = draft.map((p) => toPx(p, view));
  const movingId = intent?.type === 'move' ? intent.nodeId : undefined;
  const plugTarget =
    (intent?.type === 'place' || intent?.type === 'draw') && intent.target
      ? intent.target.parent
      : intent?.type === 'splice'
        ? intent.nodeId
        : intent?.type === 'connect'
          ? intent.parentId
          : undefined;

  const scalePx = intent?.type === 'scale' && draft.length === 2 ? drawPx : null;
  const scaleFeet = Number(feet);

  const drawing = intent?.type === 'draw' ? intent : undefined;
  const draftNode = drawing && draftBase ? { ...draftBase, ...(opts ?? {}) } : undefined;
  const draftPlacement: Placement | undefined =
    drawing && draft.length >= (drawing.area ? 3 : 2) ? { kind: drawing.area ? 'area' : 'path', points: draft } : undefined;

  // One glass and one halo gradient per bulb colour in use.
  const colors = useMemo(() => {
    const set = new Set<string>();
    for (const { node, placement } of placed) if (placement.kind !== 'point') bulbColors(node).forEach((c) => set.add(c));
    if (draftNode) bulbColors(draftNode).forEach((c) => set.add(c));
    return [...set];
  }, [placed, draftNode?.bulbColors?.join(), draftNode?.label]);
  const grad = (c: string) => `bc${Math.max(0, colors.indexOf(c))}`;

  const lightsProps = (node: LightNode, placement: Placement) => ({ node, placement, view, u, ub, night, grad });

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
            <BulbDefs colors={colors} />

            {placed.map(({ node, placement }) =>
              placement.kind === 'area' ? (
                <Lights
                  key={node.id}
                  {...lightsProps(node, placement)}
                  selected={node.id === selectedId}
                  editable={node.id === selectedId && !intent}
                  dim={!!movingId && (node.id === movingId || !!props.blocked?.has(node.id))}
                  target={(!!movingId && node.id !== movingId && !props.blocked?.has(node.id)) || node.id === plugTarget}
                  onDown={(e, vertex) => startDrag(e, node.id, placement, vertex)}
                  onMove={moveDrag}
                  onUp={endDrag}
                />
              ) : null,
            )}

            {lines.map((l) => {
              const hot = selectedId === l.childId || selectedId === l.parentId;
              const d = cablePath(l.from, l.to);
              const sag = Math.min(Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]) * 0.18, 400);
              const mid: Pt = [(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2 + sag / 2];
              const len = l.lengthFt !== undefined && hot ? `~${Math.round(l.lengthFt)} ft` : '';
              const via = [l.via.join(', '), len].filter(Boolean).join(' · ');
              return (
                <g key={`w-${l.childId}`} className={`cable${hot ? ' hot' : ''}`} pointerEvents="none">
                  <path d={d} fill="none" stroke={hot ? '#f59e0b' : 'rgba(0,0,0,0.55)'} strokeWidth={(hot ? 6 : 4.2) * u} strokeLinecap="round" />
                  <path
                    className="wire-line"
                    data-wire={`${l.parentId}>${l.childId}`}
                    d={d}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={2.4 * u}
                    strokeLinecap="round"
                  />
                  <rect x={l.from[0] - 3.5 * u} y={l.from[1] - 3.5 * u} width={7 * u} height={7 * u} rx={1.5 * u} fill={l.color} stroke="rgba(0,0,0,0.7)" strokeWidth={u} />
                  {via && (
                    <g transform={`translate(${mid[0]} ${mid[1]})`}>
                      <rect x={-(via.length * 3.7 + 6) * u} y={-8 * u} width={(via.length * 7.4 + 12) * u} height={15 * u} rx={4 * u} fill="rgba(255,255,255,0.92)" stroke={l.color} strokeWidth={u} />
                      <text y={3.5 * u} fontSize={10.5 * u} textAnchor="middle" fontWeight={700} fill="#0f172a" fontFamily="ui-monospace, Menlo, monospace">
                        {via}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {placed.map(({ node, placement }) =>
              placement.kind === 'path' ? (
                <Lights
                  key={node.id}
                  {...lightsProps(node, placement)}
                  selected={node.id === selectedId}
                  editable={node.id === selectedId && !intent}
                  dim={!!movingId && (node.id === movingId || !!props.blocked?.has(node.id))}
                  target={(!!movingId && node.id !== movingId && !props.blocked?.has(node.id)) || node.id === plugTarget}
                  onDown={(e, vertex) => startDrag(e, node.id, placement, vertex)}
                  onMove={moveDrag}
                  onUp={endDrag}
                />
              ) : placement.kind === 'point' ? (
                <Marker
                  key={node.id}
                  node={node}
                  at={toPx([placement.x, placement.y], view)}
                  r={markerR}
                  u={u}
                  selected={node.id === selectedId}
                  target={(!!movingId && node.id !== movingId && !props.blocked?.has(node.id)) || node.id === plugTarget}
                  dim={!!movingId && (node.id === movingId || !!props.blocked?.has(node.id))}
                  onDown={(e) => startDrag(e, node.id, placement)}
                  onMove={moveDrag}
                  onUp={endDrag}
                />
              ) : null,
            )}

            {sockets.map(({ runId, spots }) =>
              spots.map((sp) => {
                const moving = tapPreview && tapPreview.runId === runId && tapPreview.index === sp.index;
                const n = live.nodes[runId];
                const pl = n.placements?.[view.id];
                const at = moving && pl?.kind === 'path' ? pointAlong(shapePx(pl, view, n.smooth)!, tapPreview.along) : sp.at;
                const name = prettyPort(sp.port);
                const hot = intent?.type === 'connect' && intent.parentId === runId && intent.port === sp.port;
                return (
                  <Socket
                    key={`${runId}-${sp.port}`}
                    at={at}
                    u={u}
                    open={!sp.childId}
                    hot={hot || (snap?.parent === runId && snap.port === sp.port)}
                    label={sp.childId ? `${runId} ${name}: ${sp.childId} plugs in here` : `Open female ${name} on ${runId}`}
                    onDown={(e) => sockDown(e, runId, sp)}
                    onMove={sockMove}
                    onUp={sockUp}
                  />
                );
              }),
            )}

            {drawing && draftNode && draftPlacement && <Lights {...lightsProps(draftNode, draftPlacement)} draft />}
            {drawing && drawPx.length > 0 && (
              <g className="draft">
                <polyline
                  points={[...drawPx, ...(drawing.area && drawPx.length > 2 ? [drawPx[0]] : [])].map((p) => p.join(',')).join(' ')}
                  fill="none"
                  strokeWidth={1.5 * u}
                  strokeDasharray={`${5 * u} ${4 * u}`}
                />
                {drawPx.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 ? 7 : 5.5) * u} strokeWidth={2 * u} />
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
        <div className={`photo-banner${drawing ? ' drawing' : ''}`} role="status">
          {intent.type === 'place' && (
            <>
              <span>
                Tap the photo where <b>{intent.name}</b> goes.
                {intent.target?.parent && (
                  <>
                    {' '}
                    It plugs into <b>{intent.target.parent}</b>
                    {display.nodes[intent.target.parent]?.placements?.[view.id] ? '.' : ' (not on this photo yet, so no cable is drawn).'}
                  </>
                )}
              </span>
              {intent.presetId && props.onSkipPlacing && (
                <button type="button" onClick={() => props.onSkipPlacing!(intent)}>
                  Add without placing
                </button>
              )}
            </>
          )}
          {drawing && (
            <>
              <span>
                {drawing.area ? 'Tap around the bush to outline ' : 'Tap along the house to draw '}
                <b>{drawing.name}</b>
                {drawing.target?.parent ? (
                  <>
                    {' '}
                    (plugs into <b>{drawing.target.parent}</b>)
                  </>
                ) : null}
                . {draft.length ? `${draft.length} point${draft.length === 1 ? '' : 's'}.` : drawing.area ? 'Start where it plugs in.' : 'Start at the plug end, or on an open female to plug in there.'}
                {snap && (
                  <>
                    {' '}
                    <b className="snap-note">
                      ✓ Plugs into {snap.parent} {prettyPort(snap.port)}
                    </b>
                  </>
                )}
              </span>
              <button
                type="button"
                disabled={!draft.length}
                onClick={() => {
                  if (draft.length === 1) setSnap(undefined);
                  setDraft((d) => d.slice(0, -1));
                }}
              >
                Undo point
              </button>
              <button type="button" className="primary" disabled={draft.length < (drawing.area ? 3 : 2)} onClick={() => props.onFinishRun(drawing, draft, opts, snap)}>
                Done
              </button>
              <button type="button" onClick={props.onCancelIntent}>
                Cancel
              </button>
              {opts && draftNode && runStyle(draftNode) !== 'plain' && (
                <>
                  <button type="button" className="style-toggle" aria-expanded={showStyle} onClick={() => setShowStyle((v) => !v)}>
                    🎨 Style {showStyle ? '▴' : '▾'}
                  </button>
                  {showStyle && <LightOptions value={opts} area={drawing.area} onChange={(patch) => setOpts((o) => (o ? { ...o, ...patch } : o))} />}
                </>
              )}
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
                <span className="measure-refs" role="group" aria-label="Common sizes">
                  {MEASURE_REFS.map((r) => (
                    <button key={r.name} type="button" className="chip" onClick={() => setFeet(String(r.ft))}>
                      {r.name} {r.size}
                    </button>
                  ))}
                </span>
              </form>
            ) : (
              <span>
                Tap both ends of something you know the size of: a double garage door is 16 ft wide, a front door 3 ft wide
                and 6 ft 8 in tall. Windows vary (often 3 ft, but 2 to 4 ft), so measure one if you can.
              </span>
            ))}
          {intent.type === 'move' && (
            <span>
              Tap what <b>{intent.nodeId}</b> plugs into{intent.fresh ? ' to run its cord' : ''}. On a run, tap near the female it uses.
            </span>
          )}
          {intent.type === 'connect' && (
            <>
              <span>
                Tap the strand or item that plugs into{' '}
                <b>
                  {intent.parentId} {prettyPort(intent.port)}
                </b>
                .
              </span>
              <button type="button" className="primary" onClick={() => props.onConnectNew(intent)}>
                + New item
              </button>
              {intent.port.startsWith('tap') && (
                <button type="button" onClick={() => props.onRemoveFemale(intent.parentId, Number(intent.port.slice(3)) - 1)}>
                  Remove this female
                </button>
              )}
            </>
          )}
          {intent.type === 'splice' && (
            <>
              <span>
                Tap along <b>{intent.nodeId}</b> where an inline female goes{intent.added ? ` (${intent.added} added)` : ''}. Drag a female to
                slide it.
              </span>
              <button type="button" className="primary" onClick={props.onCancelIntent}>
                Done
              </button>
            </>
          )}
          {!drawing && intent.type !== 'splice' && (
            <button type="button" onClick={props.onCancelIntent}>
              {intent.type === 'move' && intent.fresh ? 'Later' : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Glass shapes (unit size, socket at the origin, pointing up) and per-colour glow. */
function BulbDefs({ colors }: { colors: string[] }) {
  return (
    <defs>
      <g id="bulb-c9">
        <path d="M-0.3,-0.3 C-0.7,-0.78 -0.55,-1.6 0,-2.3 C0.55,-1.6 0.7,-0.78 0.3,-0.3 Z" stroke="rgba(0,0,0,0.4)" strokeWidth={0.07} />
        <path d="M-0.2,-0.62 C-0.38,-0.95 -0.3,-1.4 -0.08,-1.8" fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={0.1} strokeLinecap="round" />
        <rect x={-0.31} y={-0.4} width={0.62} height={0.52} rx={0.08} style={{ fill: 'var(--sock, #1f4d2b)' }} />
      </g>
      <g id="bulb-c9-lit">
        <path d="M-0.3,-0.3 C-0.7,-0.78 -0.55,-1.6 0,-2.3 C0.55,-1.6 0.7,-0.78 0.3,-0.3 Z" />
        <rect x={-0.31} y={-0.4} width={0.62} height={0.52} rx={0.08} style={{ fill: 'var(--sock, #1f4d2b)' }} />
      </g>
      <g id="bulb-mini">
        <path d="M0,-0.3 C-0.42,-0.55 -0.4,-1.45 0,-1.9 C0.4,-1.45 0.42,-0.55 0,-0.3 Z" stroke="rgba(0,0,0,0.4)" strokeWidth={0.08} />
        <rect x={-0.22} y={-0.4} width={0.44} height={0.5} rx={0.08} style={{ fill: 'var(--sock, #1f4d2b)' }} />
      </g>
      <g id="bulb-mini-lit">
        <path d="M0,-0.3 C-0.42,-0.55 -0.4,-1.45 0,-1.9 C0.4,-1.45 0.42,-0.55 0,-0.3 Z" />
        <rect x={-0.22} y={-0.4} width={0.44} height={0.5} rx={0.08} style={{ fill: 'var(--sock, #1f4d2b)' }} />
      </g>
      {colors.map((c, i) => (
        <g key={c}>
          <radialGradient id={`bc${i}-lit`} cx="50%" cy="62%" r="62%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor={c} stopOpacity={0.95} />
            <stop offset="1" stopColor={c} />
          </radialGradient>
          <radialGradient id={`bc${i}-halo`}>
            <stop offset="0" stopColor={c} stopOpacity={0.7} />
            <stop offset="0.4" stopColor={c} stopOpacity={0.22} />
            <stop offset="1" stopColor={c} stopOpacity={0} />
          </radialGradient>
        </g>
      ))}
    </defs>
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

interface LightsProps {
  node: LightNode;
  placement: Placement;
  view: PhotoView;
  /** One screen pixel in photo pixels (exact, for outlines and labels). */
  u: number;
  /** The same, in zoom steps (for bulb sizes and how many to draw). */
  ub: number;
  night: boolean;
  grad: (color: string) => string;
  selected?: boolean;
  /** Show draggable corner handles (selected, and not placing or drawing). */
  editable?: boolean;
  dim?: boolean;
  /** Can be tapped as what the moving item plugs into. */
  target?: boolean;
  /** The live preview while drawing: not interactive. */
  draft?: boolean;
  onDown?: (e: RPointerEvent, vertex?: number) => void;
  onMove?: (e: RPointerEvent) => void;
  onUp?: (e: RPointerEvent) => void;
}

const DROPS = [6, 10, 14, 8, 12, 7, 11];

/**
 * A light run or a lit bush, drawn like the real thing: C9/C7 glass bulbs in sockets on the
 * wire, minis, ground stakes, icicle drops, a net or a wrapped bush; glowing at night.
 * Real sizes and spacing once the photo has a scale, but never too small to see.
 */
function Lights(props: LightsProps) {
  const { node, placement, view, u, ub, night, grad, selected, editable, dim, target, draft, onDown, onMove, onUp } = props;
  const area = placement.kind === 'area';
  const style = runStyle(node);
  const shape = useMemo(() => shapePx(placement, view, node.smooth) ?? [], [placement, view.width, view.height, node.smooth]);
  const colors = bulbColors(node);
  const wire = wireColorOf(node);
  const spacing = bulbSpacingPx(node, view);
  const inch = footPx(view) / 12;
  const shapeKind = style === 'c9' || style === 'pathway' ? 'c9' : style === 'pixel' ? 'pixel' : 'mini';
  const w = shapeKind === 'c9' ? Math.max(1.4 * inch, 5.5 * ub) : shapeKind === 'pixel' ? Math.max(0.6 * inch, 3.4 * ub) : Math.max(0.4 * inch, 2.8 * ub);
  // Zoomed out, real spacing can be a pixel or two: draw every Nth bulb so each one still
  // reads as a light (zoom in to see them all).
  const stride = Math.max(1, Math.ceil((shapeKind === 'c9' ? w * 1.5 : w * 1.9) / spacing));
  const step = spacing * stride;
  const net = area && areaStyle(node) === 'net';
  const bulbs = useMemo(
    () => (style === 'plain' && !area ? [] : area ? areaBulbs(shape, step, net ? 'net' : 'wrap') : pointsAlong(shape, step)),
    [shape, step, style, area, net],
  );
  const line = shape.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const b = useMemo(() => bounds(shape), [shape]);
  const cord = node.kind === 'cord';
  const wireW = cord ? Math.max(0.35 * inch, 2.4 * ub) : Math.max(0.28 * inch, 1.3 * ub);
  const sym = shapeKind === 'c9' ? 'bulb-c9' : 'bulb-mini';
  const lit = night ? '-lit' : '';
  const fid = `${node.id}${draft ? '-draft' : ''}`;

  // Label: ID, and the length and bulb count (or bush size) once there is a scale.
  let info = '';
  if (view.feetPerPx && shape.length > 1) {
    if (area) {
      const s = areaSizeFt(placement, view);
      if (s) info = ` · ~${Math.round(s.w)}×${Math.round(s.h)} ft`;
    } else {
      const ft = polylineLength(shape) * view.feetPerPx;
      info = ` · ~${Math.round(ft)} ft${style !== 'plain' ? ` · ${bulbCount(ft, spacingInOf(node))} bulbs` : ''}`;
    }
  }
  const label = `${draft ? 'New' : node.id}${info}`;
  const labelW = (label.length * 7.4 + 12) * u;
  const [lx, ly] = shape[0] ?? [0, 0];
  const lift = shapeKind === 'c9' && !area ? 2.4 * w + (style === 'pathway' ? Math.max(6 * inch, 2.2 * w) : 0) : 0;

  const bulb = (p: Pt, i: number, rot = 0) => {
    const c = colors[i % colors.length];
    const fill = night ? `url(#${grad(c)}-lit)` : c;
    if (shapeKind === 'pixel') return <circle key={i} cx={p[0]} cy={p[1]} r={w / 2} fill={fill} stroke={night ? 'none' : 'rgba(0,0,0,0.45)'} strokeWidth={0.6 * ub} />;
    return <use key={i} href={`#${sym}${lit}`} transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})${rot ? ` rotate(${rot})` : ''} scale(${w.toFixed(2)})`} fill={fill} />;
  };
  const halo = (p: Pt, i: number, up: number) => {
    const c = colors[i % colors.length];
    return <circle key={`h${i}`} cx={p[0]} cy={p[1] - up} r={w * (shapeKind === 'c9' ? 3.2 : 3.6)} fill={`url(#${grad(c)}-halo)`} />;
  };

  // Per-style pieces.
  let body: React.ReactNode = null;
  if (area) {
    const rot = (i: number) => ((i * 53) % 7) * 15 - 45;
    body = (
      <>
        {net ? <NetMesh id={fid} ring={shape} step={step} box={b} wire={wire} width={wireW * 0.8} /> : <polyline points={bulbs.map((p) => p.join(',')).join(' ')} fill="none" stroke={wire} strokeWidth={wireW * 0.8} opacity={0.8} />}
        {night && bulbs.map((p, i) => halo(p, i, w * 0.9))}
        {bulbs.map((p, i) => bulb(p, i, shapeKind === 'mini' ? rot(i) : 0))}
      </>
    );
  } else if (style === 'pathway') {
    const stakeH = Math.max(6 * inch, 2.2 * w);
    body = (
      <>
        {bulbs.map((p, i) => (
          <line key={`s${i}`} x1={p[0]} y1={p[1]} x2={p[0]} y2={p[1] - stakeH} stroke={wire} strokeWidth={Math.max(0.35 * inch, 1.2 * ub)} strokeLinecap="round" />
        ))}
        {night && bulbs.map((p, i) => halo([p[0], p[1] - stakeH], i, w * 1.2))}
        {bulbs.map((p, i) => bulb([p[0], p[1] - stakeH], i))}
      </>
    );
  } else if (style === 'icicle') {
    const unit = Math.max(inch, w / 2.2);
    const drops = bulbs.map((p, i) => {
      const len = DROPS[i % DROPS.length] * unit;
      const n = Math.max(1, Math.round(len / Math.max(3 * inch, 2.2 * w)));
      return { p, len, on: Array.from({ length: n }, (_, k) => [p[0], p[1] + (len * (k + 1)) / n] as Pt) };
    });
    body = (
      <>
        {drops.map((d, i) => (
          <line key={`d${i}`} x1={d.p[0]} y1={d.p[1]} x2={d.p[0]} y2={d.p[1] + d.len} stroke={wire} strokeWidth={wireW * 0.7} />
        ))}
        {night && drops.flatMap((d, i) => d.on.map((q, j) => halo(q, i * 7 + j, -w * 0.9)))}
        {drops.flatMap((d, i) => d.on.map((q, j) => bulb(q, i * 7 + j, 180)))}
      </>
    );
  } else if (style !== 'plain') {
    const rot = (i: number) => (shapeKind === 'mini' ? (((i * 37) % 3) - 1) * 24 : 0);
    body = (
      <>
        {night && bulbs.map((p, i) => halo(p, i, shapeKind === 'c9' ? w * 1.2 : shapeKind === 'pixel' ? 0 : w * 0.9))}
        {bulbs.map((p, i) => bulb(p, i, rot(i)))}
      </>
    );
  }

  const ringD = area && shape.length ? `M${line.replace(/ /g, ' L')} Z` : '';
  const wash = night && style !== 'plain' && shape.length > 1;
  // Several colours blend into a warm white glow; one colour glows in that colour.
  const washColor = colors.length > 1 ? '#fff0cc' : colors[0];
  const pad = 8 * w;

  return (
    <g
      className={`run${area ? ' bush' : ''}${selected ? ' selected' : ''}${dim ? ' dim' : ''}${target ? ' target' : ''}${draft ? ' draft-run' : ''}`}
      style={{ ['--sock' as string]: wire }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      pointerEvents={draft ? 'none' : undefined}
      aria-hidden={draft || undefined}
      aria-label={draft ? undefined : area ? `${node.id} ${node.label} on a bush` : cord ? `${node.id} ${node.label} run` : `${node.id} ${node.label} light run`}
      role={draft ? undefined : 'button'}
    >
      {!draft &&
        (area ? (
          <path d={ringD} fill="transparent" stroke="transparent" strokeWidth={14 * u} onPointerDown={(e) => onDown?.(e)} />
        ) : (
          <polyline points={line} fill="none" stroke="transparent" strokeWidth={22 * u} onPointerDown={(e) => onDown?.(e)} />
        ))}
      <g pointerEvents="none" opacity={draft ? 0.85 : undefined}>
        {wash && (
          <>
            <filter id={`wash-${fid}`} filterUnits="userSpaceOnUse" x={b.x0 - pad} y={b.y0 - pad} width={b.x1 - b.x0 + pad * 2} height={b.y1 - b.y0 + pad * 2}>
              <feGaussianBlur stdDeviation={w * 2.2} />
            </filter>
            {area ? (
              <path d={ringD} fill={washColor} opacity={0.2} filter={`url(#wash-${fid})`} />
            ) : (
              <polyline points={line} fill="none" stroke={washColor} strokeWidth={w * 5} strokeLinecap="round" strokeLinejoin="round" opacity={0.26} filter={`url(#wash-${fid})`} transform={`translate(0 ${-lift / 2})`} />
            )}
          </>
        )}
        {(selected || target) && (area ? <path d={ringD} fill="none" stroke={selected ? '#f59e0b' : '#2563eb'} strokeWidth={3 * u} strokeDasharray={target && !selected ? `${6 * u} ${4 * u}` : undefined} /> : <polyline points={line} fill="none" stroke={selected ? '#f59e0b' : '#2563eb'} strokeWidth={(wireW / u + 5) * u} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} strokeDasharray={target && !selected ? `${6 * u} ${4 * u}` : undefined} />)}
        {area ? (
          <path d={ringD} fill="none" stroke={wire} strokeWidth={wireW * 0.8} opacity={net ? 0.9 : 0.35} />
        ) : (
          <polyline points={line} fill="none" stroke={wire} strokeWidth={wireW} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {style === 'plain' && !area && !cord && <polyline points={line} fill="none" stroke={colors[0]} strokeWidth={5 * u} strokeDasharray={`${2 * u} ${6 * u}`} strokeLinecap="round" />}
        {body}
        <g transform={`translate(${lx} ${ly - 18 * u - lift})`}>
          <rect x={-labelW / 2} y={-12 * u} width={labelW} height={18 * u} rx={5 * u} fill="rgba(255,255,255,0.92)" stroke="#475569" strokeWidth={u} />
          <text y={1.5 * u} fontSize={12 * u} textAnchor="middle" fontWeight={700} fill="#0f172a" fontFamily="ui-monospace, Menlo, monospace">
            {label}
          </text>
        </g>
      </g>
      {editable &&
        placement.kind !== 'point' &&
        placement.points.map((p, i) => {
          const [x, y] = toPx(p, view);
          return (
            <circle
              key={`v${i}`}
              className="vertex"
              cx={x}
              cy={y}
              r={9 * u}
              strokeWidth={2.5 * u}
              onPointerDown={(e) => onDown?.(e, i)}
              aria-label={`Point ${i + 1} of ${node.id}`}
            />
          );
        })}
    </g>
  );
}

/** A female connector on a run: white when open, filled when something is plugged in. */
function Socket(props: { at: Pt; u: number; open: boolean; hot: boolean; label: string; onDown: (e: RPointerEvent) => void; onMove: (e: RPointerEvent) => void; onUp: (e: RPointerEvent) => void }) {
  const { at, u, open, hot, label } = props;
  const w = 15 * u;
  const h = 10 * u;
  return (
    <g className={`socket${open ? ' open' : ''}${hot ? ' hot' : ''}`} transform={`translate(${at[0]} ${at[1]})`} role="button" aria-label={label} onPointerDown={props.onDown} onPointerMove={props.onMove} onPointerUp={props.onUp}>
      <circle r={16 * u} fill="transparent" />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3 * u} fill={open ? '#ffffff' : '#1f4d2b'} stroke={hot ? '#2563eb' : '#0f172a'} strokeWidth={(hot ? 2.5 : 1.5) * u} />
      <line x1={-2.6 * u} y1={-2.4 * u} x2={-2.6 * u} y2={2.4 * u} stroke={open ? '#0f172a' : '#ffffff'} strokeWidth={1.5 * u} strokeLinecap="round" />
      <line x1={2.6 * u} y1={-2.4 * u} x2={2.6 * u} y2={2.4 * u} stroke={open ? '#0f172a' : '#ffffff'} strokeWidth={1.5 * u} strokeLinecap="round" />
    </g>
  );
}

/** The diamond mesh of net lights, clipped to the bush outline. */
function NetMesh({ id, ring, step, box, wire, width }: { id: string; ring: Pt[]; step: number; box: ReturnType<typeof bounds>; wire: string; width: number }) {
  const h = step / Math.SQRT2;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const segs: string[] = [];
  const x0 = box.x0 - step;
  const x1 = box.x1 + step;
  // Lines x - y = c and x + y = c through the lattice nodes, 2h apart.
  for (const dir of [1, -1]) {
    const c0 = dir === 1 ? cx - cy : cx + cy;
    const lo = dir === 1 ? box.x0 - box.y1 : box.x0 + box.y0;
    const hi = dir === 1 ? box.x1 - box.y0 : box.x1 + box.y1;
    for (let m = Math.floor((lo - c0) / (2 * h)) - 1; m <= Math.ceil((hi - c0) / (2 * h)) + 1; m++) {
      const c = c0 + 2 * m * h;
      const ya = dir === 1 ? x0 - c : c - x0;
      const yb = dir === 1 ? x1 - c : c - x1;
      segs.push(`M${x0.toFixed(1)},${ya.toFixed(1)} L${x1.toFixed(1)},${yb.toFixed(1)}`);
    }
  }
  const clip = `net-${id}`;
  return (
    <>
      <clipPath id={clip}>
        <path d={`M${ring.map((p) => p.join(',')).join(' L')} Z`} />
      </clipPath>
      <path d={segs.join(' ')} clipPath={`url(#${clip})`} fill="none" stroke={wire} strokeWidth={width} opacity={0.85} />
    </>
  );
}
