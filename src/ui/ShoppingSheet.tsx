import { useMemo, useState } from 'react';
import { toCsv } from '../export/csv';
import { takeoff, takeoffRows, takeoffText } from '../export/takeoff';
import type { Display } from '../model/types';
import { Sheet } from './Sheet';

interface Props {
  display: Display;
  onDownloadCsv: (csv: string) => void;
  /** Jump to an item (select it). */
  onPick?: (id: string) => void;
  onClose: () => void;
}

/** What to buy: feet of lights, bulbs, zip cord and females, cords by length, gear, props. */
export function ShoppingSheet({ display, onDownloadCsv, onPick, onClose }: Props) {
  const [onlyNew, setOnlyNew] = useState(false);
  const [copied, setCopied] = useState(false);
  const sections = useMemo(() => takeoff(display, { onlyNew }), [display, onlyNew]);
  const text = takeoffText(display.title, sections);

  return (
    <Sheet title="Shopping list" onClose={onClose} className="shopping-sheet">
      <div className="shopping-opts">
        <label className="check">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Only items marked “New this year”
        </label>
      </div>
      {sections.length ? (
        sections.map((s) => (
          <section key={s.title} className="shopping-section" aria-label={s.title}>
            <h3>{s.title}</h3>
            <ul>
              {s.lines.map((l) => (
                <li key={l.item}>
                  <div className="sl-row">
                    <span className="sl-item">{l.item}</span>
                    <b className="sl-qty">{l.qty}</b>
                  </div>
                  {l.detail && <div className="sl-detail">{l.detail}</div>}
                  <div className="sl-ids">
                    {l.ids.map((id) =>
                      onPick ? (
                        <button key={id} type="button" className="dn-id link" onClick={() => onPick(id)}>
                          {id}
                        </button>
                      ) : (
                        <span key={id} className="dn-id">
                          {id}
                        </span>
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="muted">{onlyNew ? 'Nothing is marked “New this year”.' : 'Nothing to list yet: add lights and cords to the plan or the photo.'}</p>
      )}
      <p className="muted small">
        Feet come from each item’s length, or from the photo once it is measured (~). Photo lengths are estimates: measure
        before you buy.
      </p>
      <div className="row confirm-row">
        <button
          type="button"
          disabled={!sections.length}
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'Copied' : 'Copy as text'}
        </button>
        <button type="button" disabled={!sections.length} onClick={() => onDownloadCsv(toCsv(takeoffRows(sections)))}>
          Download CSV
        </button>
      </div>
    </Sheet>
  );
}
