import { useEffect, useMemo, useState } from 'react';
import { installSteps, takedownSteps } from '../export/installSteps';
import { takeoff } from '../export/takeoff';
import type { Display, PhotoView } from '../model/types';
import { renderPicture } from '../photo/Picture';
import { PlanDiagrams } from './PlanDiagrams';
import { tiesFor } from '../export/labels';
import { TieDots } from './TieDots';

interface Props {
  display: Display;
  /** Object URLs of the photos, by photo id (loaded by the app). */
  photoUrls: Record<string, string>;
  /** Start with one photo (opened from that photo). */
  initialViewId?: string;
  onClose: () => void;
}

const OPTS_KEY = 'wiring-sketchpad.installSheet';
interface SheetOpts {
  picture: boolean;
  steps: boolean;
  /** Put up, or take down (backwards, with where things are stored). */
  takedown: boolean;
  buy: boolean;
  diagram: boolean;
}
const DEFAULTS: SheetOpts = { picture: true, steps: true, takedown: false, buy: true, diagram: false };
function readOpts(): SheetOpts {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Install sheet: the photo with numbered items, the plug-in order as numbered steps with
 * boxes to tick, and what to buy. Prints on plain paper or saves as a PDF (the browser's
 * print dialog). Everything in the plan, or one photo.
 */
export function InstallSheet({ display, photoUrls, initialViewId, onClose }: Props) {
  const views = display.views ?? [];
  const [scope, setScope] = useState(views.some((v) => v.id === initialViewId) ? initialViewId! : '');
  const view = views.find((v) => v.id === scope);
  const [opts, setOpts] = useState(readOpts);
  const set = (patch: Partial<SheetOpts>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(next));
      } catch {
        // private mode: this visit only
      }
      return next;
    });
  const steps = useMemo(
    () => (opts.takedown ? takedownSteps(display, { viewId: scope || undefined }) : installSteps(display, { viewId: scope || undefined })),
    [display, scope, opts.takedown],
  );
  const shown = view ? [view] : views;
  const shopping = useMemo(() => takeoff(display, { viewId: scope || undefined }), [display, scope]);
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="labels-page install-page" role="dialog" aria-modal="true" aria-label="Install sheet">
      <div className="labels-controls no-print">
        <div className="labels-head">
          <strong>Install sheet · {display.title}</strong>
          <button type="button" onClick={onClose} aria-label="Close install sheet">
            ✕
          </button>
        </div>
        <div className="labels-opts">
          {views.length > 0 && (
            <label className="field">
              <span>For</span>
              <select aria-label="Which photo" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Everything in the plan</option>
                {views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="seg" role="group" aria-label="Steps for">
            <button type="button" aria-pressed={!opts.takedown} className={!opts.takedown ? 'on' : ''} onClick={() => set({ takedown: false })}>
              Put up
            </button>
            <button type="button" aria-pressed={opts.takedown} className={opts.takedown ? 'on' : ''} onClick={() => set({ takedown: true })}>
              Take down
            </button>
          </div>
        </div>
        <fieldset className="sheet-parts">
          <legend>Include</legend>
          {(
            [
              ['picture', 'Photo with numbers'],
              ['steps', opts.takedown ? 'Take-down steps' : 'Plug-in steps'],
              ['buy', 'What to buy'],
              ['diagram', 'Plan diagram'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={opts[k]} onChange={(e) => set({ [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="labels-actions">
          <button type="button" className="primary" onClick={() => window.print()}>
            🖨 Print or save as PDF
          </button>
          <span className="muted small">Numbers on the photo match the steps. Tick the boxes as you go.</span>
        </div>
      </div>

      <article className="install-doc">
        <header className="install-title">
          <h1>
            {display.title}
            {view ? ` · ${view.name}` : ''}
          </h1>
          <span>
            {opts.takedown ? 'Take-down sheet' : 'Install sheet'} · {today}
          </span>
        </header>

        {opts.picture &&
          shown.map((v) => <InstallPicture key={v.id} display={display} view={v} photoUrl={photoUrls[v.photoId]} steps={steps} />)}

        {opts.steps && (
        <section className="install-steps" aria-label="Steps">
          <h2>{opts.takedown ? 'Take down, in this order' : 'Plug in, in this order'}</h2>
          {steps.length ? (
            <ol>
              {steps.map((s) => (
                <li key={s.id} className={s.done ? 'done' : ''}>
                  <span className="box" aria-hidden="true">
                    {s.done ? '☑' : '☐'}
                  </span>
                  <b className="num">{s.n}.</b> <TieDots ties={tiesFor(display, s.id)} trailing />{s.text}
                  {s.done && <span className="sr-only"> (done)</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Nothing to {opts.takedown ? 'take down' : 'install'} yet.</p>
          )}
        </section>
        )}

        {opts.diagram && (
          <section className="install-diagram" aria-label="Plan diagram">
            <h2>Plan diagram</h2>
            <PlanDiagrams display={display} viewId={scope || undefined} />
          </section>
        )}

        {opts.buy && shopping.length > 0 && (
          <section className="install-shopping" aria-label="What to buy">
            <h2>What to buy</h2>
            {shopping.map((s) => (
              <div key={s.title} className="install-shop-group">
                <h3>{s.title}</h3>
                <ul>
                  {s.lines.map((l) => (
                    <li key={l.item}>
                      <b>{l.qty}</b> {l.item}
                      {l.detail ? ` (${l.detail})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </article>
    </div>
  );
}

/** One photo with numbered badges for the items on it (numbers follow the steps). */
function InstallPicture({ display, view, photoUrl, steps }: { display: Display; view: PhotoView; photoUrl?: string; steps: ReturnType<typeof installSteps> }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!photoUrl) return;
    let live = true;
    let made: string | undefined;
    const numbers: Record<string, number> = {};
    for (const s of steps) if (display.nodes[s.id]?.placements?.[view.id]) numbers[s.id] = s.n;
    renderPicture(display, view, photoUrl, { night: false, items: true, cables: true, numbers })
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [display, view, photoUrl, steps]);
  return (
    <figure className="install-figure">
      {url ? <img src={url} alt={`${view.name} with numbered items`} /> : <div className="picture-wait">{error || 'Making the picture…'}</div>}
      <figcaption>{view.name}</figcaption>
    </figure>
  );
}
