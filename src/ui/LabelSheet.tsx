import { useMemo, useState } from 'react';
import { toCsv } from '../export/csv';
import { type LabelOptions, labelsFor } from '../export/labels';
import type { Display } from '../model/types';

type Size = 'small' | 'large' | 'maker';

interface Props {
  display: Display;
  onDownloadCsv: (csv: string) => void;
  onClose: () => void;
}

const SIZE_NAME: Record<Size, string> = {
  small: 'Paper: small (about 2 × 0.75 in)',
  large: 'Paper: large (about 3.5 × 1.25 in)',
  maker: 'Label maker (one line each)',
};

/**
 * Cord and plug labels. Paper sizes print on plain paper with cut lines; "Label maker"
 * gives one line per label to copy, or a CSV to import into P-touch Editor or Dymo Connect.
 */
export function LabelSheet({ display, onDownloadCsv, onClose }: Props) {
  const [opts, setOpts] = useState<LabelOptions>({ storage: true });
  const [size, setSize] = useState<Size>('small');
  const [copied, setCopied] = useState(false);
  const labels = useMemo(() => labelsFor(display, opts), [display, opts]);
  const plain = labels.map((l) => l.text).join('\n');
  const toggle = (k: keyof LabelOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="labels-page" role="dialog" aria-modal="true" aria-label="Cord and plug labels">
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
            <select value={size} onChange={(e) => setSize(e.target.value as Size)}>
              {(Object.keys(SIZE_NAME) as Size[]).map((s) => (
                <option key={s} value={s}>
                  {SIZE_NAME[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.includeLoads} onChange={() => toggle('includeLoads')} />
            Also lights and props
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.bothEnds} onChange={() => toggle('bothEnds')} />
            Both ends of each cord
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.storage} onChange={() => toggle('storage')} />
            Storage spot
          </label>
        </div>
        <div className="labels-actions">
          {size === 'maker' ? (
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
                onClick={() => onDownloadCsv(toCsv([['label', 'id', 'route', 'name'], ...labels.map((l) => [l.text, l.id, l.route, l.name])]))}
              >
                Download CSV for label software
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => window.print()}>
              Print
            </button>
          )}
          <span className="muted small">{labels.length} labels</span>
        </div>
      </div>

      {size === 'maker' ? (
        <pre className="labels-maker" aria-label="Label text">
          {plain || 'Nothing to label yet.'}
        </pre>
      ) : (
        <div className={`labels-grid ${size} print-area`}>
          {labels.map((l) => (
            <div key={l.key} className="label">
              <div className="label-id">{l.heading}</div>
              <div className="label-route">{l.route}</div>
              <div className="label-name">
                {l.name}
                {l.storage ? ` · ${l.storage}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
