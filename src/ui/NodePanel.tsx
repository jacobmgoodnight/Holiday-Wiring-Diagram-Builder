import { toneOf } from '../diagram/layout';
import type { NodePatch } from '../model/actions';
import type { DisplayNode, NodeKind, Status } from '../model/types';
import { NODE_KINDS, STATUSES } from '../model/types';

const KIND_NAMES: Record<NodeKind, string> = {
  outlet: 'Outlet',
  smartplug: 'Smart plug / timer',
  cord: 'Cord',
  splitter: 'Splitter / strip / stake',
  controller: 'Controller / power supply',
  enclosure: 'Tote / enclosure',
  load: 'Load',
};

interface Props {
  node: DisplayNode;
  /** Number of items plugged in below this one (for the delete button). */
  below: number;
  plugged: boolean;
  onPatch: (patch: NodePatch) => void;
  onKind: (kind: NodeKind) => void;
  onAddChild: () => void;
  onMove: () => void;
  onUnplug: () => void;
  onDelete: (withChildren: boolean) => void;
  onClose: () => void;
}

/** Text/number input that commits on blur or Enter; re-keyed when the stored value changes. */
function Field(props: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  type?: 'text' | 'number';
  wide?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const { label, value, onCommit, type = 'text', wide, placeholder, multiline } = props;
  const commit = (v: string) => v !== value && onCommit(v);
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea key={value} defaultValue={value} placeholder={placeholder} rows={2} onBlur={(e) => commit(e.target.value)} />
      ) : (
        <input
          key={value}
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
      )}
    </label>
  );
}

const numOrUndef = (v: string): number | undefined | null => {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null; // null = invalid, ignore
};

export function NodePanel({ node, below, plugged, onPatch, onKind, onAddChild, onMove, onUnplug, onDelete, onClose }: Props) {
  const num = (key: 'qty' | 'watts' | 'amps' | 'lengthFt' | 'outputs') => (v: string) => {
    const n = numOrUndef(v);
    if (n !== null) onPatch({ [key]: key === 'qty' || key === 'outputs' ? (n === undefined ? undefined : Math.round(n)) : n });
  };
  const str = (v: number | undefined) => (v === undefined ? '' : String(v));
  const isLoad = node.kind === 'load';
  const hasSockets = node.kind !== 'load' && node.kind !== 'outlet';

  return (
    <section className="panel" aria-label={`Details for ${node.id}`}>
      <div className="panel-head">
        <span className={`badge tone-${toneOf(node)}`}>{node.id}</span>
        <select aria-label="Kind" value={node.kind} onChange={(e) => onKind(e.target.value as NodeKind)}>
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_NAMES[k]}
            </option>
          ))}
        </select>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </div>

      <div className="fields">
        <Field label="Name" value={node.label} wide onCommit={(v) => onPatch({ label: v.replace(/[[\]]/g, '').trim() })} />
        {isLoad && <Field label="Qty" type="number" value={str(node.qty)} onCommit={num('qty')} />}
        <Field label={node.wattsApprox ? 'Watts (est.)' : 'Watts'} type="number" value={str(node.watts)} onCommit={num('watts')} />
        {node.watts !== undefined && (
          <label className="check">
            <input type="checkbox" checked={!!node.wattsApprox} onChange={(e) => onPatch({ wattsApprox: e.target.checked || undefined })} />
            estimate
          </label>
        )}
        {(node.kind === 'cord' || isLoad) && <Field label="Length ft" type="number" value={str(node.lengthFt)} onCommit={num('lengthFt')} />}
        {hasSockets && <Field label="Sockets" type="number" value={str(node.outputs)} placeholder="?" onCommit={num('outputs')} />}
        {node.kind === 'outlet' && (
          <>
            <label className="field">
              <span>Breaker</span>
              <select value={str(node.breakerAmps)} onChange={(e) => onPatch({ breakerAmps: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">15A (default)</option>
                <option value="15">15A</option>
                <option value="20">20A</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!node.gfci} onChange={(e) => onPatch({ gfci: e.target.checked || undefined })} />
              GFCI
            </label>
          </>
        )}
      </div>

      <div className="status" role="group" aria-label="Status">
        {STATUSES.map((s: Status) => (
          <button key={s} type="button" className={node.status === s ? 'on' : ''} aria-pressed={node.status === s} onClick={() => onPatch({ status: s })}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={!!node.isNew} onChange={(e) => onPatch({ isNew: e.target.checked || undefined })} />
          New this year
        </label>
      </div>

      <details className="more">
        <summary>Tags and notes</summary>
        <div className="fields">
          <Field
            label="Tags (comma separated)"
            wide
            value={node.tags.join(', ')}
            placeholder="roofline, porch"
            onCommit={(v) =>
              onPatch({
                tags: [...new Set(v.split(',').map((t) => t.replace(/[[\]]/g, '').trim().toLowerCase()).filter(Boolean))],
              })
            }
          />
          <Field label="Notes (not in the outline)" wide multiline value={node.notes ?? ''} onCommit={(v) => onPatch({ notes: v.trim() || undefined })} />
        </div>
      </details>

      <div className="panel-actions">
        <button type="button" className="primary" onClick={onAddChild}>
          + Plug something in
        </button>
        <button type="button" onClick={onMove}>
          Move…
        </button>
        {plugged && (
          <button type="button" onClick={onUnplug}>
            Unplug
          </button>
        )}
        <button type="button" className="danger" onClick={() => onDelete(false)}>
          Delete
        </button>
        {below > 0 && (
          <button type="button" className="danger" onClick={() => onDelete(true)}>
            Delete with {below} below
          </button>
        )}
      </div>
    </section>
  );
}
