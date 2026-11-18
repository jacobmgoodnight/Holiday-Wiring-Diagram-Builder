import { useMemo, useRef, useState } from 'react';
import { displayStats, socketLabels, unusedSockets } from './model/graph';
import type { Diagnostic, Display, Link } from './model/types';
import { type BuildResult, buildDisplay } from './outline';
import { SAMPLE_OUTLINE } from './sample';

const STORAGE_KEY = 'wiring-sketchpad.phase0.outline';

function loadText(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SAMPLE_OUTLINE;
  } catch {
    return SAMPLE_OUTLINE;
  }
}

function saveText(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* private mode or storage blocked: the outline still works for this visit */
  }
}

export function App() {
  const [text, setText] = useState(loadText);
  const prev = useRef<{ result: BuildResult; text: string } | null>(null);

  const result = useMemo(() => {
    const p = prev.current;
    const r = buildDisplay(text, p ? { previous: { display: p.result.display, text: p.text, lineNodeIds: p.result.lineNodeIds } } : {});
    prev.current = { result: r, text };
    return r;
  }, [text]);

  const stats = displayStats(result.display);
  const problems = result.diagnostics.filter((d) => d.severity !== 'info');

  return (
    <div className="app">
      <header className="top">
        <h1>{result.display.title}</h1>
        <p className="counts">
          {stats.nodes} items · {stats.powerLinks} power links · {stats.signalLinks} signal links
          {problems.length > 0 && <span className="warn-count"> · {problems.length} to check</span>}
        </p>
      </header>
      <main className="split">
        <section className="pane">
          <label className="pane-title" htmlFor="outline">
            Outline <span className="hint">two spaces = plugged into the line above</span>
          </label>
          <textarea
            id="outline"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              saveText(e.target.value);
            }}
          />
          <Diagnostics items={result.diagnostics} />
          <div className="row">
            <button type="button" onClick={() => { setText(SAMPLE_OUTLINE); saveText(SAMPLE_OUTLINE); }}>
              Reset to example
            </button>
          </div>
        </section>
        <section className="pane">
          <h2 className="pane-title">Parsed power tree</h2>
          <Tree display={result.display} />
        </section>
      </main>
      <footer className="note">
        Planning aid only. Wattage and load figures are estimates, not an electrical inspection.
        Phase 0 preview: the diagram arrives in Phase 1.
      </footer>
    </div>
  );
}

function Diagnostics({ items }: { items: Diagnostic[] }) {
  if (!items.length) return <p className="diag ok">No problems found.</p>;
  return (
    <ul className="diag">
      {items.map((d, i) => (
        <li key={i} className={d.severity}>
          <strong>Line {d.line}</strong> {d.message}
        </li>
      ))}
    </ul>
  );
}

function Tree({ display }: { display: Display }) {
  const homed = new Set(display.links.filter((l) => l.to && (l.kind === 'power' || l.owns)).map((l) => l.to!));
  const roots = Object.values(display.nodes)
    .filter((n) => !homed.has(n.id))
    .sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9));
  return (
    <ul className="tree">
      {roots.map((n) => (
        <NodeRow key={n.id} display={display} id={n.id} seen={new Set()} />
      ))}
    </ul>
  );
}

function NodeRow({ display, id, link, port, seen }: { display: Display; id: string; link?: Link; port?: string; seen: Set<string> }) {
  const node = display.nodes[id];
  if (!node || seen.has(id)) return null;
  seen.add(id);
  const children = display.links.filter((l) => l.from === id).sort((a, b) => a.seq - b.seq);
  const labels = socketLabels(display, id);
  const unused = unusedSockets(display, id);
  const meta = [
    node.qty !== undefined && `x${node.qty}`,
    node.lengthFt !== undefined && `${node.lengthApprox ? '~' : ''}${node.lengthFt}ft`,
    node.watts !== undefined && `${node.watts}W`,
    node.amps !== undefined && `${node.amps}A`,
    node.breakerAmps !== undefined && `${node.breakerAmps}A breaker`,
    node.gfci && 'GFCI',
    node.status !== 'planned' && node.status,
    ...node.tags,
  ].filter(Boolean);
  return (
    <li>
      <div className={`node kind-${node.kind}${link?.kind === 'signal' ? ' via-signal' : ''}`}>
        {port && <span className="port">{port}</span>}
        {link?.kind === 'signal' && <span className="sig">{link.signalType?.toUpperCase()}</span>}
        <span className="id">{node.id}</span>
        <span className="label">{node.label || <em>(no name)</em>}</span>
        {meta.length > 0 && <span className="meta">{meta.join(' · ')}</span>}
        {unused > 0 && <span className="unused">{unused} unused</span>}
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((l) => {
            if (l.to === null)
              return (
                <li key={l.id}>
                  <div className="node empty">
                    {l.port && <span className="port">{l.port}</span>}Unused socket
                  </div>
                </li>
              );
            if (l.kind === 'signal' && !l.owns)
              return (
                <li key={l.id}>
                  <div className="node via-signal ref">
                    <span className="sig">{l.signalType?.toUpperCase()}</span>→ {l.to} {display.nodes[l.to]?.label}
                  </div>
                </li>
              );
            return <NodeRow key={l.id} display={display} id={l.to} link={l} port={labels.get(l.id)} seen={seen} />;
          })}
        </ul>
      )}
    </li>
  );
}
