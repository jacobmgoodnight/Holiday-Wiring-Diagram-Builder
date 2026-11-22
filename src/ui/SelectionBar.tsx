import type { ReactNode } from 'react';
import { toneOf } from '../diagram/layout';
import type { DisplayNode } from '../model/types';

interface Props {
  node: DisplayNode;
  /** What it plugs into (for "+ Into K01"); undefined for top-level items. */
  parentId?: string;
  /** Number of items plugged in below it (for Fold). */
  below: number;
  folded: boolean;
  /** Phone: the details sheet is open. */
  detailsOpen?: boolean;
  /** Phone only: show a Details button. */
  onDetails?: () => void;
  onPlugIn: () => void;
  onAddBeside: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onMove: () => void;
  onFold: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Extra actions for the current view (photo placement). */
  extra?: ReactNode;
}

/**
 * Actions for the selected item, mind-map style: plug something in, add another next to it,
 * duplicate, rename, move, fold, delete. One tap each; every one can be undone.
 */
export function SelectionBar(p: Props) {
  const n = p.node;
  return (
    <section className="selbar" aria-label={`Selected ${n.id}`}>
      <div className="selbar-head">
        <span className={`badge tone-${toneOf(n)}`}>{n.id}</span>
        <button type="button" className="selbar-name" onClick={p.onRename} title="Rename">
          {n.label || <em>(no name)</em>}
        </button>
        {p.onDetails && (
          <button type="button" className="selbar-details" aria-expanded={!!p.detailsOpen} onClick={p.onDetails}>
            Details
          </button>
        )}
        <button type="button" className="selbar-close" onClick={p.onClose} aria-label="Deselect">
          ✕
        </button>
      </div>
      <div className="selbar-actions">
        <button type="button" className="primary" onClick={p.onPlugIn} title="Plug something into it (Tab)">
          + Plug in
        </button>
        {p.parentId && (
          <button type="button" onClick={p.onAddBeside} title={`Plug another item into ${p.parentId} (Enter)`}>
            + Into {p.parentId}
          </button>
        )}
        <button type="button" onClick={p.onDuplicate} title="Another one of the same (Ctrl/⌘+D)">
          Duplicate
        </button>
        <button type="button" onClick={p.onRename} title="Rename (F2 or double-click)">
          Rename
        </button>
        <button type="button" onClick={p.onMove} title="Plug it in somewhere else">
          Move…
        </button>
        {(p.below > 0 || p.folded) && (
          <button type="button" aria-pressed={p.folded} onClick={p.onFold} title="Fold or unfold what is plugged into it (Space)">
            {p.folded ? `Unfold (${p.below})` : 'Fold'}
          </button>
        )}
        <button type="button" className="danger" onClick={p.onDelete} title="Delete (Del). Things plugged into it stay, unplugged.">
          Delete
        </button>
      </div>
      {p.extra && <div className="selbar-actions">{p.extra}</div>}
    </section>
  );
}
