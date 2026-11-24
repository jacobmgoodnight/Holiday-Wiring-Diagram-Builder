import { useMemo, useState } from 'react';
import { type InstallStep, installSteps, takedownSteps } from '../export/installSteps';
import type { Display } from '../model/types';
import { useWakeLock } from './useWakeLock';
import { tiesFor } from '../export/labels';
import { TieDots } from './TieDots';

export type InstallDirection = 'up' | 'down';

interface Props {
  display: Display;
  direction: InstallDirection;
  onDirection: (d: InstallDirection) => void;
  /** '' for everything, or a photo (view) id. */
  scope: string;
  onScope: (viewId: string) => void;
  /** Put up: installed ⇄ planned. Take down: packed ⇄ not. */
  onToggle: (step: InstallStep) => void;
  onClearPacked: () => void;
  /** Show the item: on its photo if it is on one, otherwise on the plan. */
  onShow: (id: string) => void;
  onPhotoMode: (viewId?: string) => void;
  onInstallSheet: (viewId?: string) => void;
  onPrintDiagram: () => void;
  /** Labels (and zip ties) for everything or this photo. */
  onLabels: (viewId?: string) => void;
}

/**
 * Install day and take-down day: the plug-in order as numbered steps with big boxes to tick,
 * the next one up top, for everything or one photo. Take down runs it backwards. The screen
 * stays on while this is open.
 */
export function InstallTab(p: Props) {
  const views = p.display.views ?? [];
  const scope = views.some((v) => v.id === p.scope) ? p.scope : '';
  const up = p.direction === 'up';
  const steps = useMemo(
    () => (up ? installSteps(p.display, { viewId: scope || undefined }) : takedownSteps(p.display, { viewId: scope || undefined })),
    [p.display, up, scope],
  );
  const [hideDone, setHideDone] = useState(false);
  const awake = useWakeLock(true);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const shown = hideDone ? steps.filter((s) => !s.done) : steps;
  const word = up ? 'up' : 'packed';

  return (
    <div className="install-tab">
      <div className="it-bar">
        <div className="seg" role="group" aria-label="Install or take down">
          <button type="button" aria-pressed={up} className={up ? 'on' : ''} onClick={() => p.onDirection('up')}>
            Put up
          </button>
          <button type="button" aria-pressed={!up} className={!up ? 'on' : ''} onClick={() => p.onDirection('down')}>
            Take down
          </button>
        </div>
        {views.length > 0 && (
          <select aria-label="Which photo" value={scope} onChange={(e) => p.onScope(e.target.value)}>
            <option value="">Everything</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <span className="it-total" role="status">
          {done} of {steps.length} {word}
        </span>
      </div>
      <div className="it-progress" aria-hidden="true">
        <div style={{ width: `${steps.length ? (100 * done) / steps.length : 0}%` }} />
      </div>

      {next ? (
        <section className="it-next" aria-label="Next step">
          <span className="it-next-label">Next</span>
          <p>
            <b>{next.n}.</b> <TieDots ties={tiesFor(p.display, next.id)} trailing />{next.text}
          </p>
          <div className="it-next-actions">
            <button type="button" className="primary big" onClick={() => p.onToggle(next)}>
              ✓ {up ? `${next.id} is up` : `${next.id} is packed`}
            </button>
            <button type="button" onClick={() => p.onShow(next.id)} aria-label={`Show ${next.id}`}>
              ⌖ Show
            </button>
          </div>
        </section>
      ) : (
        steps.length > 0 && <p className="it-done">{up ? 'Everything is up. 🎉' : 'Everything is packed away. 📦'}</p>
      )}

      <div className="it-tools">
        {up && views.length > 0 && (
          <button type="button" onClick={() => p.onPhotoMode(scope || undefined)}>
            ✅ Tick off on the photo
          </button>
        )}
        <button type="button" onClick={() => p.onInstallSheet(scope || undefined)}>
          🖨 Install sheet
        </button>
        <button type="button" onClick={p.onPrintDiagram}>
          🖨 Plan diagram
        </button>
        <button type="button" onClick={() => p.onLabels(scope || undefined)}>
          🏷 Labels
        </button>
        {!up && done > 0 && (
          <button type="button" onClick={p.onClearPacked}>
            Clear packed
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide done
        </label>
      </div>

      {steps.length === 0 ? (
        <p className="muted">Nothing to {up ? 'put up' : 'take down'} yet. Add items on the Photo or Plan tab.</p>
      ) : (
        <ol className="it-steps" aria-label={up ? 'Steps to put it up' : 'Steps to take it down'}>
          {shown.map((s) => (
            <li key={s.id} className={`${s.done ? 'done' : ''}${s === next ? ' next' : ''}`}>
              <label className="it-step">
                <input type="checkbox" checked={s.done} onChange={() => p.onToggle(s)} />
                <span>
                  <b className="it-n">{s.n}.</b> <TieDots ties={tiesFor(p.display, s.id)} trailing />{s.text}
                </span>
              </label>
              <button type="button" className="it-show" onClick={() => p.onShow(s.id)} aria-label={`Show ${s.id}`}>
                ⌖
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        {up ? 'From the wall outwards. ' : 'From the far end back to the wall. '}
        {awake ? 'The screen stays on while this is open.' : ''}
      </p>
    </div>
  );
}
