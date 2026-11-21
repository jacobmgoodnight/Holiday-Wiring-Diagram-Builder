import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagram } from './diagram/Diagram';
import { downloadPng, downloadSvg } from './diagram/exportImage';
import { clusterList, clusterOf, layoutDisplay } from './diagram/layout';
import { layoutToSvg } from './diagram/svg';
import {
  type ActionResult,
  ActionError,
  type NodePatch,
  type Target,
  addNode,
  changeKind,
  deleteNode,
  homeLink,
  replug,
  subtreeIds,
  unplug,
  updateNode,
} from './model/actions';
import { displayStats } from './model/graph';
import { type History, initHistory, push, redo, undo } from './model/history';
import type { Display, NodeKind } from './model/types';
import { type BuildResult, buildDisplay } from './outline';
import { syncFromModel } from './outline/sync';
import { type Preset, presetById } from './presets/presets';
import { noteUsed } from './presets/prefs';
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
import { NodePanel } from './ui/NodePanel';
import { OutlineEditor } from './ui/OutlineEditor';
import { Palette } from './ui/Palette';
import { PresetPicker } from './ui/PresetPicker';
import { ThemeButton } from './ui/ThemeButton';

const PHASE0_KEY = 'wiring-sketchpad.phase0.outline';
const OVERALL = '__overall__';
/**
 * Synchronous crash-recovery copy of the newest text. IndexedDB writes can be cut off when a
 * tab is closed right after an edit; localStorage writes cannot. Cleared once IndexedDB has it.
 */
const DRAFT_KEY = 'wiring-sketchpad.unsaved';

interface Draft {
  id: string;
  text: string;
  at: number;
}

interface Doc {
  id: string;
  text: string;
  result: BuildResult;
}

type SaveState = 'saved' | 'saving' | 'unavailable' | 'failed';

interface Toast {
  message: string;
  canUndo?: boolean;
  key: number;
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
const finePointer = () => window.matchMedia('(pointer: fine)').matches;

function readPhase0(): string | null {
  try {
    return localStorage.getItem(PHASE0_KEY);
  } catch {
    return null;
  }
}

function targetTitle(t: Target): string {
  if (t.parent === null) return 'Add an outlet or item';
  return t.port ? `Plug into ${t.parent} · socket ${t.port}` : `Plug into ${t.parent}`;
}

export function App() {
  const [hist, setHist] = useState<History<Doc> | null>(null);
  const doc = hist?.present ?? null;
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [save, setSave] = useState<SaveState>('saved');
  const [view, setView] = useState<string>(OVERALL);
  const [selected, setSelected] = useState<string | undefined>();
  const [outlineScroll, setOutlineScroll] = useState(0);
  const [centerRequest, setCenterRequest] = useState<number | undefined>();
  const [fitNonce, setFitNonce] = useState(0);
  const [picker, setPicker] = useState<Target | null>(null);
  const [moving, setMoving] = useState<string | undefined>();
  const [toast, setToast] = useState<Toast | null>(null);
  /** True while another display is being opened: edits wait so they cannot land in the wrong one. */
  const [busy, setBusy] = useState(false);
  const persist = useRef(true);
  const canDrag = useMemo(finePointer, []);

  const refreshList = useCallback(async () => {
    if (!persist.current) return;
    setList((await listDisplays()).map(({ id, title }) => ({ id, title })));
  }, []);

  const open = useCallback((next: Doc) => {
    setHist(initHistory(next));
    setSelected(undefined);
    setMoving(undefined);
    setPicker(null);
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
          // Recover an edit made just before the page closed.
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

  // Autosave shortly after edits stop; flush when the page is hidden or another display opens.
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
    writeDraft({ id: d.id, text: d.text, at: Date.now() });
    pending.current = d;
    setSave('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 400);
  };

  const commit = (next: Doc, coalesceKey?: string) => {
    if (!hist || busy) return;
    // Never apply an edit to a different display than the one it was made in.
    setHist((h) => (h && h.present.id === next.id ? push(h, next, { coalesceKey }) : h));
    scheduleSave(next);
  };

  const editText = (text: string) => {
    if (!doc) return;
    const result = buildDisplay(text, {
      previous: { display: doc.result.display, text: doc.text, lineNodeIds: doc.result.lineNodeIds },
    });
    commit({ id: doc.id, text, result }, 'text');
  };

  const showToast = (message: string, canUndo = false) => setToast({ message, canUndo, key: Date.now() });
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** Run a graph action, write the outline from the model, and record one undo step. */
  const act = (fn: (d: Display) => ActionResult, after?: (r: ActionResult, next: Doc) => void): boolean => {
    if (!doc) return false;
    try {
      const r = fn(doc.result.display);
      const synced = syncFromModel(r.display);
      const next = { id: doc.id, text: synced.text, result: synced.result };
      commit(next);
      if (r.warning) showToast(r.warning, true);
      after?.(r, next);
      return true;
    } catch (e) {
      if (e instanceof ActionError) {
        showToast(e.message);
        return false;
      }
      throw e;
    }
  };

  const reveal = (nodeId: string | undefined, next: Doc) => {
    setSelected(nodeId);
    if (!nodeId) return;
    const owner = clusterOf(next.result.display, nodeId);
    if (view !== OVERALL && owner && owner !== view) {
      setView(owner);
      setFitNonce((n) => n + 1);
    }
    setCenterRequest((n) => (n ?? 0) + 1);
    setOutlineScroll((n) => n + 1);
  };

  const addPreset = (preset: Preset, target: Target) => {
    noteUsed(preset.id);
    act(
      (d) => addNode(d, preset, target),
      (r, next) => reveal(r.nodeId, next),
    );
  };

  const doReplug = (nodeId: string, target: Target) => {
    setMoving(undefined);
    act(
      (d) => replug(d, nodeId, target),
      (r, next) => {
        reveal(r.nodeId, next);
        if (!r.warning) showToast(`Moved ${nodeId} into ${target.parent}${target.port ? ` socket ${target.port}` : ''}`, true);
      },
    );
  };

  const doUndo = () => {
    if (!hist?.past.length) return;
    const h = undo(hist);
    setHist(h);
    scheduleSave(h.present);
    setMoving(undefined);
  };
  const doRedo = () => {
    if (!hist?.future.length) return;
    const h = redo(hist);
    setHist(h);
    scheduleSave(h.present);
  };

  // Undo/redo shortcuts work across both editors (the outline's own undo would skip diagram edits).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inOtherField = !!el && /^(INPUT|SELECT)$/.test(el.tagName);
      const inPanelText = el?.tagName === 'TEXTAREA' && el.getAttribute('aria-label') !== 'Outline';
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !inOtherField && !inPanelText) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          doUndo();
        } else if ((k === 'z' && e.shiftKey) || k === 'y') {
          e.preventDefault();
          doRedo();
        }
      }
      if (e.key === 'Escape' && !picker) {
        if (moving) setMoving(undefined);
        else if (selected && !inOtherField) setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const display = doc?.result.display;
  const clusters = useMemo(() => (display ? clusterList(display) : []), [display]);
  const activeView = view !== OVERALL && !clusters.some((c) => c.id === view) ? OVERALL : view;
  const layout = useMemo(() => (display ? layoutDisplay(display, { focus: activeView === OVERALL ? null : activeView }) : null), [display, activeView]);
  const subtreeOf = useCallback((id: string) => (display ? subtreeIds(display, id) : new Set<string>()), [display]);
  const openPicker = useCallback((t: Target) => setPicker(t), []);

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

  const whileBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const newDisplay = () =>
    whileBusy(async () => {
      await flush();
      const d = docFromText(newId(), `# New display ${new Date().getFullYear()}\nO01 Outlet\n`);
      if (persist.current) await saveDisplay(toStored(d.text, d.result.display, d.result.lineNodeIds));
      open(d);
      await refreshList();
    });

  const switchTo = (id: string) =>
    whileBusy(async () => {
      await flush();
      const rec = await getDisplay(id);
      if (rec) open(docFromStored(rec));
    });

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

  if (!doc || !layout || !display || !hist) return <div className="loading">Loading…</div>;

  const title = display.title;
  const exportSvg = () => downloadSvg(layoutToSvg(layout, title), title);
  const exportPng = () => downloadPng(layoutToSvg(layout, title), title).catch((e: Error) => alert(e.message));
  const stats = displayStats(display);
  const highlight = selected ? doc.result.lineNodeIds.indexOf(selected) : -1;
  const options = list.some((d) => d.id === doc.id) ? list : [{ id: doc.id, title }, ...list];
  const selNode = selected ? display.nodes[selected] : undefined;

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
          {canDrag && <Palette selectedId={selected} onPick={(p) => selected && addPreset(p, { parent: selected })} />}
          <Diagram
            layout={layout}
            selectedId={selected}
            onSelect={selectFromDiagram}
            fitKey={`${doc.id}:${activeView}:${fitNonce}`}
            centerRequest={centerRequest}
            onAdd={openPicker}
            onReplug={doReplug}
            movingId={moving}
            onCancelMove={() => setMoving(undefined)}
            subtreeOf={subtreeOf}
            onDropPreset={(id, target) => {
              const p = presetById(id);
              if (p) addPreset(p, target);
            }}
            canDrag={canDrag}
            undo={{ can: hist.past.length > 0, run: doUndo }}
            redo={{ can: hist.future.length > 0, run: doRedo }}
            onExportSvg={exportSvg}
            onExportPng={exportPng}
          />
          {selNode && !moving && (
            <NodePanel
              key={selNode.id}
              node={selNode}
              below={subtreeOf(selNode.id).size - 1}
              plugged={!!homeLink(display, selNode.id)}
              onPatch={(patch: NodePatch) => act((d) => updateNode(d, selNode.id, patch))}
              onKind={(kind: NodeKind) => act((d) => changeKind(d, selNode.id, kind), (r) => setSelected(r.nodeId))}
              onAddChild={() => setPicker({ parent: selNode.id })}
              onMove={() => {
                setMoving(selNode.id);
                showToast(`Now tap where ${selNode.id} should plug in`);
              }}
              onUnplug={() => act((d) => unplug(d, selNode.id), (r, next) => reveal(r.nodeId, next))}
              onDelete={(withChildren) => {
                act((d) => deleteNode(d, selNode.id, withChildren));
                setSelected(undefined);
                showToast(`Deleted ${selNode.id}${withChildren ? ' and everything below it' : ''}`, true);
              }}
              onClose={() => setSelected(undefined)}
            />
          )}
        </section>
        <section className="pane-outline" aria-label="Outline">
          <OutlineEditor
            value={doc.text}
            readOnly={busy}
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

      {picker && (
        <PresetPicker
          title={targetTitle(picker)}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            const t = picker;
            setPicker(null);
            addPreset(p, t);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status" key={toast.key}>
          <span>{toast.message}</span>
          {toast.canUndo && (
            <button
              type="button"
              onClick={() => {
                doUndo();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
