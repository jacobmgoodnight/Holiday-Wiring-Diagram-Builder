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
import { type ChecklistMode, type ChecklistRow, checklist } from './model/checklist';
import { displayStats } from './model/graph';
import { type Change, compareDisplays, copyForNextYear, nextTitle } from './model/season';
import { type History, initHistory, push, redo, undo } from './model/history';
import type { Display, NodeKind } from './model/types';
import { type BuildResult, buildDisplay } from './outline';
import { syncFromModel } from './outline/sync';
import { type Preset, presetById } from './presets/presets';
import { noteUsed } from './presets/prefs';
import { SAMPLE_OUTLINE } from './sample';
import {
  type Snapshot,
  type StoredDisplay,
  addSnapshot,
  deleteDisplay,
  listSnapshots,
  getDisplay,
  getMeta,
  lineIdsFromStored,
  listDisplays,
  saveDisplay,
  setMeta,
  storageAvailable,
  toStored,
} from './store/db';
import { Checklist } from './ui/Checklist';
import { ChangesDialog, CopyDialog, RestoreDialog } from './ui/Dialogs';
import { NodePanel } from './ui/NodePanel';
import { OutlineEditor } from './ui/OutlineEditor';
import { Palette } from './ui/Palette';
import { PresetPicker } from './ui/PresetPicker';
import { ThemeButton } from './ui/ThemeButton';

const PHASE0_KEY = 'wiring-sketchpad.phase0.outline';
const OVERALL = '__overall__';
/** Automatic restore points: at most one per display per this interval while editing. */
const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;
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
  const [mode, setMode] = useState<'plan' | 'checklist'>('plan');
  const [clMode, setClMode] = useState<ChecklistMode>('install');
  const [hideDone, setHideDone] = useState(false);
  const [tag, setTag] = useState('');
  const [dialog, setDialog] = useState<null | 'restore' | 'copy' | 'changes'>(null);
  const [changes, setChanges] = useState<{ source: string | null; list: Change[] | null } | null>(null);
  const lastAuto = useRef(new Map<string, number>());
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
    setDialog(null);
    setTag('');
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

  const snapshotOf = (d: Doc, reason: Snapshot['reason']): Omit<Snapshot, 'id'> => ({
    displayId: d.id,
    at: Date.now(),
    reason,
    title: d.result.display.title,
    itemCount: Object.keys(d.result.display.nodes).length,
    text: d.text,
    display: d.result.display,
    lineNodeIds: d.result.lineNodeIds.map((x) => x ?? null),
  });

  const commit = (next: Doc, coalesceKey?: string) => {
    if (!hist || busy) return;
    // Automatic restore point of the state *before* this edit: on the first edit after
    // opening, then at most every 10 minutes.
    const now = Date.now();
    if (persist.current && hist.present.id === next.id && now - (lastAuto.current.get(next.id) ?? 0) > AUTO_SNAPSHOT_MS) {
      lastAuto.current.set(next.id, now);
      void addSnapshot(snapshotOf(hist.present, 'auto')).catch(() => undefined);
    }
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
  // A message never covers a dialog the user just opened.
  useEffect(() => {
    if (dialog || picker) setToast(null);
  }, [dialog, picker]);
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
      // In a copy of last year's display, anything added is new this year.
      (d) => addNode(d, { ...preset, isNew: d.copiedFrom ? true : undefined }, target),
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

  const saveRestorePoint = async () => {
    if (!doc) return;
    await addSnapshot(snapshotOf(doc, 'manual'));
    showToast('Restore point saved on this device');
  };

  const restore = (snap: Snapshot) => {
    if (!doc) return;
    void addSnapshot(snapshotOf(doc, 'before-restore'));
    const prevIds = snap.lineNodeIds.map((x) => x ?? undefined);
    const restoredDisplay = { ...snap.display, id: doc.id };
    const result = buildDisplay(snap.text, { previous: { display: restoredDisplay, text: snap.text, lineNodeIds: prevIds } });
    commit({ id: doc.id, text: snap.text, result });
    setDialog(null);
    setSelected(undefined);
    setFitNonce((n) => n + 1);
    showToast(`Restored the version from ${new Date(snap.at).toLocaleString()}`, true);
  };

  const copyDisplay = (title: string) =>
    whileBusy(async () => {
      if (!doc) return;
      await flush();
      const copy = copyForNextYear(doc.result.display, newId(), title);
      const synced = syncFromModel(copy);
      const d = { id: copy.id, text: synced.text, result: synced.result };
      if (persist.current) await saveDisplay(toStored(d.text, d.result.display, d.result.lineNodeIds));
      open(d);
      await refreshList();
      showToast(`Copied. "${title}" starts with everything planned.`);
    });

  const openChanges = async () => {
    if (!doc?.result.display.copiedFrom) return;
    const src = await getDisplay(doc.result.display.copiedFrom);
    setChanges(src ? { source: src.title, list: compareDisplays(src.display, doc.result.display) } : { source: null, list: null });
    setDialog('changes');
  };

  const showOnDiagram = (id: string) => {
    if (!doc) return;
    setMode('plan');
    setDialog(null);
    setSelected(id);
    const owner = clusterOf(doc.result.display, id);
    if (view !== OVERALL && owner) setView(owner);
    setFitNonce((n) => n + 1);
    setCenterRequest((n) => (n ?? 0) + 1);
    setOutlineScroll((n) => n + 1);
  };

  const toggleRow = (r: ChecklistRow) => {
    if (clMode === 'install') act((d) => updateNode(d, r.id, { status: r.done ? 'planned' : 'installed' }));
    else act((d) => updateNode(d, r.id, { packed: r.done ? undefined : true }));
  };

  const closeMenu = (e: React.MouseEvent) => {
    const det = (e.currentTarget as HTMLElement).closest('details');
    if (det) det.open = false;
  };

  const removeCurrent = async () => {
    if (!doc || !persist.current) return;
    if (!window.confirm(`Delete "${doc.result.display.title}" and its restore points from this browser? This cannot be undone.`)) return;
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
  const allTags = [...new Set(Object.values(display.nodes).flatMap((n) => n.tags))].sort();
  const dimmed = tag ? new Set(Object.values(display.nodes).filter((n) => !n.tags.includes(tag)).map((n) => n.id)) : undefined;
  const groups = mode === 'checklist' ? checklist(display, clMode) : [];

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
          <details className="menu">
            <summary aria-label="More display actions">⋯</summary>
            <div className="menu-list" role="menu">
              <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); setDialog('copy'); }}>
                Copy for next year…
              </button>
              <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); setDialog('restore'); }}>
                Restore points…
              </button>
              {display.copiedFrom && (
                <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); void openChanges(); }}>
                  Changes since last year…
                </button>
              )}
              <button type="button" role="menuitem" className="danger" disabled={!persist.current} onClick={(e) => { closeMenu(e); void removeCurrent(); }}>
                Delete this display
              </button>
            </div>
          </details>
          <ThemeButton />
        </div>
      </header>

      <nav className="views" aria-label="View">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" className={mode === 'plan' ? 'on' : ''} aria-pressed={mode === 'plan'} onClick={() => { setMode('plan'); setFitNonce((n) => n + 1); }}>
            Plan
          </button>
          <button type="button" className={mode === 'checklist' ? 'on' : ''} aria-pressed={mode === 'checklist'} onClick={() => { setMode('checklist'); setMoving(undefined); }}>
            Checklist
          </button>
        </div>
        {mode === 'plan' && (
          <>
            <button type="button" className={activeView === OVERALL ? 'chip on' : 'chip'} aria-pressed={activeView === OVERALL} onClick={() => showView(OVERALL)}>
              Overall
            </button>
            {clusters.map((c) => (
              <button key={c.id} type="button" className={activeView === c.id ? 'chip on' : 'chip'} aria-pressed={activeView === c.id} onClick={() => showView(c.id)} title={c.title}>
                {c.title}
              </button>
            ))}
            {allTags.length > 0 && (
              <select className="tag-filter" aria-label="Highlight tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </nav>

      {mode === 'checklist' ? (
        <main className="field-mode">
          <Checklist
            groups={groups}
            mode={clMode}
            onMode={setClMode}
            hideDone={hideDone}
            onHideDone={setHideDone}
            onToggle={toggleRow}
            onVerify={(r) => act((d) => updateNode(d, r.id, { status: r.status === 'verified' ? 'installed' : 'verified' }))}
            onShow={showOnDiagram}
            onResetPacked={() =>
              act((d) => {
                let out = d;
                for (const n of Object.values(d.nodes)) if (n.packed) out = updateNode(out, n.id, { packed: undefined }).display;
                return { display: out };
              })
            }
          />
        </main>
      ) : (
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
            dimmed={dimmed}
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
            Two spaces = plugged into the line above. A planning aid, not an electrical inspection.
          </p>
        </section>
      </main>
      )}

      {dialog === 'restore' && doc && (
        <RestoreDialog load={() => listSnapshots(doc.id)} onSaveNow={saveRestorePoint} onRestore={restore} onClose={() => setDialog(null)} />
      )}
      {dialog === 'copy' && (
        <CopyDialog from={title} suggested={nextTitle(title)} onCopy={(t) => void copyDisplay(t)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'changes' && changes && (
        <ChangesDialog source={changes.source} changes={changes.list} onShow={showOnDiagram} onClose={() => setDialog(null)} />
      )}
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
