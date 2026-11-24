import { useEffect, useMemo, useState } from 'react';
import { installSteps } from '../export/installSteps';
import { takeoff } from '../export/takeoff';
import type { Display, PhotoView } from '../model/types';
import { renderPicture } from '../photo/Picture';

interface Props {
  display: Display;
  /** Object URLs of the photos, by photo id (loaded by the app). */
  photoUrls: Record<string, string>;
  /** Start with one photo (opened from that photo). */
  initialViewId?: string;
  onClose: () => void;
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
  const steps = useMemo(() => installSteps(display, { viewId: scope || undefined }), [display, scope]);
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
        </div>
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
          <span>Install sheet · {today}</span>
        </header>

        {shown.map((v) => (
          <InstallPicture key={v.id} display={display} view={v} photoUrl={photoUrls[v.photoId]} steps={steps} />
        ))}

        <section className="install-steps" aria-label="Steps">
          <h2>Plug in, in this order</h2>
          {steps.length ? (
            <ol>
              {steps.map((s) => (
                <li key={s.id} className={s.done ? 'done' : ''}>
                  <span className="box" aria-hidden="true">
                    {s.done ? '☑' : '☐'}
                  </span>
                  <b className="num">{s.n}.</b> {s.text}
                  {s.done && <span className="sr-only"> (done)</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Nothing to install yet.</p>
          )}
        </section>

        {shopping.length > 0 && (
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
