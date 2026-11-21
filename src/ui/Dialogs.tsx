import { useEffect, useState } from 'react';
import type { Change } from '../model/season';
import type { Snapshot } from '../store/db';
import { Sheet } from './Sheet';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const REASON: Record<Snapshot['reason'], string> = { auto: 'Automatic', manual: 'Saved by you', 'before-restore': 'Before a restore' };

export function RestoreDialog(props: {
  load: () => Promise<Snapshot[]>;
  onSaveNow: () => Promise<void>;
  onRestore: (s: Snapshot) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<Snapshot[] | null>(null);
  const refresh = () => void props.load().then(setList);
  useEffect(refresh, []);
  return (
    <Sheet title="Restore points" onClose={props.onClose}>
      <p className="muted small">
        Complete copies of this display, kept on this device only. Saved automatically every 10 minutes while you edit
        (the newest 20 are kept) and whenever you ask. Restoring can be undone.
      </p>
      <button type="button" className="primary" onClick={() => void props.onSaveNow().then(refresh)}>
        Save a restore point now
      </button>
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">No restore points yet.</p>
      ) : (
        <ul className="snap-list">
          {list.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{when(s.at)}</strong>
                <span className="muted small">
                  {' '}
                  · {REASON[s.reason]} · {s.title} · {s.itemCount} items
                </span>
              </div>
              <button type="button" onClick={() => props.onRestore(s)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function CopyDialog(props: { from: string; suggested: string; onCopy: (title: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(props.suggested);
  return (
    <Sheet title="Copy for next year" onClose={props.onClose}>
      <p className="small">
        Makes a new display from <strong>{props.from}</strong> with the same items, IDs and wiring. Every item goes back
        to <em>planned</em>; “new” and “packed” are cleared; notes and storage spots are kept. Retired items are kept
        (grey) so nothing is rewired for you. Items you add to the copy are marked new. The original is not changed.
      </p>
      <label className="field wide">
        <span>Name</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="primary" disabled={!title.trim()} onClick={() => props.onCopy(title.trim())}>
          Make the copy
        </button>
      </div>
    </Sheet>
  );
}

const KIND_TITLE: Record<Change['kind'], string> = { added: 'Added', moved: 'Plugged in somewhere else', renamed: 'Renamed', removed: 'Removed' };

export function ChangesDialog(props: { source: string | null; changes: Change[] | null; onShow: (id: string) => void; onClose: () => void }) {
  const { source, changes } = props;
  return (
    <Sheet title={source ? `Changes since ${source}` : 'Changes'} onClose={props.onClose}>
      {changes === null ? (
        <p className="muted">The display this was copied from is no longer on this device.</p>
      ) : changes.length === 0 ? (
        <p className="muted">No changes yet: same items, same sockets.</p>
      ) : (
        (['added', 'moved', 'renamed', 'removed'] as const).map((k) => {
          const items = changes.filter((c) => c.kind === k);
          if (!items.length) return null;
          return (
            <section key={k}>
              <h3>
                {KIND_TITLE[k]} ({items.length})
              </h3>
              <ul className="change-list">
                {items.map((c) => (
                  <li key={`${k}-${c.id}`}>
                    {k === 'removed' ? (
                      <b className="dn-id">{c.id}</b>
                    ) : (
                      <button type="button" className="link" onClick={() => props.onShow(c.id)}>
                        {c.id}
                      </button>
                    )}{' '}
                    {k === 'renamed' ? (
                      <>
                        {c.from} → {c.to}
                      </>
                    ) : (
                      <>
                        {c.label}
                        <span className="muted small">
                          {k === 'added' && ` · into ${c.to}`}
                          {k === 'moved' && ` · ${c.from} → ${c.to}`}
                          {k === 'removed' && ` · was in ${c.from}`}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Sheet>
  );
}
