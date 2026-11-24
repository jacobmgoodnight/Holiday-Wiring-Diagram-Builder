import { useRef, useState } from 'react';
import { homeLink } from '../model/actions';
import type { Display, Measure, Placement, PhotoView } from '../model/types';
import { iconFor } from '../presets/custom';
import { PRESETS } from '../presets/presets';
import { Sheet } from '../ui/Sheet';
import type { Target } from '../model/actions';
import { type Pt, drawnAsLights, drawnAsRun, drawsAsArea, unplaced } from './geometry';
import type { LightOpts } from './LightOptions';
import { type LightNode, PhotoEditor, type PhotoIntent } from './PhotoEditor';
import { PictureSheet } from './Picture';

/** Light styles offered by "Draw lights" (built-in presets): along the house, and on bushes. */
const RUN_PRESETS = ['c9', 'c9stringer', 'mini', 'icicle', 'pathway'];
const AREA_PRESETS = ['net', 'bushmini', 'tree', 'megatree'];

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
  onFinishRun: (intent: PhotoIntent, points: Pt[], opts?: LightOpts, snap?: Target) => void;
  onSkipPlacing: (intent: PhotoIntent) => void;
  /** The item or preset being drawn, for the live preview and its light options. */
  draftBase?: LightNode;
  onAddMeasure: (m: Measure) => void;
  onRemoveMeasure: (index: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onMovePlacement: (nodeId: string, placement: Placement) => void;
  onPlugInto: (nodeId: string, parentId: string, port?: string) => void;
  onConnect: (intent: Extract<PhotoIntent, { type: 'connect' }>, childId: string) => void;
  onConnectNew: (intent: Extract<PhotoIntent, { type: 'connect' }>) => void;
  onSocketTap: (runId: string, port: string) => void;
  onSplice: (runId: string, along: number) => void;
  onMoveTap: (runId: string, index: number, along: number) => void;
  onRemoveFemale: (runId: string, index: number) => void;
  onToggleInstalled: (id: string) => void;
  /** Add extension cords automatically when a strand does not reach. */
  autoCords: boolean;
  onToggleAutoCords: () => void;
  /** Open the shopping list for this photo. */
  onShoppingList: (viewId: string) => void;
  onRenameView: (name: string) => void;
  /** Open the printable install sheet for this photo. */
  onInstallSheet: (viewId: string) => void;
  /** Labels for what is on this photo. */
  onLabels: (viewId: string) => void;
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
  const [sheet, setSheet] = useState<null | 'draw' | 'plan' | 'picture' | 'rename'>(null);
  const [photoName, setPhotoName] = useState('');
  const closeMenu = (e: React.MouseEvent) => {
    const d = (e.currentTarget as HTMLElement).closest('details');
    if (d) d.open = false;
  };
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
    <div className={`photo-pane${props.selectedId ? ' has-selection' : ''}`}>
      {fileInput}
      <div className="photo-bar">
        <div className="photo-scroll">
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
            <button
              type="button"
              aria-pressed={props.intent?.type === 'install'}
              className={props.intent?.type === 'install' ? 'on' : ''}
              onClick={() => props.setIntent(props.intent?.type === 'install' ? undefined : { type: 'install' })}
              title="Install mode: tap each item as you put it up"
              aria-label="Install mode"
            >
              ✅
            </button>
            <button type="button" onClick={() => setSheet('picture')} title="Save the photo with its lights as a picture" aria-label="Save picture">
              📸
            </button>
          </div>
        </div>
        <details className="menu">
          <summary aria-label="Photo options">⋯</summary>
          <div className="menu-list" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeMenu(e);
                setSheet('picture');
              }}
            >
              📸 Save picture…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeMenu(e);
                props.onShoppingList(view.id);
              }}
            >
              🧾 Shopping list…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeMenu(e);
                props.onInstallSheet(view.id);
              }}
            >
              🖨 Install sheet…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeMenu(e);
                props.onLabels(view.id);
              }}
            >
              🏷 Labels…
            </button>
            <label className="menu-check" role="menuitemcheckbox" aria-checked={props.autoCords}>
              <input type="checkbox" checked={props.autoCords} onChange={props.onToggleAutoCords} />
              Add extension cords when a strand does not reach
            </label>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeMenu(e);
                setPhotoName(view.name);
                setSheet('rename');
              }}
            >
              Rename this photo…
            </button>
            <button type="button" role="menuitem" className="danger" onClick={() => props.onRemoveView(view)}>
              Remove this photo
            </button>
          </div>
        </details>
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
        onAddMeasure={props.onAddMeasure}
        onRemoveMeasure={props.onRemoveMeasure}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onMovePlacement={props.onMovePlacement}
        onPlugInto={props.onPlugInto}
        onConnect={props.onConnect}
        onConnectNew={props.onConnectNew}
        onSocketTap={props.onSocketTap}
        onSplice={props.onSplice}
        onMoveTap={props.onMoveTap}
        onRemoveFemale={props.onRemoveFemale}
        onToggleInstalled={props.onToggleInstalled}
        blocked={props.blocked}
        night={night}
        wiring={wiring}
        fitKey={props.fitKey}
      />

      {!props.intent && !props.hideActions && (
        <Coach
          key={view.id}
          display={display}
          view={view}
          onMeasure={() => props.setIntent({ type: 'scale' })}
          onOutlet={(id) => props.setIntent(id ? { type: 'place', nodeId: id, name: `${id} ${display.nodes[id].label}` } : { type: 'place', presetId: 'outlet', name: 'Outlet' })}
          onLights={() => setSheet('draw')}
          onPlug={(id) => props.setIntent({ type: 'move', nodeId: id, fresh: true })}
        />
      )}
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
                      aria-label={g.area && p.id !== 'megatree' ? `Light a bush with ${p.name}` : `Draw ${p.name}`}
                      onClick={() => {
                        setSheet(null);
                        props.setIntent({ type: 'draw', presetId: p.id, name: p.name, area: g.area });
                      }}
                    >
                      <span className="tile-icon" aria-hidden="true">
                        {p.icon}
                      </span>
                      <span className="tile-name">{p.name}</span>
                      {p.hint && <span className="tile-hint">{p.hint}</span>}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </Sheet>
      )}

      {sheet === 'rename' && (
        <Sheet title="Rename this photo" onClose={() => setSheet(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = photoName.trim();
              if (name) props.onRenameView(name);
              setSheet(null);
            }}
          >
            <label className="field wide">
              <span>Name</span>
              <input autoFocus value={photoName} onChange={(e) => setPhotoName(e.target.value)} placeholder="Front of house, back yard, left side…" />
            </label>
            <div className="chips-row">
              {['Front of house', 'Back of house', 'Left side', 'Right side', 'Backyard', 'Driveway'].map((n) => (
                <button key={n} type="button" className="chip" onClick={() => setPhotoName(n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className="row confirm-row">
              <button type="button" onClick={() => setSheet(null)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!photoName.trim()}>
                Save
              </button>
            </div>
          </form>
        </Sheet>
      )}
      {sheet === 'picture' && <PictureSheet display={display} view={view} photoUrl={props.photoUrl} night={night} onClose={() => setSheet(null)} />}

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
                      drawnAsRun(n)
                        ? { type: 'draw', nodeId: n.id, name: `${n.id} ${n.label}`, area: drawnAsLights(n) && drawsAsArea(n) }
                        : { type: 'place', nodeId: n.id, name: `${n.id} ${n.label}` },
                    );
                  }}
                >
                  <span aria-hidden="true">{iconFor(n)}</span> <b className="dn-id">{n.id}</b> {n.label}
                  <span className="muted small"> {drawnAsRun(n) ? (drawnAsLights(n) && drawsAsArea(n) ? '· outline' : '· draw') : '· tap to place'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

const COACH_KEY = 'wiring-sketchpad.coach';
const STEPS = ['Measure', 'Outlets', 'Lights', 'Plug in'];

/** What to do next on this photo, or undefined once it is all set up. */
export function nextPhotoStep(display: Display, view: PhotoView, skipMeasure = false): { step: number; text: string; action: string; nodeId?: string } | undefined {
  const onPhoto = Object.values(display.nodes).filter((n) => n.placements?.[view.id]);
  if (!view.feetPerPx && !skipMeasure)
    return { step: 0, text: 'Measure something you know (a garage door, the front door) so lengths, bulbs and cords come out right.', action: '📏 Start measuring' };
  if (!onPhoto.some((n) => n.kind === 'outlet')) {
    const waiting = Object.values(display.nodes).find((n) => n.kind === 'outlet' && !n.placements?.[view.id]);
    return { step: 1, text: 'Put your outlets on the photo: everything plugs into one.', action: waiting ? `🔌 Place ${waiting.id}` : '🔌 Add an outlet', nodeId: waiting?.id };
  }
  if (!onPhoto.some((n) => drawnAsRun(n))) return { step: 2, text: 'Draw your lights along the house, or outline a bush.', action: '✏️ Draw your lights' };
  const loose = onPhoto.find((n) => n.kind !== 'outlet' && !homeLink(display, n.id));
  if (loose) return { step: 3, text: `${loose.id} ${loose.label} is not plugged in yet.`, action: '🔌 Plug it in', nodeId: loose.id };
  return undefined;
}

function readCoach(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(COACH_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Getting started on a photo: measure, outlets, lights, plug in. Points at the next step
 * with a button for it; measuring can be skipped and the whole strip hidden (per photo).
 */
function Coach(props: { display: Display; view: PhotoView; onMeasure: () => void; onOutlet: (id?: string) => void; onLights: () => void; onPlug: (id: string) => void }) {
  const { display, view } = props;
  const key = `${display.id}:${view.id}`;
  const [flags, setFlags] = useState<string[]>(() => readCoach()[key] ?? []);
  const set = (flag: string) => {
    const next = [...new Set([...flags, flag])];
    setFlags(next);
    try {
      localStorage.setItem(COACH_KEY, JSON.stringify({ ...readCoach(), [key]: next }));
    } catch {
      // private mode: hidden for this visit only
    }
  };
  if (flags.includes('hidden')) return null;
  const next = nextPhotoStep(display, view, flags.includes('skip-measure'));
  if (!next) return null;
  const act = () => {
    if (next.step === 0) props.onMeasure();
    else if (next.step === 1) props.onOutlet(next.nodeId);
    else if (next.step === 2) props.onLights();
    else if (next.nodeId) props.onPlug(next.nodeId);
  };
  return (
    <div className="coach" role="region" aria-label="Next step">
      <ol className="coach-steps">
        {STEPS.map((name, i) => (
          <li key={name} className={i < next.step ? 'done' : i === next.step ? 'cur' : ''} aria-current={i === next.step ? 'step' : undefined}>
            <span aria-hidden="true">{i < next.step ? '✓' : i + 1}</span> {name}
          </li>
        ))}
      </ol>
      <div className="coach-next">
        <span>{next.text}</span>
        <button type="button" className="primary" onClick={act}>
          {next.action}
        </button>
        {next.step === 0 && (
          <button type="button" onClick={() => set('skip-measure')}>
            Skip
          </button>
        )}
        <button type="button" className="coach-hide" aria-label="Hide these steps" title="Hide these steps" onClick={() => set('hidden')}>
          ✕
        </button>
      </div>
    </div>
  );
}
