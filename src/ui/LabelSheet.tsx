import { useMemo, useState } from 'react';
import { clusterMembers, clusterTitle } from '../diagram/layout';
import { toCsv } from '../export/csv';
import { type Label, type LabelOptions, TIE_COLORS, labelPrep, labelledIds, labelsFor, storyName, tieHex, tieName, tiesText } from '../export/labels';
import { TieDots } from './TieDots';
import type { NodePatch } from '../model/actions';
import type { Display, Marks } from '../model/types';

type Format = 'flag' | 'small' | 'large' | 'maker';

interface Props {
  display: Display;
  /** Change an item (story, location, length, an outlet's tie colour). */
  onPatch: (id: string, patch: NodePatch) => void;
  /** Turn zip-tie colours or story counts on or off (colours get handed out when turned on). */
  onMarks: (marks: Marks) => void;
  onDownloadCsv: (csv: string) => void;
  onClose: () => void;
}

const FORMAT_NAME: Record<Format, string> = {
  flag: 'Flag: folds around a cord (about 3 × 0.75 in)',
  small: 'Small (about 2 × 0.75 in)',
  large: 'Large (about 3.5 × 1.25 in)',
  maker: 'Label maker (one line each)',
};

const OPTS_KEY = 'wiring-sketchpad.labels';
interface Saved extends LabelOptions {
  format: Format;
}
function readSaved(): Saved {
  const base: Saved = { format: 'flag', includeLoads: true, bothEnds: true, route: false, storage: false };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') };
  } catch {
    return base;
  }
}

function LabelFace({ l }: { l: Label }) {
  return (
    <div className="label-face">
      <div className="label-top">
        <span className="label-id">{l.heading}</span>
        <TieDots ties={l.ties} />
      </div>
      <div className="label-sub">{l.sub}</div>
      {l.route && <div className="label-route">{l.route}</div>}
      {l.storage && <div className="label-name">{l.storage}</div>}
    </div>
  );
}

/** A text box that saves when you leave it or press Enter. */
function Inline({ value, label, placeholder, type = 'text', onCommit }: { value: string; label: string; placeholder?: string; type?: string; onCommit: (v: string) => void }) {
  return (
    <input
      key={value}
      className="ls-input"
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      onBlur={(e) => e.target.value.trim() !== value && onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * Labels for cords, gear, lights and props: small, with the ID big and one useful line.
 * Optional zip-tie marks: a colour per outlet and one tie per story. Paper formats print with
 * cut lines; "Label maker" gives one line per label to copy, or a CSV for P-touch or Dymo.
 */
export function LabelSheet({ display, onPatch, onMarks, onDownloadCsv, onClose }: Props) {
  const [saved, setSaved] = useState(readSaved);
  const set = (patch: Partial<Saved>) =>
    setSaved((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(next));
      } catch {
        // private mode: this visit only
      }
      return next;
    });
  const { format, ...opts } = saved;
  const marks = display.marks ?? {};
  const [copied, setCopied] = useState(false);
  const labels = useMemo(() => labelsFor(display, opts), [display, opts.includeLoads, opts.bothEnds, opts.route, opts.storage]);
  const prep = labelPrep(labels);
  const plain = labels.map((l) => l.text).join('\n');
  const ids = useMemo(() => new Set(labelledIds(display, opts)), [display, opts.includeLoads]);
  const groups = useMemo(
    () =>
      clusterMembers(display)
        .map((g) => ({ root: display.nodes[g.root], members: g.members.filter((id) => ids.has(id)) }))
        .filter((g) => g.members.length),
    [display, ids],
  );

  return (
    <div className="labels-page" role="dialog" aria-modal="true" aria-label="Labels">
      <div className="labels-controls no-print">
        <div className="labels-head">
          <strong>Labels · {display.title}</strong>
          <button type="button" onClick={onClose} aria-label="Close labels">
            ✕
          </button>
        </div>
        <div className="labels-opts">
          <label className="field">
            <span>Format</span>
            <select value={format} onChange={(e) => set({ format: e.target.value as Format })}>
              {(Object.keys(FORMAT_NAME) as Format[]).map((s) => (
                <option key={s} value={s}>
                  {FORMAT_NAME[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.includeLoads !== false} onChange={(e) => set({ includeLoads: e.target.checked })} />
            Lights and props too
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.bothEnds !== false} onChange={(e) => set({ bothEnds: e.target.checked })} />
            Both ends of each cord
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.route} onChange={(e) => set({ route: e.target.checked })} />
            Where it plugs in
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.storage} onChange={(e) => set({ storage: e.target.checked })} />
            Storage spot
          </label>
        </div>
        <fieldset className="sheet-parts ties-opts">
          <legend>Zip ties (optional)</legend>
          <label className="check">
            <input type="checkbox" checked={!!marks.colors} onChange={(e) => onMarks({ ...marks, colors: e.target.checked })} />
            A colour for each outlet
          </label>
          <label className="check">
            <input type="checkbox" checked={!!marks.stories} onChange={(e) => onMarks({ ...marks, stories: e.target.checked })} />
            One tie per story (1 = first floor, 2 = second story)
          </label>
        </fieldset>

        <p className="ls-prep" role="status">
          <b>
            {prep.labels} label{prep.labels === 1 ? '' : 's'}
          </b>
          {prep.ties.length > 0 && (
            <>
              {' · zip ties: '}
              {prep.ties.map((t, i) => (
                <span key={t.color || 'plain'}>
                  {i ? ', ' : ''}
                  {t.count} {t.color ? tieName(t.color).toLowerCase() : 'plain'}
                </span>
              ))}
            </>
          )}
        </p>

        <details className="ls-setup">
          <summary>Set up: where things go{marks.stories ? ', stories' : ''}{marks.colors ? ', outlet colours' : ''}</summary>
          <p className="muted small">Lights and props show where they go; cords show their length. Changes save to the plan.</p>
          {groups.map((g) => (
            <section key={g.root.id} className="ls-group" aria-label={g.root.kind === 'outlet' ? clusterTitle(display, g.root.id) : 'Not plugged in yet'}>
              <h3>
                <span>{g.root.kind === 'outlet' ? clusterTitle(display, g.root.id) : 'Not plugged in yet'}</span>
                {marks.colors && g.root.kind === 'outlet' && (
                  <label className="ls-color">
                    <span className="tie-swatch" style={{ background: tieHex(g.root.tieColor) ?? 'transparent' }} aria-hidden="true" />
                    <select aria-label={`Zip-tie colour for ${g.root.id}`} value={g.root.tieColor ?? ''} onChange={(e) => onPatch(g.root.id, { tieColor: e.target.value || undefined })}>
                      <option value="">No colour</option>
                      {TIE_COLORS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </h3>
              <ul>
                {g.members.map((id) => {
                  const n = display.nodes[id];
                  return (
                    <li key={id} className="ls-row">
                      <span className="ls-name">
                        <b className="dn-id">{id}</b> {n.label}
                      </span>
                      {n.kind === 'cord' ? (
                        <Inline
                          type="number"
                          label={`Length of ${id} in feet`}
                          placeholder="ft"
                          value={n.lengthFt !== undefined ? String(Math.round(n.lengthFt)) : ''}
                          onCommit={(v) => onPatch(id, { lengthFt: v && Number(v) > 0 ? Number(v) : undefined, lengthApprox: undefined })}
                        />
                      ) : (
                        <Inline label={`Where ${id} goes`} placeholder="Where: garage peak, left bush…" value={n.location ?? ''} onCommit={(v) => onPatch(id, { location: v || undefined })} />
                      )}
                      {marks.stories && (
                        <span className="seg ls-story" role="group" aria-label={`Story for ${id}`}>
                          {[1, 2, 3].map((k) => (
                            <button key={k} type="button" aria-pressed={(n.story ?? 1) === k} className={(n.story ?? 1) === k ? 'on' : ''} onClick={() => onPatch(id, { story: k === 1 ? undefined : k })} title={`${storyName(k)} story`}>
                              {k}
                            </button>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </details>

        <div className="labels-actions">
          {format === 'maker' ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void navigator.clipboard?.writeText(plain).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                {copied ? 'Copied' : 'Copy all as text'}
              </button>
              <button
                type="button"
                onClick={() =>
                  onDownloadCsv(
                    toCsv([['label', 'id', 'line2', 'zip ties', 'where', 'storage'], ...labels.map((l) => [l.text, l.id, l.sub, tiesText(l.ties), l.route ?? '', l.storage ?? ''])]),
                  )
                }
              >
                Download CSV for label software
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => window.print()}>
              🖨 Print
            </button>
          )}
          <span className="muted small">{format === 'flag' ? 'Cut out, fold around the cord so the two halves meet, and tape.' : 'Cut along the lines.'}</span>
        </div>
      </div>

      {format === 'maker' ? (
        <pre className="labels-maker" aria-label="Label text">
          {labels.length ? labels.map((l) => `${l.text}${l.ties ? `   (${tiesText(l.ties)})` : ''}`).join('\n') : 'Nothing to label yet.'}
        </pre>
      ) : (
        <div className={`labels-grid ${format} print-area`} aria-label="Labels to print">
          {labels.map((l) => (
            <div key={l.key} className={`label${format === 'flag' ? ' flag' : ''}`} aria-label={`Label ${l.text}`}>
              <LabelFace l={l} />
              {format === 'flag' && (
                <>
                  <div className="label-wrap" aria-hidden="true" />
                  <LabelFace l={l} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
