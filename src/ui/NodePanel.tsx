import { useState } from 'react';
import { iconFor } from '../presets/custom';
import type { NodePatch } from '../model/actions';
import { inlineFemales, isRun } from '../model/graph';
import { bulbCount, drawnAsLights, runStyle } from '../photo/geometry';
import { type LightOpts, LightOptions, lightOptsOf } from '../photo/LightOptions';
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
  onUnplug: () => void;
  /** Delete it together with everything plugged into it. */
  onDeleteBranch: () => void;
  onSaveAsPreset: (name: string, icon: string) => void;
  /** Lights: a new look for this item (remembered for the next one of its kind). */
  onLook: (opts: LightOpts) => void;
  /** Lights of the same kind in the plan, this one included. */
  sameKindCount: number;
  /** Give all of them this look. */
  onLookAll: (opts: LightOpts) => void;
  /** Print a label for just this item. */
  onLabel?: () => void;
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

/** Where outlets usually are, one tap each (or type your own). */
export const LOCATIONS = ['Front porch', 'Back porch', 'Left side', 'Right side', 'Garage', 'Front yard', 'Backyard', 'Inside'];

/** Inline female taps and the end female of SPT-1 zip cord, C9 stringers and light strings. */
function RunSockets({ node, onPatch }: { node: DisplayNode; onPatch: (patch: NodePatch) => void }) {
  const taps = node.outputs === undefined ? undefined : inlineFemales(node);
  const end = node.endFemale !== false;
  const set = (t: number | undefined, e: boolean) => onPatch({ outputs: (t ?? 0) + (e ? 1 : 0), endFemale: e ? undefined : false });
  const hint =
    node.kind === 'cord' && node.subtype === 'spt'
      ? 'Slide-on (vampire) females along the zip cord. Plug things into tap 1, tap 2… or the end.'
      : node.kind === 'cord'
        ? 'Outlets along the cord, then one at the end.'
        : node.category === 'pathway'
          ? 'Stake light sets usually have a female at the end for the next set.'
          : node.category === 'c9'
            ? 'C9 stringers can have females part way along; end-to-end strings have one at the end.'
            : 'Most light strings have a female at the end to connect the next one.';
  return (
    <div className="field wide run-sockets">
      <span>Females on this run</span>
      <div className="row">
        <div className="stepper" role="group" aria-label="Inline females">
          <button type="button" aria-label="Fewer inline females" disabled={!taps} onClick={() => set(Math.max(0, (taps ?? 0) - 1), end)}>
            −
          </button>
          <output aria-live="polite">{taps ?? '?'}</output>
          <button type="button" aria-label="More inline females" onClick={() => set((taps ?? 0) + 1, end)}>
            +
          </button>
          <span className="stepper-name">inline</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={end} onChange={(e) => set(taps, e.target.checked)} />
          Female at the end
        </label>
      </div>
      <span className="muted small">{hint}</span>
    </div>
  );
}

/** Outlet location: common spots as chips, or anything typed. */
function LocationField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="field wide location">
      <span id="loc-label">Location</span>
      <div className="loc-chips" role="group" aria-labelledby="loc-label">
        {LOCATIONS.map((l) => (
          <button key={l} type="button" className={`chip${value === l ? ' on' : ''}`} aria-pressed={value === l} onClick={() => onChange(value === l ? undefined : l)}>
            {l}
          </button>
        ))}
      </div>
      <input
        key={value ?? ''}
        aria-label="Location"
        defaultValue={value ?? ''}
        placeholder="Or type it: by the mailbox, garage left…"
        onBlur={(e) => e.target.value.trim() !== (value ?? '') && onChange(e.target.value.trim() || undefined)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

const numOrUndef = (v: string): number | undefined | null => {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null; // null = invalid, ignore
};

/** Details of the selected item. Its main actions live in the selection bar. */
export function NodePanel({ node, below, plugged, onPatch, onKind, onUnplug, onDeleteBranch, onSaveAsPreset, onLook, sameKindCount, onLookAll, onLabel }: Props) {
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetIcon, setPresetIcon] = useState('');
  const num = (key: 'qty' | 'watts' | 'amps' | 'lengthFt' | 'outputs') => (v: string) => {
    const n = numOrUndef(v);
    if (n !== null) onPatch({ [key]: key === 'qty' || key === 'outputs' ? (n === undefined ? undefined : Math.round(n)) : n });
  };
  const str = (v: number | undefined) => (v === undefined ? '' : String(v));
  const isLoad = node.kind === 'load';
  const run = isRun(node);
  const hasSockets = node.kind !== 'load' && node.kind !== 'outlet' && !run;
  const lights = drawnAsLights(node) && runStyle(node) !== 'plain';
  const look = lights ? lightOptsOf(node) : undefined;

  return (
    <section className="panel" aria-label={`Details for ${node.id}`}>
      <div className="panel-head">
        <label className="field wide">
          <span>Kind</span>
          <select aria-label="Kind" value={node.kind} onChange={(e) => onKind(e.target.value as NodeKind)}>
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_NAMES[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fields">
        <Field label="Name" value={node.label} wide onCommit={(v) => onPatch({ label: v.replace(/[[\]]/g, '').trim() })} />
        {isLoad && <Field label="Qty" type="number" value={str(node.qty)} onCommit={num('qty')} />}
        {(node.kind === 'cord' || isLoad) && <Field label="Length ft" type="number" value={str(node.lengthFt)} onCommit={num('lengthFt')} />}
        {hasSockets && <Field label="Sockets" type="number" value={str(node.outputs)} placeholder="?" onCommit={num('outputs')} />}
        {run && <RunSockets node={node} onPatch={onPatch} />}
        {node.kind === 'outlet' && (
          <>
            <LocationField value={node.location} onChange={(location) => onPatch({ location })} />
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

      {look && (
        <section className="lights-section" aria-label="Lights">
          <h3>Lights</h3>
          <LightOptions value={look} onChange={(patch) => onLook({ ...look, ...patch })} />
          {sameKindCount > 1 && (
            <button type="button" className="look-all" onClick={() => onLookAll(look)}>
              Use this look on all {sameKindCount} {runStyle(node) === 'c9' ? 'C9/C7 lights' : 'lights like this'}
            </button>
          )}
          {node.lengthFt !== undefined && node.lengthFt > 0 && (
            <p className="muted small">
              ≈ {bulbCount(node.lengthFt, look.spacingIn)} bulbs over {node.lengthFt} ft at {look.spacingIn}″ spacing.
            </p>
          )}
        </section>
      )}

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
        <summary>More details</summary>
        <div className="fields">
          {node.kind !== 'outlet' && (
            <Field label="Location" wide value={node.location ?? ''} placeholder="Front porch, left of garage…" onCommit={(v) => onPatch({ location: v.trim() || undefined })} />
          )}
          {node.kind !== 'outlet' && (
            <label className="field">
              <span>Story</span>
              <select aria-label="Story" value={String(node.story ?? 1)} onChange={(e) => onPatch({ story: Number(e.target.value) > 1 ? Number(e.target.value) : undefined })}>
                <option value="1">Ground / 1st floor</option>
                <option value="2">2nd story</option>
                <option value="3">3rd story</option>
              </select>
            </label>
          )}
          <Field label="Storage spot" wide value={node.storage ?? ''} placeholder="Tote 3, garage shelf…" onCommit={(v) => onPatch({ storage: v.trim() || undefined })} />
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
          <Field label="Watts (optional)" type="number" value={str(node.watts)} onCommit={num('watts')} />
          {node.kind !== 'outlet' && (
            <Field label="Label text (instead of length or place)" wide value={node.labelText ?? ''} placeholder="Porch to bushes, Bin 3…" onCommit={(v) => onPatch({ labelText: v.trim() || undefined })} />
          )}
        </div>
        {node.kind !== 'outlet' && onLabel && (
          <button type="button" className="label-one" onClick={onLabel}>
            🏷 Print a label for {node.id}
          </button>
        )}
      </details>

      {saving && (
        <form
          className="save-preset"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveAsPreset(presetName || node.label, presetIcon || iconFor(node));
            setSaving(false);
          }}
        >
          <label className="field wide">
            <span>Preset name</span>
            <input autoFocus value={presetName} placeholder={node.label} onChange={(e) => setPresetName(e.target.value)} />
          </label>
          <label className="field">
            <span>Icon</span>
            <input value={presetIcon} placeholder={iconFor(node)} maxLength={4} onChange={(e) => setPresetIcon(e.target.value)} />
          </label>
          <p className="muted small">
            Saves the kind, name{node.lengthFt !== undefined ? ', length' : ''}
            {node.outputs !== undefined ? ', socket count' : ''} and colour as a preset on this device. Not its
            connections or status.
          </p>
          <button type="submit" className="primary">
            Save preset
          </button>{' '}
          <button type="button" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </form>
      )}

      <div className="panel-actions">
        {plugged && (
          <button type="button" onClick={onUnplug}>
            Unplug
          </button>
        )}
        {!saving && (
          <button type="button" onClick={() => setSaving(true)}>
            Save as preset
          </button>
        )}
        {below > 0 && (
          <button type="button" className="danger" onClick={onDeleteBranch}>
            Delete with {below} below
          </button>
        )}
      </div>
    </section>
  );
}
