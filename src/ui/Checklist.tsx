import type { ChecklistGroup, ChecklistMode, ChecklistRow } from '../model/checklist';

interface Props {
  groups: ChecklistGroup[];
  mode: ChecklistMode;
  onMode: (m: ChecklistMode) => void;
  hideDone: boolean;
  onHideDone: (v: boolean) => void;
  onToggle: (row: ChecklistRow) => void;
  onVerify: (row: ChecklistRow) => void;
  onShow: (id: string) => void;
  onResetPacked: () => void;
}

/** Field mode: one big-target checklist per outlet. Uses the same plan as the diagram. */
export function Checklist({ groups, mode, onMode, hideDone, onHideDone, onToggle, onVerify, onShow, onResetPacked }: Props) {
  const done = groups.reduce((n, g) => n + g.done, 0);
  const total = groups.reduce((n, g) => n + g.total, 0);
  return (
    <div className="checklist">
      <div className="cl-bar">
        <div className="seg" role="group" aria-label="Checklist">
          <button type="button" aria-pressed={mode === 'install'} className={mode === 'install' ? 'on' : ''} onClick={() => onMode('install')}>
            Install
          </button>
          <button type="button" aria-pressed={mode === 'teardown'} className={mode === 'teardown' ? 'on' : ''} onClick={() => onMode('teardown')}>
            Teardown
          </button>
        </div>
        <span className="cl-total" role="status">
          {done} of {total} {mode === 'install' ? 'installed' : 'packed'}
        </span>
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => onHideDone(e.target.checked)} />
          Hide done
        </label>
        {mode === 'teardown' && done > 0 && (
          <button type="button" onClick={onResetPacked}>
            Clear packed
          </button>
        )}
      </div>
      <p className="muted small cl-help">
        {mode === 'install'
          ? 'From the wall outwards. Ticking marks an item installed; Verified is for after you have checked it.'
          : 'From the far end back to the wall. Ticking marks an item packed; the storage spot tells you where it goes.'}
      </p>
      {groups.map((g) => {
        const rows = hideDone ? g.rows.filter((r) => !r.done) : g.rows;
        return (
          <section key={g.id} className="cl-group" aria-label={g.title}>
            <h3>
              <span>{g.title}</span>
              <span className="cl-count">
                {g.done}/{g.total}
              </span>
            </h3>
            <div className="cl-progress" aria-hidden="true">
              <div style={{ width: `${g.total ? (100 * g.done) / g.total : 0}%` }} />
            </div>
            {rows.length === 0 && <p className="muted small">All done.</p>}
            <ul>
              {rows.map((r) => (
                <li key={r.id} className={`cl-row${r.done ? ' done' : ''}${r.retired ? ' retired' : ''}`} style={{ paddingLeft: `${Math.min(r.depth, 6) * 14 + 4}px` }}>
                  <label className="cl-check">
                    <input type="checkbox" checked={r.done} onChange={() => onToggle(r)} aria-label={`${r.id} ${r.label}: ${mode === 'install' ? 'installed' : 'packed'}`} />
                    <span className="cl-text">
                      <b className="dn-id">{r.id}</b> {r.label || <em>(no name)</em>}
                      {r.isNew && <span className="pill new">new</span>}
                      {r.retired && <span className="pill">retired</span>}
                      <span className="cl-sub">
                        {r.into ? (r.signal ? `${r.signal.toUpperCase()} from ${r.into}` : `plugs into ${r.into}`) : r.kind === 'outlet' ? 'outlet' : 'not plugged in'}
                        {mode === 'teardown' && (r.storage ? ` · store in ${r.storage}` : ' · no storage spot yet')}
                      </span>
                    </span>
                  </label>
                  {mode === 'install' && (
                    <button type="button" className={`cl-verify${r.status === 'verified' ? ' on' : ''}`} aria-pressed={r.status === 'verified'} aria-label={`Verified: ${r.id}`} onClick={() => onVerify(r)}>
                      Verified
                    </button>
                  )}
                  <button type="button" className="cl-show" onClick={() => onShow(r.id)} aria-label={`Show ${r.id} on the diagram`}>
                    ⌖
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
