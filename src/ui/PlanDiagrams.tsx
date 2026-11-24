import { useEffect, useMemo, useState } from 'react';
import { type LayoutDirection, clusterList, clusterMembers, layoutDisplay } from '../diagram/layout';
import { layoutToSvg } from '../diagram/svg';
import { photoItems } from '../export/takeoff';
import type { Display } from '../model/types';

/** The plan diagram, one outlet at a time, as pictures to print (always light colours). */
export function PlanDiagrams({ display, viewId, direction = 'wide', onePerPage }: { display: Display; viewId?: string; direction?: LayoutDirection; onePerPage?: boolean }) {
  const figures = useMemo(() => {
    const only = viewId ? photoItems(display, viewId) : undefined;
    const members = new Map(clusterMembers(display).map((g) => [g.root, g.members]));
    return clusterList(display)
      .filter((c) => !only || (c.id === 'unplugged' ? [...only].some((id) => !display.links.some((l) => l.to === id)) : (members.get(c.id) ?? []).some((id) => only.has(id))))
      .map((c) => {
        const svg = layoutToSvg(layoutDisplay(display, { focus: c.id, direction }), `${display.title} · ${c.title}`);
        return { id: c.id, title: c.title, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
      });
  }, [display, viewId, direction]);
  return (
    <>
      {figures.map((f) => (
        <figure key={f.id} className={`plan-figure${onePerPage ? ' page' : ''}`}>
          <img src={f.src} alt={`Plan diagram: ${f.title}`} />
        </figure>
      ))}
    </>
  );
}

interface PrintProps {
  display: Display;
  onClose: () => void;
}

const OPTS_KEY = 'wiring-sketchpad.diagramPrint';
interface Opts {
  onePerPage: boolean;
  landscape: boolean;
  direction: LayoutDirection;
}
const readOpts = (): Opts => {
  try {
    return { onePerPage: true, landscape: true, direction: 'wide', ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') };
  } catch {
    return { onePerPage: true, landscape: true, direction: 'wide' };
  }
};

/** Print the plan diagram (or save it as a PDF): one outlet per page, sideways or upright. */
export function DiagramPrint({ display, onClose }: PrintProps) {
  const [opts, setOpts] = useState(readOpts);
  const set = (patch: Partial<Opts>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(next));
      } catch {
        // private mode: this visit only
      }
      return next;
    });
  // Wide diagrams print best sideways; the browser follows this for the print dialog.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@media print { @page { size: ${opts.landscape ? 'landscape' : 'portrait'}; margin: 10mm; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [opts.landscape]);
  return (
    <div className="labels-page diagram-page" role="dialog" aria-modal="true" aria-label="Print the plan diagram">
      <div className="labels-controls no-print">
        <div className="labels-head">
          <strong>Plan diagram · {display.title}</strong>
          <button type="button" onClick={onClose} aria-label="Close plan diagram">
            ✕
          </button>
        </div>
        <div className="labels-opts">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={opts.direction === 'wide'} className={opts.direction === 'wide' ? 'on' : ''} onClick={() => set({ direction: 'wide', landscape: true })}>
              Wide
            </button>
            <button type="button" aria-pressed={opts.direction === 'tall'} className={opts.direction === 'tall' ? 'on' : ''} onClick={() => set({ direction: 'tall', landscape: false })}>
              Tall
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={opts.onePerPage} onChange={(e) => set({ onePerPage: e.target.checked })} />
            One outlet per page
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.landscape} onChange={(e) => set({ landscape: e.target.checked })} />
            Sideways (landscape)
          </label>
        </div>
        <div className="labels-actions">
          <button type="button" className="primary" onClick={() => window.print()}>
            🖨 Print or save as PDF
          </button>
          <span className="muted small">Each outlet's diagram fits the page width.</span>
        </div>
      </div>
      <article className="install-doc diagram-doc">
        <PlanDiagrams display={display} direction={opts.direction} onePerPage={opts.onePerPage} />
      </article>
    </div>
  );
}
