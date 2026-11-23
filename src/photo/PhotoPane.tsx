import { useRef, useState } from 'react';
import type { Display, Placement, PhotoView } from '../model/types';
import { iconFor } from '../presets/custom';
import { PRESETS } from '../presets/presets';
import { Sheet } from '../ui/Sheet';
import { type Pt, drawnAsLights, drawsAsArea, unplaced } from './geometry';
import type { LightOpts } from './LightOptions';
import { type LightNode, PhotoEditor, type PhotoIntent } from './PhotoEditor';

/** Light styles offered by "Draw lights" (built-in presets): along the house, and on bushes. */
const RUN_PRESETS = ['c9', 'c9stringer', 'mini', 'icicle', 'pathway'];
const AREA_PRESETS = ['net', 'bushmini', 'tree'];

interface Props {
  display: Display;
  views: PhotoView[];
  view?: PhotoView;
  photoUrl?: string;
  onPickView: (id: string) => void;
  onAddPhoto: (file: Blob, name: string) => void;
  onAddSample: () => void;
  onRemoveView: (view: PhotoView) => void;
  busyPhoto: boolean;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  intent?: PhotoIntent;
  setIntent: (i: PhotoIntent | undefined) => void;
  /** Open the icon picker; the chosen preset is then placed with a tap. */
  onAddItem: () => void;
  onPlacePoint: (intent: PhotoIntent, at: Pt) => void;
  onFinishRun: (intent: PhotoIntent, points: Pt[], opts?: LightOpts) => void;
  onSkipPlacing: (intent: PhotoIntent) => void;
  /** The item or preset being drawn, for the live preview and its light options. */
  draftBase?: LightNode;
  onSetScale: (feetPerPx: number) => void;
  onMovePlacement: (nodeId: string, placement: Placement) => void;
  onPlugInto: (nodeId: string, parentId: string) => void;
  blocked?: Set<string>;
  fitKey: string;
  /** Phone: the selection bar replaces the photo actions while something is selected. */
  hideActions?: boolean;
}

export function PhotoPane(props: Props) {
  const { display, views, view } = props;
  const file = useRef<HTMLInputElement>(null);
  const [night, setNight] = useState(false);
  const [wiring, setWiring] = useState(true);
  const [sheet, setSheet] = useState<null | 'draw' | 'plan'>(null);
  const selected = props.selectedId ? display.nodes[props.selectedId] : undefined;
  const list = view ? unplaced(display, view.id) : [];

  const fileInput = (
    <input
      ref={file}
      type="file"
      accept="image/*"
      hidden
      aria-label="Photo file"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) props.onAddPhoto(f, views.length ? `Photo ${views.length + 1}` : 'Front of house');
      }}
    />
  );

  if (!view) {
    return (
      <div className="photo-empty">
        {fileInput}
        <div className="photo-empty-card">
          <div className="photo-empty-icon" aria-hidden="true">
            🏠
          </div>
          <h2>Plan it on a photo of your house</h2>
          <p>
            Take or choose a photo, then draw light runs along the roofline and drop inflatables, spotlights and outlets
            where they go. Everything you place is part of this plan: same items, same IDs, same wiring.
          </p>
          <button type="button" className="primary big" disabled={props.busyPhoto} onClick={() => file.current?.click()}>
            {props.busyPhoto ? 'Preparing photo…' : '📷 Add a photo'}
          </button>
          <button type="button" className="big" disabled={props.busyPhoto} onClick={props.onAddSample}>
            Try it with a sample house
          </button>
          <p className="muted small">Photos are shrunk and kept on this device only. They are included in JSON backups.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="photo-pane">
      {fileInput}
      <div className="photo-bar">
        <div className="photo-tabs" role="tablist" aria-label="Photos">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === view.id} className={v.id === view.id ? 'chip on' : 'chip'} onClick={() => props.onPickView(v.id)}>
              {v.name}
            </button>
          ))}
          <button type="button" className="chip" disabled={props.busyPhoto} onClick={() => file.current?.click()} aria-label="Add another photo">
            + Photo
          </button>
        </div>
        <div className="photo-toggles">
          <button type="button" aria-pressed={night} className={night ? 'on' : ''} onClick={() => setNight((n) => !n)} title="Night preview">
            🌙 Night
          </button>
          <button type="button" aria-pressed={wiring} className={wiring ? 'on' : ''} onClick={() => setWiring((w) => !w)} title="Show what plugs into what">
            🔌 Wiring
          </button>
          <button type="button" aria-pressed={props.intent?.type === 'scale'} className={view.feetPerPx ? 'on' : ''} onClick={() => props.setIntent({ type: 'scale' })} title="Measure: set the photo's scale">
            📏 {view.feetPerPx ? 'Scale set' : 'Measure'}
          </button>
          <details className="menu">
            <summary aria-label="Photo options">⋯</summary>
            <div className="menu-list" role="menu">
              <button type="button" role="menuitem" className="danger" onClick={() => props.onRemoveView(view)}>
                Remove this photo
              </button>
            </div>
          </details>
        </div>
      </div>

      <PhotoEditor
        display={display}
        view={view}
        photoUrl={props.photoUrl}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        intent={props.intent}
        draftBase={props.draftBase}
        onCancelIntent={() => props.setIntent(undefined)}
        onPlacePoint={props.onPlacePoint}
        onFinishRun={props.onFinishRun}
        onSkipPlacing={props.onSkipPlacing}
        onSetScale={props.onSetScale}
        onMovePlacement={props.onMovePlacement}
        onPlugInto={props.onPlugInto}
        blocked={props.blocked}
        night={night}
        wiring={wiring}
        fitKey={props.fitKey}
      />

      {!props.intent && !props.hideActions && (
        <div className="photo-actions">
          <button type="button" className="primary" onClick={props.onAddItem}>
            + Add item
          </button>
          <button type="button" onClick={() => setSheet('draw')}>
            ✏️ Draw lights
          </button>
          <button type="button" onClick={() => setSheet('plan')} disabled={!list.length}>
            Place from plan{list.length ? ` (${list.length})` : ''}
          </button>
        </div>
      )}

      {sheet === 'draw' && (
        <Sheet title="Draw lights" onClose={() => setSheet(null)}>
          <p className="muted small">Pick a style, then tap along the house (or around a bush). Set colours, spacing and wire while you draw.</p>
          {selected && drawnAsLights(selected) && (
            <button
              type="button"
              className="primary wide-btn"
              onClick={() => {
                setSheet(null);
                const cur = selected.placements?.[view.id];
                const area = cur ? cur.kind === 'area' : drawsAsArea(selected);
                props.setIntent({ type: 'draw', nodeId: selected.id, name: `${selected.id} ${selected.label}`, area });
              }}
            >
              {selected.placements?.[view.id] && selected.placements[view.id].kind !== 'point' ? 'Redraw' : 'Draw'} {selected.id} {selected.label}
            </button>
          )}
          {[
            { title: 'Along the house', ids: RUN_PRESETS, area: false },
            { title: 'On bushes and trees', ids: AREA_PRESETS, area: true },
          ].map((g) => (
            <section key={g.title} className="draw-group">
              <h3>{g.title}</h3>
              <div className="tiles">
                {g.ids.map((id) => PRESETS.find((p) => p.id === id)!).map((p) => (
                  <div className="tile" key={p.id}>
                    <button
                      type="button"
                      className="tile-main"
                      aria-label={g.area ? `Light a bush with ${p.name}` : `Draw ${p.name}`}
                      onClick={() => {
                        setSheet(null);
                        props.setIntent({ type: 'draw', presetId: p.id, name: p.name, area: g.area });
                      }}
                    >
                      <span className="tile-icon" aria-hidden="true">
                        {p.icon}
                      </span>
                      <span className="tile-name">{p.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </Sheet>
      )}

      {sheet === 'plan' && (
        <Sheet title="Place from plan" onClose={() => setSheet(null)}>
          <p className="muted small">Things in your plan that are not on this photo yet. Pick one, then tap where it is.</p>
          <ul className="place-list">
            {list.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSheet(null);
                    props.setIntent(
                      drawnAsLights(n)
                        ? { type: 'draw', nodeId: n.id, name: `${n.id} ${n.label}`, area: drawsAsArea(n) }
                        : { type: 'place', nodeId: n.id, name: `${n.id} ${n.label}` },
                    );
                  }}
                >
                  <span aria-hidden="true">{iconFor(n)}</span> <b className="dn-id">{n.id}</b> {n.label}
                  <span className="muted small"> {drawnAsLights(n) ? (drawsAsArea(n) ? '· outline' : '· draw') : '· tap to place'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
