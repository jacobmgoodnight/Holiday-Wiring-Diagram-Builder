import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Cluster, Layout, LayoutNode } from './layout';

type ItemNode = Node<{ ln: LayoutNode; selected: boolean }, 'item'>;
type ClusterNode = Node<{ cluster: Cluster }, 'cluster'>;
type WireEdge = Edge<{ label?: string; signal: boolean; reference: boolean }, 'wire'>;

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const ItemView = memo(function ItemView({ data }: NodeProps<ItemNode>) {
  const { ln, selected } = data;
  const id = ln.nodeId;
  return (
    <div className={`dn tone-${ln.tone}${ln.type === 'ghost' ? ' ghost' : ''}${selected ? ' selected' : ''}`} style={{ width: ln.w, height: ln.h }}>
      <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      {ln.lines.map((line, i) =>
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
      )}
      {ln.meta && <div className="dn-meta">{ln.meta}</div>}
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

function DiagramInner({ layout, selectedId, onSelect, fitKey, centerRequest, onExportSvg, onExportPng }: DiagramProps) {
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);

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
        position: { x: ln.x, y: ln.y },
        data: { ln, selected: !!ln.nodeId && ln.nodeId === selectedId },
        draggable: false,
        width: ln.w,
        height: ln.h,
        ariaLabel: ln.lines.join(' '),
      })),
    ],
    [layout, selectedId],
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
      const root = layout.nodes.find((n) => n.cluster === first.id && n.x === Math.min(...layout.nodes.filter((m) => m.cluster === first.id).map((m) => m.x)));
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
    const ln = layout.nodes.find((n) => n.nodeId === selectedId);
    const el = box.current;
    if (!ln || !el) return;
    const { x, y, zoom } = rf.getViewport();
    const left = ln.x * zoom + x;
    const top = ln.y * zoom + y;
    const inView = left >= 0 && top >= 0 && left + ln.w * zoom <= el.clientWidth && top + ln.h * zoom <= el.clientHeight;
    if (!inView) rf.setCenter(ln.x + ln.w / 2, ln.y + ln.h / 2, { zoom: Math.max(zoom, READABLE_ZOOM), duration: 200 });
  }, [centerRequest]);

  return (
    <div className="diagram" ref={box}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.15}
        maxZoom={2.5}
        onNodeClick={(_, n) => {
          if (n.type !== 'item') return;
          const ln = (n as ItemNode).data.ln;
          onSelect(ln.nodeId ?? ln.parentId);
        }}
        onPaneClick={() => onSelect(undefined)}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-right" className="dg-tools">
          <button type="button" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 120 })}>
            −
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 120 })}>
            +
          </button>
          <button type="button" onClick={fitReadable}>
            Fit
          </button>
          <button type="button" onClick={onExportSvg} title="Download SVG">
            SVG
          </button>
          <button type="button" onClick={onExportPng} title="Download PNG">
            PNG
          </button>
        </Panel>
        {!layout.nodes.length && (
          <Panel position="top-left" className="dg-empty">
            Type an outline to see the diagram. Start with an outlet, then indent what plugs into it.
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
