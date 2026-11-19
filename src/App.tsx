import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagram } from './diagram/Diagram';
import { downloadPng, downloadSvg } from './diagram/exportImage';
import { clusterList, clusterOf, layoutDisplay } from './diagram/layout';
import { layoutToSvg } from './diagram/svg';
import { displayStats } from './model/graph';
import { type BuildResult, buildDisplay } from './outline';
import { SAMPLE_OUTLINE } from './sample';
import {
  type StoredDisplay,
  deleteDisplay,
  getDisplay,
  getMeta,
  lineIdsFromStored,
  listDisplays,
  saveDisplay,
  setMeta,
  storageAvailable,
  toStored,
} from './store/db';
import { OutlineEditor } from './ui/OutlineEditor';
import { ThemeButton } from './ui/ThemeButton';

const PHASE0_KEY = 'wiring-sketchpad.phase0.outline';
/**
 * Synchronous crash-recovery copy of the newest text. IndexedDB writes can be cut off when a
 * tab is closed right after typing; localStorage writes cannot. Cleared once IndexedDB has it.
 */
const DRAFT_KEY = 'wiring-sketchpad.unsaved';

interface Draft {
  id: string;
  text: string;
  at: number;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && typeof d.id === 'string' && typeof d.text === 'string' && typeof d.at === 'number' ? d : null;
  } catch {
    return null;
  }
}

function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: IndexedDB autosave still runs */
  }
}
const OVERALL = '__overall__';

interface Doc {
  id: string;
  text: string;
  result: BuildResult;
}

type SaveState = 'saved' | 'saving' | 'unavailable' | 'failed';

const newId = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function docFromText(id: string, text: string): Doc {
  return { id, text, result: buildDisplay(text, { id }) };
}

function docFromStored(rec: StoredDisplay): Doc {
  const lineNodeIds = lineIdsFromStored(rec);
  return {
    id: rec.id,
    text: rec.text,
    result: buildDisplay(rec.text, { previous: { display: rec.display, text: rec.text, lineNodeIds } }),
  };
}

const isPhone = () => window.matchMedia('(max-width: 720px)').matches;

function readPhase0(): string | null {
  try {
    return localStorage.getItem(PHASE0_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [save, setSave] = useState<SaveState>('saved');
  const [view, setView] = useState<string>(OVERALL);
  const [selected, setSelected] = useState<string | undefined>();
  const [outlineScroll, setOutlineScroll] = useState(0);
  const [centerRequest, setCenterRequest] = useState<number | undefined>();
  const [fitNonce, setFitNonce] = useState(0);
  const persist = useRef(true);

  const refreshList = useCallback(async () => {
    if (!persist.current) return;
    setList((await listDisplays()).map(({ id, title }) => ({ id, title })));
  }, []);

  const open = useCallback((next: Doc) => {
    setDoc(next);
    setSelected(undefined);
    // Phones start on one outlet (readable); desktops start on the whole display.
    const clusters = clusterList(next.result.display);
    setView(isPhone() && clusters.length ? clusters[0].id : OVERALL);
    setFitNonce((n) => n + 1);
    if (persist.current) void setMeta('currentId', next.id);
  }, []);

  // Load the last display; on first run migrate the Phase 0 text or seed the example.
  useEffect(() => {
    (async () => {
      persist.current = await storageAvailable();
      if (!persist.current) {
        setSave('unavailable');
        open(docFromText(newId(), readPhase0() ?? SAMPLE_OUTLINE));
        return;
      }
      const currentId = await getMeta<string>('currentId');
      let rec = currentId ? await getDisplay(currentId) : undefined;
      if (!rec) {
        const existing = await listDisplays();
        if (existing.length) rec = await getDisplay(existing[0].id);
      }
      if (rec) {
        const stored = docFromStored(rec);
        const draft = readDraft();
        if (draft && draft.id === rec.id && draft.at > rec.updatedAt && draft.text !== rec.text) {
          // Recover text typed just before the page closed.
          const recovered = {
            id: rec.id,
            text: draft.text,
            result: buildDisplay(draft.text, {
              previous: { display: stored.result.display, text: stored.text, lineNodeIds: stored.result.lineNodeIds },
            }),
          };
          open(recovered);
          await saveDisplay(toStored(recovered.text, recovered.result.display, recovered.result.lineNodeIds));
        } else open(stored);
        writeDraft(null);
      } else {
        const first = docFromText(newId(), readPhase0() ?? SAMPLE_OUTLINE);
        await saveDisplay(toStored(first.text, first.result.display, first.result.lineNodeIds));
        open(first);
      }
      await refreshList();
    })().catch(() => {
      persist.current = false;
      setSave('unavailable');
      open(docFromText(newId(), SAMPLE_OUTLINE));
    });
  }, [open, refreshList]);

  // Autosave shortly after typing stops; flush when the page is hidden or another display opens.
  const pending = useRef<Doc | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const d = pending.current;
    pending.current = null;
    if (!d || !persist.current) return;
    try {
      await saveDisplay(toStored(d.text, d.result.display, d.result.lineNodeIds));
      if (!pending.current) {
        setSave('saved');
        const draft = readDraft();
        if (draft && draft.id === d.id && draft.text === d.text) writeDraft(null);
      }
      void refreshList();
    } catch {
      setSave('failed');
    }
  }, [refreshList]);
  useEffect(() => {
    const hide = () => void flush();
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [flush]);
  const scheduleSave = (d: Doc) => {
    if (!persist.current) return;
    pending.current = d;
    setSave('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 400);
  };

  const editText = (text: string) => {
    if (!doc) return;
    const result = buildDisplay(text, {
      previous: { display: doc.result.display, text: doc.text, lineNodeIds: doc.result.lineNodeIds },
    });
    const next = { id: doc.id, text, result };
    setDoc(next);
    if (persist.current) writeDraft({ id: doc.id, text, at: Date.now() });
    scheduleSave(next);
  };

  const clusters = useMemo(() => (doc ? clusterList(doc.result.display) : []), [doc]);
  const activeView = view !== OVERALL && !clusters.some((c) => c.id === view) ? OVERALL : view;
  const layout = useMemo(
    () => (doc ? layoutDisplay(doc.result.display, { focus: activeView === OVERALL ? null : activeView }) : null),
    [doc, activeView],
  );

  const showView = (id: string) => {
    setView(id);
    setFitNonce((n) => n + 1);
  };

  const selectFromDiagram = (nodeId: string | undefined) => {
    setSelected(nodeId);
    if (nodeId) setOutlineScroll((n) => n + 1);
  };

  const selectFromOutline = (line: number) => {
    if (!doc) return;
    const nodeId = doc.result.lineFocusIds[line];
    if (!nodeId || nodeId === selected) return;
    setSelected(nodeId);
    if (layout && !layout.nodes.some((n) => n.nodeId === nodeId)) {
      const owner = clusterOf(doc.result.display, nodeId);
      if (owner) showView(owner);
    }
    setCenterRequest((n) => (n ?? 0) + 1);
  };

  const newDisplay = async () => {
    await flush();
    const d = docFromText(newId(), `# New display ${new Date().getFullYear()}\nO01 Outlet\n`);
    if (persist.current) await saveDisplay(toStored(d.text, d.result.display, d.result.lineNodeIds));
    open(d);
    await refreshList();
  };

  const switchTo = async (id: string) => {
    await flush();
    const rec = await getDisplay(id);
    if (rec) open(docFromStored(rec));
  };

  const removeCurrent = async () => {
    if (!doc || !persist.current) return;
    if (!window.confirm(`Delete "${doc.result.display.title}" from this browser? This cannot be undone.`)) return;
    pending.current = null;
    window.clearTimeout(saveTimer.current);
    writeDraft(null);
    await deleteDisplay(doc.id);
    const rest = await listDisplays();
    if (rest.length) await switchTo(rest[0].id);
    else await newDisplay();
    await refreshList();
  };

  if (!doc || !layout) return <div className="loading">Loading…</div>;

  const title = doc.result.display.title;
  const exportSvg = () => downloadSvg(layoutToSvg(layout, title), title);
  const exportPng = () => downloadPng(layoutToSvg(layout, title), title).catch((e: Error) => alert(e.message));
  const stats = displayStats(doc.result.display);
  const highlight = selected ? doc.result.lineNodeIds.indexOf(selected) : -1;
  const options = list.some((d) => d.id === doc.id) ? list : [{ id: doc.id, title }, ...list];

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-title">
          <select aria-label="Display" value={doc.id} onChange={(e) => void switchTo(e.target.value)} disabled={!persist.current}>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === doc.id ? title : d.title}
              </option>
            ))}
          </select>
          <span className="counts">
            {stats.nodes} items · {stats.powerLinks} power · {stats.signalLinks} signal
          </span>
        </div>
        <div className="bar-actions">
          <span className={`save save-${save}`} role="status">
            {save === 'saved'
              ? 'Saved on this device'
              : save === 'saving'
                ? 'Saving…'
                : save === 'failed'
                  ? 'Not saved: storage error'
                  : 'Not saving: storage unavailable'}
          </span>
          <button type="button" onClick={() => void newDisplay()} disabled={!persist.current}>
            New
          </button>
          <button type="button" onClick={() => void removeCurrent()} disabled={!persist.current}>
            Delete
          </button>
          <ThemeButton />
        </div>
      </header>

      <nav className="views" aria-label="Diagram view">
        <button type="button" className={activeView === OVERALL ? 'chip on' : 'chip'} aria-pressed={activeView === OVERALL} onClick={() => showView(OVERALL)}>
          Overall
        </button>
        {clusters.map((c) => (
          <button key={c.id} type="button" className={activeView === c.id ? 'chip on' : 'chip'} aria-pressed={activeView === c.id} onClick={() => showView(c.id)} title={c.title}>
            {c.title}
          </button>
        ))}
      </nav>

      <main className="split">
        <section className="pane-diagram" aria-label="Diagram">
          <Diagram
            layout={layout}
            selectedId={selected}
            onSelect={selectFromDiagram}
            fitKey={`${doc.id}:${activeView}:${fitNonce}`}
            centerRequest={centerRequest}
            onExportSvg={exportSvg}
            onExportPng={exportPng}
          />
        </section>
        <section className="pane-outline" aria-label="Outline">
          <OutlineEditor
            value={doc.text}
            onChange={editText}
            diagnostics={doc.result.diagnostics}
            highlightLine={highlight >= 0 ? highlight : undefined}
            scrollRequest={outlineScroll}
            onCursorLine={selectFromOutline}
          />
          <p className="note">
            Two spaces = plugged into the line above. Planning aid only: watts and loads are estimates, not an electrical
            inspection.
          </p>
        </section>
      </main>
    </div>
  );
}
