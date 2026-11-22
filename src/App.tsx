import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagram } from './diagram/Diagram';
import { downloadPng, downloadSvg, downloadText, fileSlug } from './diagram/exportImage';
import { BackupError, makeBackup, parseBackup, planImport } from './export/backup';
import { displayToCsv } from './export/csv';
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
import type { Display, NodeKind, Placement } from './model/types';
import { type BuildResult, buildDisplay } from './outline';
import { syncFromModel } from './outline/sync';
import { presetFromNode, presetText, suggest } from './presets/custom';
import { PRESETS, type Preset, presetById } from './presets/presets';
import { noteUsed } from './presets/prefs';
import { SAMPLE_OUTLINE } from './sample';
import {
  type Snapshot,
  type StoredDisplay,
  addSnapshot,
  allDisplays,
  deleteCustomPreset,
  deleteDisplay,
  listCustomPresets,
  saveCustomPreset,
  listSnapshots,
  allPhotos,
  getDisplay,
  getPhoto,
  savePhoto,
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
import { LabelSheet } from './ui/LabelSheet';
import { NodePanel } from './ui/NodePanel';
import { addPlacedNode, addView, removeView, setPlacement, updateView } from './photo/actions';
import { type Pt, runLengthFt } from './photo/geometry';
import { base64ToBlob, blobToBase64, prepareImage } from './photo/image';
import type { PhotoIntent } from './photo/PhotoEditor';
import { PhotoPane } from './photo/PhotoPane';
import { OutlineEditor } from './ui/OutlineEditor';
import { Palette } from './ui/Palette';
import { PresetPicker } from './ui/PresetPicker';
import { Sheet } from './ui/Sheet';
import { ThemeButton } from './ui/ThemeButton';

const PHASE0_KEY = 'wiring-sketchpad.phase0.outline';
/** Load categories drawn as light runs on the photo (others are placed as markers). */
const LIGHT_RUNS = new Set(['c9', 'mini', 'icicle', 'pixel', 'pathway', 'tree']);
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
  /** In-page confirmation (browser confirm() is unavailable in some viewers and jarring on phones). */
  const [ask, setAsk] = useState<{ title: string; message: string; confirm: string; resolve: (ok: boolean) => void } | null>(null);
  const confirmInApp = (title: string, message: string, confirm: string) =>
    new Promise<boolean>((resolve) => setAsk({ title, message, confirm, resolve }));
  /** True while another display is being opened: edits wait so they cannot land in the wrong one. */
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'plan' | 'photo' | 'checklist'>('plan');
  const [viewId, setViewId] = useState<string | undefined>();
  const [intent, setIntent] = useState<PhotoIntent | undefined>();
  const [photoPicker, setPhotoPicker] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const loadingPhotos = useRef(new Set<string>());
  const [clMode, setClMode] = useState<ChecklistMode>('install');
  const [hideDone, setHideDone] = useState(false);
  const [tag, setTag] = useState('');
  const [dialog, setDialog] = useState<null | 'restore' | 'copy' | 'changes'>(null);
  const [changes, setChanges] = useState<{ source: string | null; list: Change[] | null } | null>(null);
  const lastAuto = useRef(new Map<string, number>());
  const [custom, setCustom] = useState<Preset[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const refreshCustom = useCallback(async () => {
    if (persist.current) setCustom(await listCustomPresets());
  }, []);
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
    setIntent(undefined);
    setViewId(undefined);
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
      await refreshCustom();
    })().catch(() => {
      persist.current = false;
      setSave('unavailable');
      open(docFromText(newId(), SAMPLE_OUTLINE));
    });
  }, [open, refreshList, refreshCustom]);

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
      if (e.key === 'Escape' && !picker && !photoPicker) {
        if (intent) setIntent(undefined);
        else if (moving) setMoving(undefined);
        else if (selected && !inOtherField) setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const display = doc?.result.display;
  // Object URLs for this display's photos (loaded once, kept for the session).
  useEffect(() => {
    for (const v of display?.views ?? []) {
      if (photoUrls[v.photoId] || loadingPhotos.current.has(v.photoId)) continue;
      loadingPhotos.current.add(v.photoId);
      void getPhoto(v.photoId).then((p) => {
        if (p) setPhotoUrls((m) => ({ ...m, [v.photoId]: URL.createObjectURL(p.blob) }));
      });
    }
  }, [display?.views, photoUrls]);
  const views = display?.views ?? [];
  const photoView = views.find((v) => v.id === viewId) ?? views[0];
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

  const saveAsPreset = async (nodeId: string, name: string, icon: string) => {
    if (!display) return;
    const p = presetFromNode(display.nodes[nodeId], name, icon, `custom-${Date.now().toString(36)}`);
    await saveCustomPreset(p);
    await refreshCustom();
    showToast(`Saved "${p.name}" to My presets`);
  };

  const deletePreset = async (p: Preset) => {
    if (!(await confirmInApp('Remove preset', `Remove "${p.name}" from My presets? Items already in your displays are not changed.`, 'Remove preset'))) return;
    await deleteCustomPreset(p.id);
    await refreshCustom();
  };

  const exportCsv = () => {
    if (!display) return;
    downloadText(displayToCsv(display), `${fileSlug(display.title)}.csv`, 'text/csv');
  };

  const exportBackup = async () => {
    await flush();
    const backup = makeBackup(await allDisplays(), new Date(), await exportBackupPhotos());
    const day = new Date().toISOString().slice(0, 10);
    downloadText(JSON.stringify(backup, null, 1), `wiring-sketchpad-backup-${day}.json`, 'application/json');
    showToast(`Backup of ${backup.displays.length} display${backup.displays.length === 1 ? '' : 's'} downloaded. Keep it somewhere safe.`);
  };

  const importBackup = async (file: File) => {
    try {
      const backup = parseBackup(await file.text());
      await flush();
      const existing = new Set((await listDisplays()).map((d) => d.id));
      const planned = planImport(existing, backup.displays, newId);
      for (const p of backup.photos ?? []) {
        if (!(await getPhoto(p.id))) await savePhoto({ id: p.id, blob: base64ToBlob(p.base64, p.type), width: p.width, height: p.height, createdAt: Date.now() });
      }
      for (const rec of planned) await saveDisplay(rec);
      await refreshList();
      if (planned.length) await switchTo(planned[0].id);
      const copies = planned.filter((r) => r.title.endsWith('(imported)')).length;
      showToast(`Imported ${planned.length} display${planned.length === 1 ? '' : 's'}${copies ? `; ${copies} already here came in as copies` : ''}.`);
    } catch (e) {
      showToast(e instanceof BackupError ? e.message : 'Could not read that file.');
    }
  };

  const addPhoto = async (source: Blob, name: string) => {
    if (!display) return;
    setBusyPhoto(true);
    try {
      const img = await prepareImage(source);
      const photoId = `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      if (persist.current) await savePhoto({ id: photoId, blob: img.blob, width: img.width, height: img.height, createdAt: Date.now() });
      setPhotoUrls((m) => ({ ...m, [photoId]: URL.createObjectURL(img.blob) }));
      const id = `v-${Date.now().toString(36)}`;
      act((d) => addView(d, { id, name, photoId, width: img.width, height: img.height }));
      setViewId(id);
      setFitNonce((n) => n + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add that photo.');
    } finally {
      setBusyPhoto(false);
    }
  };

  const addSampleHouse = async () => {
    try {
      const res = await fetch('./sample-house.svg');
      await addPhoto(await res.blob(), 'Sample house');
    } catch {
      showToast('Could not load the sample house.');
    }
  };

  const removePhotoView = (v: { id: string; name: string }) => {
    // No confirmation: it can be undone from the message that follows.
    act((d) => removeView(d, v.id));
    setViewId(undefined);
    setIntent(undefined);
    showToast(`Removed "${v.name}"`, true);
  };

  const isNewHere = (d: Display) => (d.copiedFrom ? true : undefined);

  const placePoint = (it: PhotoIntent, at: Pt) => {
    if (!photoView || it.type !== 'place') return;
    setIntent(undefined);
    if (it.nodeId) {
      const id = it.nodeId;
      act((d) => setPlacement(d, id, photoView.id, { kind: 'point', x: at[0], y: at[1] }), () => setSelected(id));
    } else if (it.presetId) {
      const p = presetById(it.presetId, custom);
      if (!p) return;
      noteUsed(p.id);
      act((d) => addPlacedNode(d, { ...p, isNew: isNewHere(d) }, photoView.id, { kind: 'point', x: at[0], y: at[1] }), (r) => setSelected(r.nodeId));
    }
  };

  const finishRun = (it: PhotoIntent, points: Pt[]) => {
    if (!photoView || it.type !== 'draw') return;
    setIntent(undefined);
    const placement = { kind: 'path' as const, points };
    if (it.nodeId) {
      const id = it.nodeId;
      act((d) => setPlacement(d, id, photoView.id, placement), () => setSelected(id));
    } else if (it.presetId) {
      const p = presetById(it.presetId, custom);
      if (!p) return;
      noteUsed(p.id);
      act((d) => addPlacedNode(d, { ...p, isNew: isNewHere(d) }, photoView.id, placement), (r) => setSelected(r.nodeId));
    }
  };

  const exportBackupPhotos = async () => {
    const all = await allPhotos();
    return Promise.all(all.map(async (p) => ({ id: p.id, type: p.blob.type || 'image/jpeg', width: p.width, height: p.height, base64: await blobToBase64(p.blob) })));
  };

  const removeCurrent = async () => {
    if (!doc || !persist.current) return;
    if (!(await confirmInApp('Delete display', `Delete "${doc.result.display.title}" and its restore points from this browser? This cannot be undone. A JSON backup (⋯ menu) keeps a copy.`, 'Delete display'))) return;
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
  const exportPng = () => downloadPng(layoutToSvg(layout, title), title).catch((e: Error) => showToast(e.message));
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
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setLabelsOpen(true); }}>
                Cord and plug labels…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); exportCsv(); }}>
                Download items as CSV
              </button>
              <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); void exportBackup(); }}>
                Back up all displays (JSON)
              </button>
              <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); importInput.current?.click(); }}>
                Import a backup…
              </button>
              <button type="button" role="menuitem" className="danger" disabled={!persist.current} onClick={(e) => { closeMenu(e); void removeCurrent(); }}>
                Delete this display
              </button>
            </div>
          </details>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Backup file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importBackup(f);
            }}
          />
          <ThemeButton />
        </div>
      </header>

      <nav className="views" aria-label="View">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" className={mode === 'plan' ? 'on' : ''} aria-pressed={mode === 'plan'} onClick={() => { setMode('plan'); setIntent(undefined); setFitNonce((n) => n + 1); }}>
            Plan
          </button>
          <button type="button" className={mode === 'photo' ? 'on' : ''} aria-pressed={mode === 'photo'} onClick={() => { setMode('photo'); setMoving(undefined); setFitNonce((n) => n + 1); }}>
            Photo
          </button>
          <button type="button" className={mode === 'checklist' ? 'on' : ''} aria-pressed={mode === 'checklist'} onClick={() => { setMode('checklist'); setMoving(undefined); setIntent(undefined); }}>
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
        <section className={`pane-diagram${mode === 'photo' ? ' photo-mode' : ''}`} aria-label={mode === 'photo' ? 'Photo' : 'Diagram'}>
          {mode === 'photo' ? (
            <PhotoPane
              display={display}
              views={views}
              view={photoView}
              photoUrl={photoView ? photoUrls[photoView.photoId] : undefined}
              onPickView={(id) => {
                setViewId(id);
                setIntent(undefined);
                setFitNonce((n) => n + 1);
              }}
              onAddPhoto={(f, name) => void addPhoto(f, name)}
              onAddSample={() => void addSampleHouse()}
              onRemoveView={removePhotoView}
              busyPhoto={busyPhoto}
              selectedId={selected}
              onSelect={(id) => {
                setSelected(id);
                if (id) setOutlineScroll((n) => n + 1);
              }}
              intent={intent}
              setIntent={setIntent}
              onAddItem={() => setPhotoPicker(true)}
              onPlacePoint={placePoint}
              onFinishRun={finishRun}
              onSetScale={(fpp) => {
                if (!photoView) return;
                setIntent(undefined);
                act((d) => updateView(d, photoView.id, { feetPerPx: fpp }));
                showToast('Scale saved: light runs now show their length', true);
              }}
              onMovePlacement={(id, placement) => photoView && act((d) => setPlacement(d, id, photoView.id, placement))}
              onPlugInto={(id, parent) => {
                setIntent(undefined);
                act(
                  (d) => replug(d, id, { parent }),
                  (r) => {
                    setSelected(r.nodeId);
                    if (!r.warning) showToast(`Plugged ${id} into ${parent}`, true);
                  },
                );
              }}
              blocked={intent?.type === 'move' ? subtreeOf(intent.nodeId) : undefined}
              fitKey={`${doc.id}:${fitNonce}`}
            />
          ) : (
          <>
          {canDrag && <Palette selectedId={selected} custom={custom} onPick={(p) => selected && addPreset(p, { parent: selected })} />}
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
              const p = presetById(id, custom);
              if (p) addPreset(p, target);
            }}
            canDrag={canDrag}
            dimmed={dimmed}
            undo={{ can: hist.past.length > 0, run: doUndo }}
            redo={{ can: hist.future.length > 0, run: doRedo }}
            onExportSvg={exportSvg}
            onExportPng={exportPng}
          />
          </>
          )}
          {selNode && !moving && !intent && (
            <NodePanel
              key={selNode.id}
              node={selNode}
              below={subtreeOf(selNode.id).size - 1}
              plugged={!!homeLink(display, selNode.id)}
              onPatch={(patch: NodePatch) => act((d) => updateNode(d, selNode.id, patch))}
              onKind={(kind: NodeKind) => act((d) => changeKind(d, selNode.id, kind), (r) => setSelected(r.nodeId))}
              onAddChild={() => setPicker({ parent: selNode.id })}
              onMove={() => {
                if (mode === 'photo') {
                  setIntent({ type: 'move', nodeId: selNode.id });
                  return;
                }
                setMoving(selNode.id);
                showToast(`Now tap where ${selNode.id} should plug in`);
              }}
              onUnplug={() => act((d) => unplug(d, selNode.id), (r, next) => reveal(r.nodeId, next))}
              onDelete={(withChildren) => {
                act((d) => deleteNode(d, selNode.id, withChildren));
                setSelected(undefined);
                showToast(`Deleted ${selNode.id}${withChildren ? ' and everything below it' : ''}`, true);
              }}
              onSaveAsPreset={(name, icon) => void saveAsPreset(selNode.id, name, icon)}
              onClose={() => setSelected(undefined)}
              extra={
                mode === 'photo' && photoView ? (
                  <PhotoNodeActions
                    placement={selNode.placements?.[photoView.id]}
                    lengthFt={selNode.placements?.[photoView.id] ? runLengthFt(selNode.placements[photoView.id], photoView) : undefined}
                    isLight={selNode.kind === 'load' && LIGHT_RUNS.has(selNode.category ?? '')}
                    onPlace={() => setIntent({ type: 'place', nodeId: selNode.id, name: `${selNode.id} ${selNode.label}` })}
                    onDraw={() => setIntent({ type: 'draw', nodeId: selNode.id, name: `${selNode.id} ${selNode.label}` })}
                    onRemove={() => act((d) => setPlacement(d, selNode.id, photoView.id, null))}
                    onUseLength={(ft) => act((d) => updateNode(d, selNode.id, { lengthFt: ft, lengthApprox: true }))}
                  />
                ) : undefined
              }
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
            suggestFor={(line) => suggest(line, [...custom, ...PRESETS]).map((p) => ({ id: p.id, icon: p.icon, text: presetText(p) }))}
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
      {labelsOpen && (
        <LabelSheet
          display={display}
          onDownloadCsv={(csv) => downloadText(csv, `${fileSlug(title)}-labels.csv`, 'text/csv')}
          onClose={() => setLabelsOpen(false)}
        />
      )}
      {photoPicker && (
        <PresetPicker
          title="Add to the photo"
          custom={custom}
          onDeleteCustom={(p) => void deletePreset(p)}
          onClose={() => setPhotoPicker(false)}
          onPick={(p) => {
            setPhotoPicker(false);
            // Lights are drawn along the house; everything else is placed with a tap.
            setIntent(p.kind === 'load' && LIGHT_RUNS.has(p.category ?? '') ? { type: 'draw', presetId: p.id, name: p.name } : { type: 'place', presetId: p.id, name: p.name });
          }}
        />
      )}
      {picker && (
        <PresetPicker
          title={targetTitle(picker)}
          custom={custom}
          onDeleteCustom={(p) => void deletePreset(p)}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            const t = picker;
            setPicker(null);
            addPreset(p, t);
          }}
        />
      )}
      {ask && (
        <Sheet
          title={ask.title}
          onClose={() => {
            ask.resolve(false);
            setAsk(null);
          }}
        >
          <p>{ask.message}</p>
          <div className="row confirm-row">
            <button
              type="button"
              onClick={() => {
                ask.resolve(false);
                setAsk(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-solid"
              onClick={() => {
                ask.resolve(true);
                setAsk(null);
              }}
            >
              {ask.confirm}
            </button>
          </div>
        </Sheet>
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

function PhotoNodeActions(props: {
  placement?: Placement;
  lengthFt?: number;
  isLight: boolean;
  onPlace: () => void;
  onDraw: () => void;
  onRemove: () => void;
  onUseLength: (ft: number) => void;
}) {
  const { placement, lengthFt, isLight } = props;
  const ft = lengthFt !== undefined ? Math.round(lengthFt) : undefined;
  return (
    <>
      {isLight ? (
        <button type="button" className="primary" onClick={props.onDraw}>
          ✏️ {placement?.kind === 'path' ? 'Redraw on photo' : 'Draw on photo'}
        </button>
      ) : (
        <button type="button" className={placement ? '' : 'primary'} onClick={props.onPlace}>
          📍 {placement ? 'Move on photo' : 'Place on photo'}
        </button>
      )}
      {placement && (
        <button type="button" onClick={props.onRemove}>
          Remove from photo
        </button>
      )}
      {ft !== undefined && ft > 0 && (
        <button type="button" onClick={() => props.onUseLength(ft)}>
          Use ~{ft} ft as length
        </button>
      )}
    </>
  );
}
