import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeChangeset,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Target } from '../model/actions';
import type { Cluster, Layout, LayoutNode } from './layout';

type ItemNode = Node<{ ln: LayoutNode; selected: boolean }, 'item'>;
type ClusterNode = Node<{ cluster: Cluster }, 'cluster'>;
type WireEdge = Edge<{ label?: string; signal: boolean; reference: boolean }, 'wire'>;

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

/** The socket or item a layout node stands for when something is plugged into it. */
export function targetOf(ln: LayoutNode): Target | undefined {
  if (ln.type === 'ghost') return ln.parentId ? { parent: ln.parentId, port: ln.port } : undefined;
  return ln.nodeId ? { parent: ln.nodeId } : undefined;
}

interface Ctx {
  onAdd: (target: Target, ln: LayoutNode) => void;
  moving: boolean;
  blocked: Set<string>;
  dropTarget?: string;
}
const DiagramCtx = createContext<Ctx>({ onAdd: () => undefined, moving: false, blocked: new Set() });

const isBlocked = (ln: LayoutNode, blocked: Set<string>) => (ln.nodeId ? blocked.has(ln.nodeId) : !!ln.parentId && blocked.has(ln.parentId));

const ItemView = memo(function ItemView({ data }: NodeProps<ItemNode>) {
  const { ln, selected } = data;
  const { onAdd, moving, blocked, dropTarget } = useContext(DiagramCtx);
  const id = ln.nodeId;
  const ghost = ln.type === 'ghost';
  const cls = [
    'dn',
    `tone-${ln.tone}`,
    ghost && 'ghost',
    selected && 'selected',
    moving && (isBlocked(ln, blocked) ? 'blocked' : 'target'),
    dropTarget === ln.id && 'drop',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={{ width: ln.w, height: ln.h }}>
      <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      {ghost ? (
        <div className="dn-line">
          <span className="ghost-plus" aria-hidden="true">
            +
          </span>{' '}
          Unused socket
        </div>
      ) : (
        ln.lines.map((line, i) =>
          i === 0 && id && line.startsWith(id) ? (
            <div key={i} className="dn-line">
              <b className="dn-id">{id}</b>
              {line.slice(id.length)}
            </div>
          ) : (
            <div key={i} className="dn-line">
              {line}
            </div>
          ),
        )
      )}
      {ln.meta && <div className="dn-meta">{ln.meta}</div>}
      {!ghost && !moving && id && (
        <button
          type="button"
          className="dn-add nodrag"
          aria-label={`Plug something into ${id}`}
          onClick={(e) => {
            e.stopPropagation();
            onAdd({ parent: id }, ln);
          }}
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Right} style={hidden} isConnectable={false} />
    </div>
  );
});

function ClusterView({ data }: NodeProps<ClusterNode>) {
  const c = data.cluster;
  return (
    <div className="cluster" style={{ width: c.w + 12, height: c.h }}>
      <div className="cluster-title">{c.title}</div>
    </div>
  );
}

function WireView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<WireEdge>) {
  let path: string;
  let lx: number;
  let ly: number;
  if (data?.reference || targetX <= sourceX + 8) {
    [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: Position.Right, targetPosition: Position.Left });
  } else {
    // Orthogonal wire that bends near the child, so socket labels sit next to each child.
    const bend = Math.max(sourceX + 14, targetX - 30);
    path = `M${sourceX},${sourceY} H${bend} V${targetY} H${targetX}`;
    lx = targetX - 15;
    ly = targetY;
  }
  return (
    <>
      <BaseEdge id={id} path={path} className={data?.signal ? 'wire signal' : 'wire'} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div className={`wire-label${data.signal ? ' signal' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { item: ItemView, cluster: ClusterView };
const edgeTypes = { wire: WireView };

export interface DiagramProps {
  layout: Layout;
  selectedId?: string;
  onSelect: (nodeId: string | undefined) => void;
  /** Changes when the view should be refitted (view switch, display switch). */
  fitKey: string;
  /** Changes when the diagram should bring the selected item into view. */
  centerRequest?: number;
  /** Open the preset picker for a socket or item (parent null = top level). */
  onAdd: (target: Target) => void;
  /** Re-plug an item (drag on desktop, or Move… mode). */
  onReplug: (nodeId: string, target: Target) => void;
  /** Item being moved with Move… (tap a target to finish). */
  movingId?: string;
  onCancelMove: () => void;
  /** Items that cannot be targets for a given moving item (itself and what is plugged into it). */
  subtreeOf: (nodeId: string) => Set<string>;
  /** Desktop: drop a preset from the palette onto the diagram. */
  onDropPreset: (presetId: string, target: Target) => void;
  /** Allow mouse dragging to re-plug (fine pointers only). */
  canDrag: boolean;
  undo: { can: boolean; run: () => void };
  redo: { can: boolean; run: () => void };
  onExportSvg: () => void;
  onExportPng: () => void;
}

export function Diagram(props: DiagramProps) {
  return (
    <ReactFlowProvider>
      <DiagramInner {...props} />
    </ReactFlowProvider>
  );
}

/** Smallest zoom used by Fit: never shrink a wide display into unreadable boxes. */
const READABLE_ZOOM = 0.9;
/** Gap plus an unused-socket box: the column right of an item. */
const NEXT_COLUMN = 64 + 128 + 16;
export const PRESET_MIME = 'application/x-wiring-preset';

function DiagramInner(props: DiagramProps) {
  const { layout, selectedId, onSelect, fitKey, centerRequest, movingId, subtreeOf, canDrag } = props;
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | undefined>();
  const [dragBlocked, setDragBlocked] = useState<Set<string>>(new Set());

  const blocked = useMemo(() => (movingId ? subtreeOf(movingId) : dragBlocked), [movingId, subtreeOf, dragBlocked]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const nodes = useMemo<(ItemNode | ClusterNode)[]>(
    () => [
      ...layout.clusters.map<ClusterNode>((c) => ({
        id: `cluster:${c.id}`,
        type: 'cluster',
        position: { x: c.x - 6, y: c.y },
        data: { cluster: c },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
      })),
      ...layout.nodes.map<ItemNode>((ln) => ({
        id: ln.id,
        type: 'item',
        position: drag?.id === ln.id ? { x: drag.x, y: drag.y } : { x: ln.x, y: ln.y },
        data: { ln, selected: !!ln.nodeId && ln.nodeId === selectedId },
        draggable: canDrag && ln.type === 'item',
        width: ln.w,
        height: ln.h,
        zIndex: drag?.id === ln.id ? 10 : 0,
        ariaLabel: ln.type === 'ghost' ? `Unused socket${ln.port ? ` ${ln.port}` : ''} on ${ln.parentId}: add an item` : ln.lines.join(' '),
      })),
    ],
    [layout, selectedId, drag, canDrag],
  );

  const edges = useMemo<WireEdge[]>(
    () =>
      layout.edges.map((e) => ({
        id: e.id,
        type: 'wire',
        source: e.source,
        target: e.target,
        selectable: false,
        focusable: false,
        data: { label: e.label, signal: e.kind === 'signal', reference: !!e.reference },
      })),
    [layout],
  );

  const fitReadable = () => {
    const el = box.current;
    if (!el || !layout.nodes.length) return;
    const pad = 16;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const w = layout.width + 24;
    const h = layout.height;
    const zoom = Math.min(1.1, Math.max(READABLE_ZOOM, Math.min((cw - pad * 2) / w, (ch - pad * 2) / h)));
    const x = w * zoom <= cw - pad * 2 ? (cw - w * zoom) / 2 + 6 * zoom : pad + 6 * zoom;
    let y = (ch - h * zoom) / 2;
    if (h * zoom > ch - pad * 2) {
      // Too tall to fit readably: start with the first outlet in view, never above the top.
      const first = layout.clusters[0];
      const inFirst = layout.nodes.filter((m) => m.cluster === first.id);
      const minX = Math.min(...inFirst.map((m) => m.x));
      const root = inFirst.find((n) => n.x === minX);
      const anchor = root ? root.y + root.h / 2 : 0;
      y = Math.min(pad, ch / 2 - anchor * zoom);
      y = Math.max(y, ch - pad - h * zoom);
    }
    rf.setViewport({ x, y, zoom }, { duration: 0 });
  };

  useEffect(() => {
    // Wait a frame so the container has its final size.
    const id = requestAnimationFrame(fitReadable);
    return () => cancelAnimationFrame(id);
  }, [fitKey]);

  useEffect(() => {
    if (centerRequest === undefined || !selectedId) return;
    // Wait for the new layout to render (an item may just have been added).
    const id = requestAnimationFrame(() => {
      const ln = layout.nodes.find((n) => n.nodeId === selectedId);
      const el = box.current;
      if (!ln || !el) return;
      const { x, y, zoom } = rf.getViewport();
      // Keep the item and the column to its right (its free sockets) in view, so the next
      // tap is usually already on screen. Instant, so a quick next tap never hits a moving target.
      const span = ln.w + NEXT_COLUMN;
      const left = ln.x * zoom + x;
      const top = ln.y * zoom + y;
      const inView = left >= 0 && top >= 40 && left + span * zoom <= el.clientWidth && top + ln.h * zoom <= el.clientHeight;
      if (!inView) {
        // Zoom out just enough to show the next column too, but never below readable.
        const fitSpan = (el.clientWidth - 24) / span;
        const z = Math.max(READABLE_ZOOM, Math.min(zoom, fitSpan));
        const cx = span * z <= el.clientWidth ? ln.x + span / 2 : ln.x + ln.w / 2;
        rf.setCenter(cx, ln.y + ln.h / 2, { zoom: z, duration: 0 });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [centerRequest]);

  /** The item or socket under a flow-space point. */
  const hit = (x: number, y: number, exclude?: string): LayoutNode | undefined =>
    layout.nodes.find((n) => n.id !== exclude && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);

  // Only dragging moves a node on screen, and only until it is dropped (layout owns positions).
  const onNodesChange = (changes: NodeChangeset<ItemNode | ClusterNode>) => {
    for (const c of changes.getByType('position')) {
      if (c.position && c.dragging) setDrag({ id: c.id, x: c.position.x, y: c.position.y });
    }
  };

  const ctx = useMemo<Ctx>(
    () => ({ onAdd: (t) => props.onAdd(t), moving: !!movingId || !!drag, blocked, dropTarget }),
    [props.onAdd, movingId, drag, blocked, dropTarget],
  );

  return (
    <DiagramCtx.Provider value={ctx}>
      <div
        className={`diagram${movingId ? ' moving' : ''}`}
        ref={box}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PRESET_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          setDropTarget(hit(p.x, p.y)?.id);
        }}
        onDragLeave={() => setDropTarget(undefined)}
        onDrop={(e) => {
          const presetId = e.dataTransfer.getData(PRESET_MIME);
          setDropTarget(undefined);
          if (!presetId) return;
          e.preventDefault();
          // Prefer the target highlighted during drag-over (what the user saw).
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const ln = (dropTarget ? byId.get(dropTarget) : undefined) ?? hit(p.x, p.y);
          props.onDropPreset(presetId, (ln && targetOf(ln)) ?? { parent: null });
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          elementsSelectable={false}
          nodeDragThreshold={6}
          minZoom={0.15}
          maxZoom={2.5}
          onNodeDragStart={(_, n) => {
            const ln = byId.get(n.id);
            if (ln?.nodeId) setDragBlocked(subtreeOf(ln.nodeId));
          }}
          onNodeDrag={(e, n) => {
            // The target is whatever is under the pointer, not under the dragged box.
            const pt = 'clientX' in e ? { x: e.clientX, y: e.clientY } : undefined;
            if (!pt) return;
            const p = rf.screenToFlowPosition(pt);
            const over = hit(p.x, p.y, n.id);
            setDropTarget(over && !isBlocked(over, dragBlocked) ? over.id : undefined);
          }}
          onNodeDragStop={(_, n) => {
            const ln = byId.get(n.id);
            const over = dropTarget ? byId.get(dropTarget) : undefined;
            const target = over && targetOf(over);
            setDrag(null);
            setDropTarget(undefined);
            setDragBlocked(new Set());
            if (ln?.nodeId && target) props.onReplug(ln.nodeId, target);
          }}
          onNodeClick={(_, n) => {
            if (n.type !== 'item') return;
            const ln = (n as ItemNode).data.ln;
            if (movingId) {
              const target = targetOf(ln);
              if (target && !isBlocked(ln, blocked)) props.onReplug(movingId, target);
              return;
            }
            if (ln.type === 'ghost') {
              const target = targetOf(ln);
              if (target) props.onAdd(target);
              return;
            }
            onSelect(ln.nodeId);
          }}
          onPaneClick={() => (movingId ? undefined : onSelect(undefined))}
          proOptions={{ hideAttribution: false }}
        >
          <Panel position="top-right" className="dg-tools">
            <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!props.undo.can} onClick={props.undo.run}>
              ↶
            </button>
            <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!props.redo.can} onClick={props.redo.run}>
              ↷
            </button>
            <button type="button" className="primary" onClick={() => props.onAdd({ parent: null })}>
              + Outlet
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 120 })}>
              ⊖
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 120 })}>
              ⊕
            </button>
            <button type="button" onClick={fitReadable}>
              Fit
            </button>
            <details className="export">
              <summary aria-label="Export">⤓</summary>
              <div className="export-menu">
                <button type="button" onClick={props.onExportSvg}>
                  SVG
                </button>
                <button type="button" onClick={props.onExportPng}>
                  PNG
                </button>
              </div>
            </details>
          </Panel>
          {movingId && (
            <Panel position="bottom-center" className="move-banner" role="status">
              Tap the socket or item to plug <b>{movingId}</b> into.
              <button type="button" onClick={props.onCancelMove}>
                Cancel
              </button>
            </Panel>
          )}
          {!layout.nodes.length && (
            <Panel position="top-left" className="dg-empty">
              Tap <b>+ Outlet</b>, or type an outline: start with an outlet, then indent what plugs into it.
            </Panel>
          )}
        </ReactFlow>
      </div>
    </DiagramCtx.Provider>
  );
}
