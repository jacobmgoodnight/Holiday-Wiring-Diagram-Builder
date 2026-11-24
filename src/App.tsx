import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagram } from './diagram/Diagram';
import { downloadBlob, downloadPng, downloadSvg, downloadText, fileSlug } from './diagram/exportImage';
import { BackupError, makeBackup, parseBackup, planImport } from './export/backup';
import { displayToCsv } from './export/csv';
import { type LayoutDirection, clusterList, clusterOf, layoutDisplay } from './diagram/layout';
import { layoutToSvg } from './diagram/svg';
import {
  type ActionResult,
  ActionError,
  type NodePatch,
  type Target,
  addNode,
  changeKind,
  deleteNode,
  duplicateNode,
  homeLink,
  replug,
  subtreeIds,
  unplug,
  updateNode,
} from './model/actions';
import { displayStats, isRun, spliceable } from './model/graph';
import { type Direction, navigate, parentOf } from './model/navigate';
import { type Change, compareDisplays, copyForNextYear, nextTitle } from './model/season';
import { type History, initHistory, push, redo, undo } from './model/history';
import type { Display, DisplayNode, NodeKind, Placement } from './model/types';
import { type BuildResult, buildDisplay } from './outline';
import { isIosBrowserTab, keepStorage, noteBackup, noteEdit, readSafety, shouldNudgeBackup, shouldShowIosTip, snoozeBackup, writeSafety } from './store/safety';
import { newVersionAvailable } from './store/update';
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
import { type InstallDirection, InstallTab } from './ui/InstallTab';
import { DiagramPrint } from './ui/PlanDiagrams';
import { ChangesDialog, CopyDialog, RestoreDialog } from './ui/Dialogs';
import { LabelSheet } from './ui/LabelSheet';
import { assignTieColors } from './export/labels';
import { FindBox } from './ui/FindBox';
import { HelpSheet } from './ui/HelpSheet';
import { NodePanel } from './ui/NodePanel';
import { SelectionBar } from './ui/SelectionBar';
import { ShoppingSheet } from './ui/ShoppingSheet';
import { InstallSheet } from './ui/InstallSheet';
import { TextSheet } from './ui/TextSheet';
import { suggestionsFor } from './presets/suggest';
import {
  addMeasure,
  addPlacedNode,
  addView,
  CORD_REACH_FT,
  moveFemale,
  nearbyUnplugged,
  plugIntoCord,
  plugNearbyIntoCord,
  plugOnPhoto,
  removeFemale,
  removeMeasure,
  removeView,
  setPlacement,
  spliceFemale,
  swapEnds,
  updateView,
} from './photo/actions';
import { type Pt, drawnAsLights, drawnAsRun, drawsAsArea, runLengthFt, wiringLines } from './photo/geometry';
import { type LightOpts, lightPatch } from './photo/LightOptions';
import { applyLookToAll, rememberLook, sameKind, withLook } from './photo/lightOpts';
import { base64ToBlob, blobToBase64, prepareImage } from './photo/image';
import type { LightNode, PhotoIntent } from './photo/PhotoEditor';
import { PhotoPane } from './photo/PhotoPane';
import { Palette } from './ui/Palette';
import { PresetPicker } from './ui/PresetPicker';
import { Sheet } from './ui/Sheet';
import { ThemeButton } from './ui/ThemeButton';
import { SyncSheet, ago } from './ui/SyncSheet';
import { syncServer } from './sync/api';
import { normalizeCode } from './sync/code';
import type { SyncOutcome } from './sync/engine';
import { useSync } from './sync/useSync';
import { isUntouchedExample } from './sync/example';

const PHASE0_KEY = 'wiring-sketchpad.phase0.outline';
const OVERALL = '__overall__';
/** Photo: add extension cords automatically when a strand does not reach ("1" or "0"). */
const AUTO_CORDS_KEY = 'wiring-sketchpad.autoCords';
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

type Mode = 'photo' | 'plan' | 'install';
const TAB_KEY = 'wiring-sketchpad.tab';
const LAYOUT_KEY = 'wiring-sketchpad.layout';
/** The tab you were on last (Photo the first time). */
function readTab(): Mode {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'plan' || t === 'install' ? t : 'photo';
  } catch {
    return 'photo';
  }
}
/** Wide (left to right) or tall (indented): your choice, else tall on phones. */
function readLayout(): LayoutDirection {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === 'wide' || v === 'tall') return v;
  } catch {
    // no storage: use the default
  }
  return isPhone() ? 'tall' : 'wide';
}
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: this visit only
  }
};
const finePointer = () => window.matchMedia('(pointer: fine)').matches;

function readPhase0(): string | null {
  try {
    return localStorage.getItem(PHASE0_KEY);
  } catch {
    return null;
  }
}

const FOLD_KEY = (id: string) => `wiring-sketchpad.folded.${id}`;
function readFolded(id: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY(id)) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeFolded(id: string, folded: Set<string>) {
  try {
    localStorage.setItem(FOLD_KEY(id), JSON.stringify([...folded]));
  } catch {
    /* per-device convenience only */
  }
}

/** Phone layout (bottom selection bar, details in a sheet) vs. side inspector. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
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
  /** Bring the selected item into view; `next` also shows the column to its right (after adding). */
  const [centerRequest, setCenterRequest] = useState<{ n: number; next: boolean } | undefined>();
  const requestCenter = (next: boolean) => setCenterRequest((c) => ({ n: (c?.n ?? 0) + 1, next }));
  const [fitNonce, setFitNonce] = useState(0);
  const [picker, setPicker] = useState<Target | null>(null);
  /** The item next to the socket being filled, for "Another …" suggestions. */
  const [pickerLike, setPickerLike] = useState<string | undefined>();
  const [renaming, setRenaming] = useState<string | undefined>();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [findOpen, setFindOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const phone = usePhone();
  const [moving, setMoving] = useState<string | undefined>();
  const [toast, setToast] = useState<Toast | null>(null);
  /** Backup reminder and iPhone tip state (this device). */
  const [safety, setSafety] = useState(readSafety);
  const updateSafety = (fn: (s: ReturnType<typeof readSafety>) => ReturnType<typeof readSafety>) =>
    setSafety((s) => {
      const next = fn(s);
      writeSafety(next);
      return next;
    });
  const askedToKeep = useRef(false);
  const iosTab = useMemo(() => isIosBrowserTab(), []);
  /** A newer version of the app has been published. */
  const [updateReady, setUpdateReady] = useState(false);
  /** In-page confirmation (browser confirm() is unavailable in some viewers and jarring on phones). */
  const [ask, setAsk] = useState<{ title: string; message: string; confirm: string; resolve: (ok: boolean) => void } | null>(null);
  const confirmInApp = (title: string, message: string, confirm: string) =>
    new Promise<boolean>((resolve) => setAsk({ title, message, confirm, resolve }));
  /** True while another display is being opened: edits wait so they cannot land in the wrong one. */
  const [busy, setBusy] = useState(false);
  const [mode, setModeState] = useState<Mode>(readTab);
  const setMode = useCallback((m: Mode | ((prev: Mode) => Mode)) => {
    setModeState((prev) => {
      const next = typeof m === 'function' ? m(prev) : m;
      remember(TAB_KEY, next);
      return next;
    });
  }, []);
  const [direction, setDirectionState] = useState<LayoutDirection>(readLayout);
  const setDirection = (d: LayoutDirection) => {
    remember(LAYOUT_KEY, d);
    setDirectionState(d);
    setFitNonce((n) => n + 1);
  };
  const [installDir, setInstallDir] = useState<InstallDirection>('up');
  const [installScope, setInstallScope] = useState('');
  const [diagramPrint, setDiagramPrint] = useState(false);
  const [viewId, setViewId] = useState<string | undefined>();
  const [intent, setIntent] = useState<PhotoIntent | undefined>();
  const [autoCords, setAutoCords] = useState(() => {
    try {
      return localStorage.getItem(AUTO_CORDS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [photoPicker, setPhotoPicker] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const loadingPhotos = useRef(new Set<string>());
  const [tag, setTag] = useState('');
  const [dialog, setDialog] = useState<null | 'restore' | 'copy' | 'changes'>(null);
  const [changes, setChanges] = useState<{ source: string | null; list: Change[] | null } | null>(null);
  const lastAuto = useRef(new Map<string, number>());
  const [custom, setCustom] = useState<Preset[]>([]);
  /** The label sheet, for everything, one photo ('view:…') or one item ('item:…'). */
  const [labels, setLabels] = useState<{ scope?: string } | null>(null);
  const labelsOpen = !!labels;
  /** The printable install sheet, for the whole plan or one photo. */
  const [installSheet, setInstallSheet] = useState<{ viewId?: string } | null>(null);
  /** The shopping list, for the whole plan or one photo. */
  const [shopping, setShopping] = useState<{ viewId?: string } | null>(null);
  const shoppingOpen = !!shopping;
  /** Sync with other devices (a code from a #sync= link offers to join it). */
  const [syncOpen, setSyncOpen] = useState<{ link?: string } | null>(null);
  const server = useMemo(syncServer, []);
  /** The plans have loaded (sync starts then). */
  const [booted, setBooted] = useState(false);
  /** Goes up with every edit, so a sync can tell the user edited while it ran. */
  const editSeq = useRef(0);
  const syncSoon = useRef<() => void>(() => undefined);
  /** Photos arrived by sync: look for missing ones again. */
  const [photoNonce, setPhotoNonce] = useState(0);
  const importInput = useRef<HTMLInputElement>(null);
  const excelInput = useRef<HTMLInputElement>(null);
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
    setRenaming(undefined);
    setFindOpen(false);
    setTextOpen(false);
    setFolded(readFolded(next.id));
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
      setBooted(true);
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
      syncSoon.current();
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
    editSeq.current++;
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
    if (persist.current) {
      updateSafety((s) => noteEdit(s, now));
      // Ask the browser to keep this site's data, once a session, right after a real edit.
      if (!askedToKeep.current) {
        askedToKeep.current = true;
        void keepStorage();
      }
    }
  };

  // Notice when a newer version has been published (production builds only).
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let live = true;
    const check = () => void newVersionAvailable().then((yes) => live && yes && setUpdateReady(true));
    const first = window.setTimeout(check, 3000);
    const every = window.setInterval(check, 30 * 60 * 1000);
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

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
    requestCenter(true);
  };

  const addPreset = (preset: Preset, target: Target) => {
    if (!preset.id.startsWith('like:')) noteUsed(preset.id);
    act(
      // In a copy of last year's display, anything added is new this year.
      (d) => addNode(d, withLook(d, { ...preset, isNew: d.copiedFrom ? true : undefined }, !!preset.custom), target),
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
      const sheetOpen = !!(picker || photoPicker || ask || dialog || textOpen || helpOpen || labelsOpen || shoppingOpen || installSheet || diagramPrint || syncOpen || (phone && detailsOpen));
      if (e.key === 'Escape' && !picker && !photoPicker && !sheetOpen) {
        if (findOpen) setFindOpen(false);
        else if (intent) setIntent(undefined);
        else if (moving) setMoving(undefined);
        else if (selected && !inOtherField) setSelected(undefined);
        return;
      }
      // Mind-map keys on the diagram (desktop keyboards).
      const typing = inOtherField || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable;
      if (typing || sheetOpen || findOpen || renaming || mode === 'install' || e.altKey) return;
      if (e.key === '/' && mode === 'plan') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (!selected || !display?.nodes[selected] || moving || intent) return;
      const onButton = el?.tagName === 'BUTTON' || el?.tagName === 'SUMMARY';
      const mod = e.ctrlKey || e.metaKey;
      const arrows: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (arrows[e.key] && !mod) {
        e.preventDefault();
        const to = navigate(display, selected, arrows[e.key], folded);
        if (to) jumpTo(to);
      } else if (e.key === 'Tab' && !mod && !e.shiftKey) {
        e.preventDefault();
        openPicker({ parent: selected });
      } else if (e.key === 'Enter' && !mod && !onButton) {
        e.preventDefault();
        addBeside(selected);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected(selected);
      } else if (e.key === 'F2' && mode === 'plan') {
        e.preventDefault();
        setRenaming(selected);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        e.preventDefault();
        deleteSelected(selected);
      } else if (e.key === ' ' && !onButton && mode === 'plan') {
        e.preventDefault();
        if (childrenCount(selected) > 0 || folded.has(selected)) toggleFold(selected);
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
        else loadingPhotos.current.delete(v.photoId); // may still arrive by sync
      });
    }
  }, [display?.views, photoUrls, photoNonce]);
  const views = display?.views ?? [];
  const photoView = views.find((v) => v.id === viewId) ?? views[0];
  const clusters = useMemo(() => (display ? clusterList(display) : []), [display]);
  const activeView = view !== OVERALL && !clusters.some((c) => c.id === view) ? OVERALL : view;
  const layout = useMemo(
    () => (display ? layoutDisplay(display, { focus: activeView === OVERALL ? null : activeView, collapsed: folded, direction }) : null),
    [display, activeView, folded, direction],
  );
  const subtreeOf = useCallback((id: string) => (display ? subtreeIds(display, id) : new Set<string>()), [display]);
  const openPicker = useCallback((t: Target, like?: string) => {
    setPicker(t);
    setPickerLike(like);
  }, []);

  const updateFolded = (fn: (s: Set<string>) => void) => {
    if (!doc) return;
    setFolded((prev) => {
      const next = new Set(prev);
      fn(next);
      writeFolded(doc.id, next);
      return next;
    });
  };
  const toggleFold = (id: string) => updateFolded((f) => (f.has(id) ? f.delete(id) : f.add(id)));

  /** Select an item and bring it into view: unfold what hides it, switch outlet if needed. */
  const jumpTo = (id: string) => {
    if (!display?.nodes[id]) return;
    const ancestors: string[] = [];
    const seen = new Set([id]);
    for (let cur = parentOf(display, id); cur && !seen.has(cur); cur = parentOf(display, cur)) {
      seen.add(cur);
      ancestors.push(cur);
    }
    if (ancestors.some((a) => folded.has(a))) updateFolded((f) => ancestors.forEach((a) => f.delete(a)));
    setSelected(id);
    const owner = clusterOf(display, id);
    if (view !== OVERALL && owner && owner !== view) {
      setView(owner);
      setFitNonce((n) => n + 1);
    }
    requestCenter(false);
  };

  /** "+ Into K01": another item into the same parent, next to the selected one. */
  const addBeside = (id: string) => {
    if (!display) return;
    const home = homeLink(display, id);
    openPicker({ parent: home?.kind === 'power' ? home.from : null }, id);
  };

  const duplicateSelected = (id: string) => act((d) => duplicateNode(d, id), (r, next) => reveal(r.nodeId, next));

  const deleteSelected = (id: string) => {
    if (!display) return;
    const up = parentOf(display, id);
    act((d) => deleteNode(d, id, false));
    setSelected(up);
    showToast(`Deleted ${id}${childrenCount(id) ? '; what was plugged into it is now unplugged' : ''}`, true);
  };
  const childrenCount = (id: string) => (display ? subtreeIds(display, id).size - 1 : 0);

  const commitRename = (id: string, label: string | null) => {
    setRenaming(undefined);
    if (label === null || !display?.nodes[id]) return;
    const clean = label.replace(/[[\]]/g, '').trim();
    if (clean === display.nodes[id].label) return;
    act((d) => updateNode(d, id, { label: clean }));
  };

  const showView = (id: string) => {
    setView(id);
    setFitNonce((n) => n + 1);
  };

  const selectFromDiagram = (nodeId: string | undefined) => {
    setSelected(nodeId);
    if (!nodeId) setDetailsOpen(false);
    // The selection bar takes room at the bottom on phones: keep the item in view.
    else requestCenter(false);
  };

  const selectFromOutline = (line: number) => {
    if (!doc) return;
    const nodeId = doc.result.lineFocusIds[line];
    if (!nodeId || nodeId === selected) return;
    jumpTo(nodeId);
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
      syncSoon.current();
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
      syncSoon.current();
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
    jumpTo(id);
    setFitNonce((n) => n + 1);
  };

  /** Show an item from the Install tab: on a photo it is on (the chosen one first), else on the plan. */
  const showFromInstall = (id: string) => {
    const n = doc?.result.display.nodes[id];
    const vs = doc?.result.display.views ?? [];
    const v = vs.find((x) => x.id === installScope && n?.placements?.[x.id]) ?? vs.find((x) => n?.placements?.[x.id]);
    if (!v) return showOnDiagram(id);
    setMode('photo');
    setViewId(v.id);
    setIntent(undefined);
    setSelected(id);
    setFitNonce((k) => k + 1);
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
    updateSafety((s) => noteBackup(s, Date.now()));
    showToast(`Backup of ${backup.displays.length} display${backup.displays.length === 1 ? '' : 's'} downloaded. Keep it somewhere safe.`);
  };

  /** Excel: the current display's items and wiring as an .xlsx workbook. */
  const exportExcel = async () => {
    if (!display) return;
    try {
      const { displayToWorkbook } = await import('./export/workbook');
      const bytes = displayToWorkbook(display);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileSlug(display.title)}.xlsx`);
    } catch {
      showToast('Could not make the Excel file.');
    }
  };

  /** Excel import always makes a new display; nothing already here is changed. */
  const importExcel = (file: File) =>
    whileBusy(async () => {
      try {
        const { workbookToDisplay } = await import('./export/workbook');
        const name = file.name.replace(/\.xlsx$/i, '').replace(/[-_]+/g, ' ').trim();
        const { display: imported, warnings } = workbookToDisplay(new Uint8Array(await file.arrayBuffer()), newId(), name);
        await flush();
        const existingTitles = new Set((await listDisplays()).map((d) => d.title));
        if (existingTitles.has(imported.title)) {
          imported.title = `${imported.title} (imported)`;
          imported.comments = imported.comments.map((c) => (c.id === 'c-title' ? { ...c, text: `# ${imported.title}` } : c));
        }
        const synced = syncFromModel(imported);
        const d = { id: imported.id, text: synced.text, result: synced.result };
        if (persist.current) await saveDisplay(toStored(d.text, d.result.display, d.result.lineNodeIds));
        open(d);
        await refreshList();
        const n = Object.keys(d.result.display.nodes).length;
        showToast(
          `Imported "${imported.title}" with ${n} item${n === 1 ? '' : 's'} as a new display.` +
            (warnings.length ? ` ${warnings.length} row${warnings.length === 1 ? '' : 's'} needed a fix: ${warnings.slice(0, 2).join(' ')}${warnings.length > 2 ? ' …' : ''}` : ''),
        );
      } catch (e) {
        showToast(e instanceof Error && e.message ? e.message : 'Could not read that file.');
      }
    });

  /** A plain device list for other tools (the show-control dashboard) to read. */
  const exportDevices = async () => {
    if (!display) return;
    const { devicesFile } = await import('./export/devices');
    downloadText(JSON.stringify(devicesFile(display), null, 2), `${fileSlug(display.title)}-devices.json`, 'application/json');
    showToast('Device list downloaded. Your dashboard can read this file.');
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
      syncSoon.current();
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

  /** What a photo intent puts on the photo: a light item is drawn, anything else placed. */
  const photoIntentFor = (p: Preset, target?: Target): PhotoIntent =>
    drawnAsRun(p) ? { type: 'draw', presetId: p.id, name: p.name, target, area: drawnAsLights(p) && drawsAsArea(p) } : { type: 'place', presetId: p.id, name: p.name, target };

  /** Remember the look chosen for a kind of light, so the next one matches. */
  const remembered = (r: ActionResult, node: Pick<DisplayNode, 'kind' | 'label' | 'category'>, opts?: LightOpts): ActionResult =>
    opts && drawnAsLights(node) ? { ...r, display: rememberLook(r.display, node, opts) } : r;

  /**
   * Plug in on the photo (adding an extension cord when a strand does not reach). Into a zip
   * cord with no female named, a female goes where the item is nearest.
   */
  const plugHere = (d: Display, childId: string, target: Target) => {
    if (!photoView) return replug(d, childId, target);
    const opts = { autoCord: autoCords, isNew: isNewHere(d) };
    const into = target.parent ? d.nodes[target.parent] : undefined;
    if (spliceable(into) && !target.port) return plugIntoCord(d, photoView, childId, target.parent!, opts);
    return plugOnPhoto(d, photoView, childId, target, { ...opts, reachFt: spliceable(into) ? CORD_REACH_FT : undefined });
  };
  /** "Plugged L05 into C01 tap 3 (a new female)". */
  const pluggedNote = (r: ActionResult, childId: string, parent: string, port?: string) => {
    const x = r as ActionResult & { port?: string; spliced?: boolean };
    const where = x.port ?? port;
    return `Plugged ${childId} into ${parent}${where ? ` ${where.replace(/^tap(\d+)$/, 'tap $1')}` : ''}${x.spliced ? ' (a new female there)' : ''}`;
  };
  /** Says so when plugging in added an extension cord; true if it did. */
  const cordNote = (res: ActionResult, parent: string | null | undefined) => {
    const r = res as ActionResult & { cordId?: string; cordFt?: number };
    if (r.cordId)
      showToast(
        `Added ${r.cordId}, ${r.cordFt ? `a ${r.cordFt} ft` : 'an'} extension cord, to reach ${parent}${r.cordFt ? '' : ' (measure the photo to size it)'}`,
        true,
      );
    return !!r.cordId;
  };

  /**
   * After a new item lands on the photo: select it, and if it is not plugged in yet and there
   * is something placed it could plug into, ask for that right away so its cable shows.
   */
  const afterPlaced = (r: ActionResult, next: Doc) => {
    setSelected(r.nodeId);
    const d = next.result.display;
    const n = r.nodeId ? d.nodes[r.nodeId] : undefined;
    if (!n || !photoView || n.kind === 'outlet' || homeLink(d, n.id)) return;
    const others = Object.values(d.nodes).some((o) => o.id !== n.id && o.placements?.[photoView.id] && (o.kind !== 'load' || isRun(o)));
    if (others) setIntent({ type: 'move', nodeId: n.id, fresh: true });
  };

  const placePoint = (it: PhotoIntent, at: Pt) => {
    if (!photoView || it.type !== 'place') return;
    setIntent(undefined);
    const placement = { kind: 'point' as const, x: at[0], y: at[1] };
    if (it.nodeId) {
      const id = it.nodeId;
      act((d) => setPlacement(d, id, photoView.id, placement), () => setSelected(id));
    } else if (it.presetId) {
      const p = presetById(it.presetId, custom);
      if (!p) return;
      noteUsed(p.id);
      const target = it.target;
      act(
        (d) => {
          const r = addPlacedNode(d, { ...p, isNew: isNewHere(d) }, photoView.id, placement);
          return target?.parent ? plugHere(r.display, r.nodeId!, target) : r;
        },
        (r, next) => {
          afterPlaced(r, next);
          cordNote(r, target?.parent);
        },
      );
    }
  };

  const finishRun = (it: PhotoIntent, points: Pt[], opts?: LightOpts, snap?: Target) => {
    if (!photoView || it.type !== 'draw') return;
    setIntent(undefined);
    const placement = it.area ? { kind: 'area' as const, points } : { kind: 'path' as const, points };
    if (it.nodeId) {
      const id = it.nodeId;
      act(
        (d) => {
          const placed = setPlacement(d, id, photoView.id, placement);
          const looked = opts ? remembered(updateNode(placed.display, id, lightPatch(d.nodes[id], opts)), d.nodes[id], opts) : placed;
          return snap ? plugHere(looked.display, id, snap) : looked;
        },
        (r) => {
          setSelected(id);
          cordNote(r, snap?.parent);
        },
      );
    } else if (it.presetId) {
      const p = presetById(it.presetId, custom);
      if (!p) return;
      noteUsed(p.id);
      const look = opts ? lightPatch(p, opts) : {};
      // Zip cord drawn on the photo: just the end female; the others go where things plug in.
      const females = spliceable(p) && p.kind === 'cord' ? { outputs: 1 } : {};
      // Starting on an open female wins over where "+ Plug in" was pressed.
      const target = snap ?? it.target;
      act(
        (d) => {
          const r = remembered(addPlacedNode(d, { ...p, ...look, ...females, isNew: isNewHere(d) }, photoView.id, placement), p, opts);
          return target?.parent ? plugHere(r.display, r.nodeId!, target) : r;
        },
        (r, next) => {
          afterPlaced(r, next);
          if (cordNote(r, target?.parent)) return;
          const near = spliceable(p) && r.nodeId ? nearbyUnplugged(next.result.display, photoView, r.nodeId).length : 0;
          if (near) showToast(`${near} item${near === 1 ? '' : 's'} along ${r.nodeId} can plug into it: tap 🔌 Plug in nearby`);
        },
      );
    }
  };

  /** Inline females on a run: splice one in, slide one along, take an empty one off. */
  const spliceAt = (runId: string, along: number) => {
    if (!photoView) return;
    act(
      (d) => spliceFemale(d, runId, photoView.id, along),
      (r) => {
        setSelected(runId);
        setIntent((it) => (it?.type === 'splice' ? { ...it, added: (it.added ?? 0) + 1 } : it));
        showToast(`Spliced an inline female into ${runId} (${'port' in r ? String(r.port).replace('tap', 'tap ') : ''})`, true);
      },
    );
  };
  const slideFemale = (runId: string, index: number, along: number) => photoView && act((d) => moveFemale(d, runId, photoView.id, index, along));
  const dropFemale = (runId: string, index: number) => {
    if (!photoView) return;
    setIntent(undefined);
    act((d) => removeFemale(d, runId, photoView.id, index), () => showToast(`Removed an inline female from ${runId}`, true));
  };

  /** "Add without placing": the new item goes into the plan only. */
  const skipPlacing = (it: PhotoIntent) => {
    if ((it.type !== 'place' && it.type !== 'draw') || !it.presetId) return;
    const p = presetById(it.presetId, custom);
    setIntent(undefined);
    if (p) addPreset(p, it.target ?? { parent: null });
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
    syncSoon.current();
  };

  // ---- Sync with other devices ----
  const docRef = useRef(doc);
  docRef.current = doc;
  /** Show the other device's changes: reload or leave the open display, and say what came. */
  const afterSync = async (o: SyncOutcome, editedDuring: boolean) => {
    if (o.photosDown) setPhotoNonce((n) => n + 1);
    if (!o.saved.length && !o.removed.length && !o.kept) return;
    await refreshList();
    const cur = docRef.current;
    const messages: string[] = [];
    if (cur && o.removed.includes(cur.id)) {
      if (editedDuring) {
        // Edited here meanwhile: keep it (it goes back to the cloud on the next sync).
        pending.current = cur;
        await flush();
      } else {
        const rest = await listDisplays();
        if (rest.length) await switchTo(rest[0].id);
        else await newDisplay();
        messages.push(`"${cur.result.display.title}" was deleted on your other device.`);
      }
    } else if (cur && o.saved.includes(cur.id)) {
      const rec = await getDisplay(cur.id);
      if (editedDuring) {
        // Keep the edit made here; the other device's version becomes a restore point.
        if (rec) await addSnapshot({ ...snapshotOf(docFromStored(rec), 'sync') });
        pending.current = docRef.current ?? cur;
        await flush();
        messages.push('Changes from your other device came in while you were editing: they are in Restore points.');
      } else if (rec) {
        const next = docFromStored(rec);
        setHist(initHistory(next));
        setSelected((s) => (s && next.result.display.nodes[s] ? s : undefined));
        setMoving(undefined);
        messages.push('Updated with changes from your other device.');
      }
    }
    const others = o.saved.filter((id) => id !== cur?.id).length;
    if (others) messages.push(`${others} other plan${others === 1 ? '' : 's'} updated from your other device.`);
    if (o.kept) messages.push('Edited on both devices: the other version is saved in Restore points.');
    if (messages.length) showToast(messages.join(' '));
  };
  const sync = useSync({ ready: booted && persist.current, server, beforeSync: flush, afterSync, editSeq });
  syncSoon.current = sync.syncSoon;
  // A sync link (#sync=CODE) offers to join; the code is taken out of the address at once.
  useEffect(() => {
    const m = /^#sync=(.+)$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const code = normalizeCode(decodeURIComponent(m[1]));
    if (code && server) setSyncOpen({ link: code });
  }, [server]);
  /** Join with a code; this device's untouched starter example is dropped, not sent. */
  const joinSync = async (code: string) => {
    const dropped: string[] = [];
    await sync.join(code, async (remote) => {
      if (!Object.keys(remote.displays).length) return;
      for (const rec of await allDisplays())
        if (!remote.displays[rec.id] && isUntouchedExample(rec)) {
          await deleteDisplay(rec.id);
          dropped.push(rec.id);
        }
    });
    await refreshList();
    if (docRef.current && dropped.includes(docRef.current.id)) {
      const rest = await listDisplays();
      if (rest.length) await switchTo(rest[0].id);
    }
  };
  const forgetCloud = async () => {
    if (!(await confirmInApp('Delete the cloud copy', 'Delete the synced copy from the server? The plans on each device stay where they are, and sync turns off here.', 'Delete cloud copy'))) return;
    try {
      await sync.forget();
      showToast('Cloud copy deleted. Sync is off on this device.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete the cloud copy.');
    }
  };

  if (!doc || !layout || !display || !hist) return <div className="loading">Loading…</div>;

  const title = display.title;
  // The item or preset being drawn on the photo, for its live preview and light options.
  const draftBase: LightNode | undefined = (() => {
    if (!intent || intent.type !== 'draw') return undefined;
    if (intent.nodeId) return display.nodes[intent.nodeId];
    const p = intent.presetId ? presetById(intent.presetId, custom) : undefined;
    return p ? { ...p, id: 'new' } : undefined;
  })();
  // Exports show everything, folded branches included.
  const fullLayout = () => layoutDisplay(display, { focus: activeView === OVERALL ? null : activeView, direction });
  const exportSvg = () => downloadSvg(layoutToSvg(fullLayout(), title), title);
  const exportPng = () => downloadPng(layoutToSvg(fullLayout(), title), title).catch((e: Error) => showToast(e.message));
  const stats = displayStats(display);
  const highlight = selected ? doc.result.lineNodeIds.indexOf(selected) : -1;
  const options = list.some((d) => d.id === doc.id) ? list : [{ id: doc.id, title }, ...list];
  const selNode = selected ? display.nodes[selected] : undefined;
  const allTags = [...new Set(Object.values(display.nodes).flatMap((n) => n.tags))].sort();
  const dimmed = tag ? new Set(Object.values(display.nodes).filter((n) => !n.tags.includes(tag)).map((n) => n.id)) : undefined;
  const selBarShown = !!selNode && !moving && !intent && mode !== 'install';
  const selParent = selNode ? homeLink(display, selNode.id) : undefined;
  const selBar = selNode && selBarShown && (
    <SelectionBar
      node={selNode}
      parentId={selParent?.kind === 'power' ? selParent.from : undefined}
      below={childrenCount(selNode.id)}
      folded={folded.has(selNode.id)}
      detailsOpen={detailsOpen}
      onDetails={phone ? () => setDetailsOpen((o) => !o) : undefined}
      onPlugIn={() => openPicker({ parent: selNode.id })}
      onAddBeside={() => addBeside(selNode.id)}
      onDuplicate={() => duplicateSelected(selNode.id)}
      onRename={() => {
        if (mode === 'plan') {
          jumpTo(selNode.id);
          setRenaming(selNode.id);
        } else setDetailsOpen(true);
      }}
      onMove={() => {
        if (mode === 'photo') {
          setIntent({ type: 'move', nodeId: selNode.id });
          return;
        }
        setMoving(selNode.id);
        setDetailsOpen(false);
        showToast(`Now tap where ${selNode.id} should plug in`);
      }}
      onFold={() => toggleFold(selNode.id)}
      onDelete={() => deleteSelected(selNode.id)}
      onClose={() => {
        setSelected(undefined);
        setDetailsOpen(false);
      }}
      extra={
        mode === 'photo' && photoView ? (
          <PhotoNodeActions
            placement={selNode.placements?.[photoView.id]}
            lengthFt={selNode.placements?.[photoView.id] ? runLengthFt(selNode.placements[photoView.id], photoView, selNode.smooth) : undefined}
            drawn={drawnAsRun(selNode)}
            canBush={drawnAsLights(selNode)}
            canSplice={isRun(selNode) && selNode.placements?.[photoView.id]?.kind === 'path'}
            nearby={nearbyUnplugged(display, photoView, selNode.id).length}
            onPlugNearby={() =>
              act(
                (d) => plugNearbyIntoCord(d, photoView, selNode.id, { autoCord: autoCords, isNew: isNewHere(d) }),
                (r) => {
                  const n = (r as ActionResult & { plugged: string[] }).plugged;
                  showToast(`Plugged ${n.join(', ')} into ${selNode.id}, each at its own female`, true);
                },
              )
            }
            onSplice={() => setIntent({ type: 'splice', nodeId: selNode.id })}
            onSwapEnds={() => act((d) => swapEnds(d, selNode.id, photoView.id), () => showToast(`Swapped the plug and the end of ${selNode.id}`, true))}
            onPlace={() => setIntent({ type: 'place', nodeId: selNode.id, name: `${selNode.id} ${selNode.label}` })}
            onDraw={(area) => setIntent({ type: 'draw', nodeId: selNode.id, name: `${selNode.id} ${selNode.label}`, area })}
            defaultArea={drawnAsLights(selNode) && drawsAsArea(selNode)}
            onRemove={() => act((d) => setPlacement(d, selNode.id, photoView.id, null))}
            onUseLength={(ft) => act((d) => updateNode(d, selNode.id, { lengthFt: ft, lengthApprox: true }))}
            short={selNode.kind === 'cord' ? wiringLines(display, photoView).find((l) => l.short && l.via.includes(selNode.id))?.short : undefined}
            onFixShort={(ft) =>
              act(
                (d) => updateNode(d, selNode.id, { lengthFt: ft, lengthApprox: undefined }),
                () => showToast(`${selNode.id} is now a ${ft} ft cord`, true),
              )
            }
          />
        ) : undefined
      }
    />
  );
  const nodePanel = selNode && (
    <NodePanel
      key={selNode.id}
      node={selNode}
      below={childrenCount(selNode.id)}
      plugged={!!selParent}
      onPatch={(patch: NodePatch) => act((d) => updateNode(d, selNode.id, patch))}
      onLabel={() => setLabels({ scope: `item:${selNode.id}` })}
      onKind={(kind: NodeKind) => act((d) => changeKind(d, selNode.id, kind), (r) => setSelected(r.nodeId))}
      onUnplug={() => act((d) => unplug(d, selNode.id), (r, next) => reveal(r.nodeId, next))}
      onDeleteBranch={() => {
        act((d) => deleteNode(d, selNode.id, true));
        setSelected(undefined);
        setDetailsOpen(false);
        showToast(`Deleted ${selNode.id} and everything below it`, true);
      }}
      onSaveAsPreset={(name, icon) => void saveAsPreset(selNode.id, name, icon)}
      onLook={(opts) => act((d) => ({ display: rememberLook(updateNode(d, selNode.id, lightPatch(d.nodes[selNode.id], opts)).display, selNode, opts), nodeId: selNode.id }))}
      sameKindCount={sameKind(display, selNode).length}
      onLookAll={(opts) => {
        const n = sameKind(display, selNode).length;
        act((d) => ({ display: applyLookToAll(d, d.nodes[selNode.id], opts), nodeId: selNode.id }), () => showToast(`${n} lights now look the same`, true));
      }}
    />
  );

  return (
    <div className={`app${phone && mode === 'photo' && intent ? ' photo-focus' : ''}`}>
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
          {sync.state && (
            <button
              type="button"
              className={`sync-dot${sync.status.busy ? ' busy' : sync.status.error ? ' bad' : ''}`}
              aria-label={sync.status.busy ? 'Syncing' : sync.status.error ? 'Not synced: tap for details' : `Synced${sync.state.lastSyncAt ? ` ${ago(sync.state.lastSyncAt)}` : ''}`}
              title={sync.status.error ? `Not synced: ${sync.status.error}` : 'Sync with your other devices'}
              onClick={() => setSyncOpen({})}
            >
              ⇅
            </button>
          )}
          <button type="button" onClick={() => void newDisplay()} disabled={!persist.current}>
            New
          </button>
          <button type="button" onClick={() => void exportBackup()} disabled={!persist.current} aria-label="Back up" title="Download a JSON backup of every display (restore it from ⋯ → Import a backup)">
            <span className="wide-only">Back up</span>
            <span className="narrow-only" aria-hidden="true">💾</span>
          </button>
          <details className="menu">
            <summary aria-label="More display actions">⋯</summary>
            <div className="menu-list" role="menu">
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setMode((m) => (m === 'install' ? 'plan' : m)); setTextOpen(true); }}>
                Edit as text…
              </button>
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
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setLabels({}); }}>
                Labels and zip ties…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setShopping({}); }}>
                Shopping list…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); void exportExcel(); }}>
                Download as Excel (.xlsx)
              </button>
              <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); excelInput.current?.click(); }}>
                Import from Excel…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setInstallSheet({}); }}>
                Install sheet (print or PDF)…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); setDiagramPrint(true); }}>
                Print the plan diagram…
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); exportCsv(); }}>
                Download items as CSV
              </button>
              <button type="button" role="menuitem" onClick={(e) => { closeMenu(e); void exportDevices(); }}>
                Device list for dashboard (JSON)
              </button>
              {(server || sync.state) && (
                <button type="button" role="menuitem" disabled={!persist.current} onClick={(e) => { closeMenu(e); setSyncOpen({}); }}>
                  Sync with other devices…
                </button>
              )}
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
          <input
            ref={excelInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            aria-label="Excel file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importExcel(f);
            }}
          />
          <ThemeButton />
        </div>
      </header>
      {(() => {
        // One notice at a time: an update first, then a backup reminder, then the iPhone tip.
        if (updateReady)
          return (
            <div className="notice" role="status">
              <span>A new version of the app is ready.</span>
              <button type="button" className="primary" onClick={() => location.reload()}>
                Reload
              </button>
              <button type="button" onClick={() => setUpdateReady(false)}>
                Later
              </button>
            </div>
          );
        const syncedLately = !!sync.state?.lastSyncAt && Date.now() - sync.state.lastSyncAt < 14 * 24 * 60 * 60 * 1000;
        if (persist.current && !syncedLately && shouldNudgeBackup(safety, Date.now()))
          return (
            <div className="notice" role="status">
              <span>Your plans are only on this device. Back up so nothing is lost if the browser clears its data.</span>
              <button type="button" className="primary" onClick={() => void exportBackup()}>
                Back up now
              </button>
              <button type="button" onClick={() => updateSafety((s) => snoozeBackup(s, Date.now()))}>
                Later
              </button>
            </div>
          );
        if (persist.current && shouldShowIosTip(safety, iosTab))
          return (
            <div className="notice" role="status">
              <span>
                On iPhone, add this app to your Home Screen so Safari keeps your plans: tap <b>Share</b>, then <b>Add to Home Screen</b>.
              </span>
              <button type="button" onClick={() => updateSafety((s) => ({ ...s, iosTipDone: true }))}>
                Got it
              </button>
            </div>
          );
        return null;
      })()}

      <nav className="views" aria-label="View">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" className={mode === 'photo' ? 'on' : ''} aria-pressed={mode === 'photo'} onClick={() => { setMode('photo'); setMoving(undefined); setFitNonce((n) => n + 1); }}>
            Photo
          </button>
          <button type="button" className={mode === 'plan' ? 'on' : ''} aria-pressed={mode === 'plan'} onClick={() => { setMode('plan'); setIntent(undefined); setFitNonce((n) => n + 1); }}>
            Plan
          </button>
          <button type="button" className={mode === 'install' ? 'on' : ''} aria-pressed={mode === 'install'} onClick={() => { setMode('install'); setMoving(undefined); setIntent(undefined); }}>
            Install
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

      {mode === 'install' ? (
        <main className="field-mode">
          <InstallTab
            display={display}
            direction={installDir}
            onDirection={setInstallDir}
            scope={installScope}
            onScope={setInstallScope}
            onToggle={(st) =>
              installDir === 'up'
                ? act((d) => updateNode(d, st.id, { status: st.done ? 'planned' : 'installed' }))
                : act((d) => updateNode(d, st.id, { packed: st.done ? undefined : true }))
            }
            onClearPacked={() =>
              act((d) => {
                let out = d;
                for (const n of Object.values(d.nodes)) if (n.packed) out = updateNode(out, n.id, { packed: undefined }).display;
                return { display: out };
              })
            }
            onShow={showFromInstall}
            onPhotoMode={(vid) => {
              setMode('photo');
              if (vid) setViewId(vid);
              setIntent({ type: 'install' });
              setFitNonce((n) => n + 1);
            }}
            onInstallSheet={(vid) => setInstallSheet({ viewId: vid })}
            onPrintDiagram={() => setDiagramPrint(true)}
            onLabels={(vid) => setLabels({ scope: vid ? `view:${vid}` : '' })}
          />
        </main>
      ) : (
      <main className={`split${!phone ? ' with-inspector' : ''}${selBarShown ? ' has-selection' : ''}`}>
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
                if (!id) setDetailsOpen(false);
              }}
              intent={intent}
              setIntent={setIntent}
              onAddItem={() => setPhotoPicker(true)}
              onPlacePoint={placePoint}
              onFinishRun={finishRun}
              onSkipPlacing={skipPlacing}
              draftBase={draftBase}
              onAddMeasure={(m) => {
                if (!photoView) return;
                setIntent(undefined);
                const count = (photoView.measures?.length ?? 0) + 1;
                act(
                  (d) => addMeasure(d, photoView.id, m),
                  () => showToast(count > 1 ? `Scale from ${count} measurements: tap Scale set to see how well they agree` : 'Scale saved: runs now show their length and bulbs', true),
                );
              }}
              onRemoveMeasure={(i) => photoView && act((d) => removeMeasure(d, photoView.id, i))}
              canUndo={hist.past.length > 0}
              canRedo={hist.future.length > 0}
              onUndo={doUndo}
              onRedo={doRedo}
              onMovePlacement={(id, placement) => photoView && act((d) => setPlacement(d, id, photoView.id, placement))}
              onPlugInto={(id, parent, port) => {
                setIntent(undefined);
                act(
                  (d) => plugHere(d, id, { parent, port }),
                  (r) => {
                    setSelected(r.nodeId);
                    if (cordNote(r, parent)) return;
                    if (!r.warning) showToast(pluggedNote(r, id, parent, port), true);
                  },
                );
              }}
              onConnect={(it, childId) => {
                setIntent(undefined);
                act(
                  (d) => plugHere(d, childId, { parent: it.parentId, port: it.port }),
                  (r) => {
                    setSelected(childId);
                    if (cordNote(r, it.parentId)) return;
                    if (!r.warning) showToast(pluggedNote(r, childId, it.parentId, it.port), true);
                  },
                );
              }}
              onConnectNew={(it) => {
                setIntent(undefined);
                openPicker({ parent: it.parentId, port: it.port });
              }}
              onSocketTap={(runId, port) => setIntent({ type: 'connect', parentId: runId, port })}
              onSplice={spliceAt}
              onMoveTap={slideFemale}
              onRemoveFemale={dropFemale}
              onToggleInstalled={(id) => act((d) => updateNode(d, id, { status: d.nodes[id]?.status === 'planned' ? 'installed' : 'planned' }))}
              autoCords={autoCords}
              onShoppingList={(viewId) => setShopping({ viewId })}
              onInstallSheet={(viewId) => setInstallSheet({ viewId })}
              onLabels={(viewId) => setLabels({ scope: `view:${viewId}` })}
              onRenameView={(name) => photoView && act((d) => updateView(d, photoView.id, { name }))}
              onToggleAutoCords={() => {
                const next = !autoCords;
                setAutoCords(next);
                try {
                  localStorage.setItem(AUTO_CORDS_KEY, next ? '1' : '0');
                } catch {
                  // private mode: the choice lasts for this visit only
                }
              }}
              blocked={intent?.type === 'move' ? subtreeOf(intent.nodeId) : undefined}
              fitKey={`${doc.id}:${fitNonce}`}
            />
          ) : (
            <>
              {canDrag && !phone && <Palette selectedId={selected} custom={custom} onPick={(p) => selected && addPreset(p, { parent: selected })} />}
              <div className="diagram-wrap">
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
                  onDirection={setDirection}
                  onExportPng={exportPng}
                  renamingId={renaming}
                  onStartRename={(id) => {
                    setSelected(id);
                    setRenaming(id);
                  }}
                  onRename={commitRename}
                  onUnfold={(id) => updateFolded((f) => f.delete(id))}
                  onFoldAll={() =>
                    updateFolded((f) => {
                      for (const n of Object.values(display.nodes)) if (n.kind !== 'outlet' && childrenCount(n.id) > 0) f.add(n.id);
                    })
                  }
                  onUnfoldAll={() => updateFolded((f) => f.clear())}
                  onFind={() => setFindOpen(true)}
                  onHelp={() => setHelpOpen(true)}
                  showMinimap={canDrag && !phone}
                />
                {findOpen && (
                  <FindBox
                    display={display}
                    whereOf={(id) => {
                      const c = clusterOf(display, id);
                      return c === 'unplugged' ? 'not plugged in yet' : c ? `on ${c}` : '';
                    }}
                    onPick={(id) => {
                      setFindOpen(false);
                      jumpTo(id);
                    }}
                    onClose={() => setFindOpen(false)}
                  />
                )}
              </div>
            </>
          )}
          {phone && selBar}
        </section>
        {!phone && (
          <aside className="inspector" aria-label="Inspector">
            {selBarShown && selNode ? (
              <>
                {selBar}
                {nodePanel}
              </>
            ) : (
              <div className="inspector-empty">
                <h2>{title}</h2>
                <p className="muted small">
                  {stats.nodes} items · {stats.powerLinks} plugged in · {stats.signalLinks} signal links
                </p>
                <ul className="tips">
                  <li>
                    <b>Click an item</b> to plug something in, add another next to it, duplicate, rename or move it.
                  </li>
                  <li>
                    <b>Click “+ Unused socket”</b> to fill that exact socket.
                  </li>
                  <li>
                    <b>Keyboard:</b> <kbd>Tab</kbd> plug in, <kbd>Enter</kbd> add beside, <kbd>F2</kbd> rename, <kbd>/</kbd> find,
                    arrows to move around.
                  </li>
                  <li>Drag an item onto a socket to re-plug it, or drag from the palette.</li>
                </ul>
                <button type="button" onClick={() => setHelpOpen(true)}>
                  Shortcuts and colours
                </button>
              </div>
            )}
          </aside>
        )}
      </main>
      )}
      {phone && detailsOpen && selNode && (
        <Sheet title={`${selNode.id} details`} onClose={() => setDetailsOpen(false)}>
          {nodePanel}
        </Sheet>
      )}
      {textOpen && (
        <TextSheet
          value={doc.text}
          onChange={editText}
          readOnly={busy}
          diagnostics={doc.result.diagnostics}
          highlightLine={highlight >= 0 ? highlight : undefined}
          onCursorLine={selectFromOutline}
          suggestFor={(line) => suggest(line, [...custom, ...PRESETS]).map((p) => ({ id: p.id, icon: p.icon, text: presetText(p) }))}
          onClose={() => setTextOpen(false)}
        />
      )}
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}

      {dialog === 'restore' && doc && (
        <RestoreDialog load={() => listSnapshots(doc.id)} onSaveNow={saveRestorePoint} onRestore={restore} onClose={() => setDialog(null)} />
      )}
      {dialog === 'copy' && (
        <CopyDialog from={title} suggested={nextTitle(title)} onCopy={(t) => void copyDisplay(t)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'changes' && changes && (
        <ChangesDialog source={changes.source} changes={changes.list} onShow={showOnDiagram} onClose={() => setDialog(null)} />
      )}
      {shopping && (
        <ShoppingSheet
          display={display}
          initialViewId={shopping.viewId}
          onDownloadCsv={(csv, photo) => downloadText(csv, `${fileSlug(title)}${photo ? `-${fileSlug(photo)}` : ''}-shopping-list.csv`, 'text/csv')}
          onPick={(id) => {
            setShopping(null);
            if (mode === 'plan') jumpTo(id);
            else setSelected(id);
          }}
          onClose={() => setShopping(null)}
        />
      )}
      {syncOpen && (
        <SyncSheet
          state={sync.state}
          status={sync.status}
          linkCode={syncOpen.link}
          onTurnOn={sync.turnOn}
          onJoin={joinSync}
          onSyncNow={() => void sync.syncNow()}
          onTurnOff={() => {
            void sync.turnOff();
            showToast('Sync is off on this device. Your plans stay here.');
          }}
          onForget={() => {
            setSyncOpen(null);
            void forgetCloud();
          }}
          onClose={() => setSyncOpen(null)}
        />
      )}
      {diagramPrint && <DiagramPrint display={display} onClose={() => setDiagramPrint(false)} />}
      {installSheet && <InstallSheet display={display} photoUrls={photoUrls} initialViewId={installSheet.viewId} onClose={() => setInstallSheet(null)} />}
      {labels && (
        <LabelSheet
          display={display}
          initialScope={labels.scope}
          onPatchMany={(ids, patch) =>
            act(
              (d) => {
                let out = d;
                for (const id of ids) if (out.nodes[id]) out = updateNode(out, id, patch).display;
                return { display: out };
              },
              () => showToast(`Marked ${ids.length} label${ids.length === 1 ? '' : 's'} as printed`, true),
            )
          }
          onPatch={(id, patch) => act((d) => updateNode(d, id, patch))}
          onMarks={(m) =>
            act((d) => {
              // Turning colours on hands each outlet without one a different colour.
              let out: Display = { ...d, marks: m };
              if (m.colors) for (const [id, c] of Object.entries(assignTieColors(out))) out = updateNode(out, id, { tieColor: c }).display;
              return { display: out };
            })
          }
          onDownloadCsv={(csv) => downloadText(csv, `${fileSlug(title)}-labels.csv`, 'text/csv')}
          onClose={() => setLabels(null)}
        />
      )}
      {photoPicker && (
        <PresetPicker
          title="Add to the photo"
          custom={custom}
          onDeleteCustom={(p) => void deletePreset(p)}
          lead={photoView && <StartHere display={display} view={photoView} onPlace={(it) => { setPhotoPicker(false); setIntent(it); }} />}
          onClose={() => setPhotoPicker(false)}
          onPick={(p) => {
            setPhotoPicker(false);
            // Lights are drawn along the house (or around a bush); everything else is placed with a tap.
            setIntent(photoIntentFor(p));
          }}
        />
      )}
      {picker && (
        <PresetPicker
          title={targetTitle(picker)}
          custom={custom}
          onDeleteCustom={(p) => void deletePreset(p)}
          suggested={suggestionsFor(display, picker.parent, pickerLike)}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            const t = picker;
            setPicker(null);
            // On the photo, plugging something in puts it on the photo too, cable and all.
            if (mode === 'photo' && photoView) setIntent(photoIntentFor(p, t));
            else addPreset(p, t);
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
  /** Drawn as a run (lights, zip cord) rather than placed as a marker. */
  drawn: boolean;
  /** Lights can also light a bush. */
  canBush: boolean;
  /** A run drawn on this photo: inline females can be spliced in. */
  canSplice: boolean;
  /** A zip cord: unplugged items close to it that "Plug in nearby" would plug in. */
  nearby?: number;
  onPlugNearby?: () => void;
  /** Lights that are outlined as a bush (net lights, wraps) rather than drawn as a run. */
  defaultArea: boolean;
  onPlace: () => void;
  onDraw: (area: boolean) => void;
  onSplice: () => void;
  onSwapEnds: () => void;
  onRemove: () => void;
  onUseLength: (ft: number) => void;
  /** A cord that no longer reaches on this photo (see WiringLine.short). */
  short?: { have: number; need: number; fix?: number };
  onFixShort: (ft: number) => void;
}) {
  const { placement, lengthFt, drawn, canBush, defaultArea, short } = props;
  const ft = lengthFt !== undefined ? Math.round(lengthFt) : undefined;
  const area = placement && placement.kind !== 'point' ? placement.kind === 'area' : defaultArea;
  return (
    <>
      {short &&
        (short.fix ? (
          <button type="button" className="danger-solid" onClick={() => props.onFixShort(short.fix!)}>
            📏 Needs ~{short.need} ft: use a {short.fix} ft cord
          </button>
        ) : (
          <span className="short-note">
            The cords here add up to {short.have} ft; this gap needs about {short.need} ft.
          </span>
        ))}
      {drawn ? (
        <>
          <button type="button" className="primary" onClick={() => props.onDraw(area)}>
            {area ? '🌳' : '✏️'} {placement && placement.kind !== 'point' ? 'Redraw on photo' : area ? 'Outline on photo' : 'Draw on photo'}
          </button>
          {!!props.nearby && (
            <button type="button" className="primary" onClick={props.onPlugNearby}>
              🔌 Plug in {props.nearby} nearby
            </button>
          )}
          {props.canSplice && (
            <button type="button" onClick={props.onSplice}>
              ✂️ Add inline female
            </button>
          )}
          {placement?.kind === 'path' && (
            <button type="button" onClick={props.onSwapEnds} title="Make the other end the plug (male) end">
              ⇄ Swap plug and end
            </button>
          )}
          {canBush && (
            <button type="button" onClick={() => props.onDraw(!area)}>
              {area ? '✏️ Draw as a run' : '🌳 Light a bush'}
            </button>
          )}
        </>
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

/**
 * "Start here" at the top of "+ Add item" on a photo without an outlet or a scale yet:
 * everything plugs into an outlet, and measuring makes lengths and cords come out right.
 */
function StartHere({ display, view, onPlace }: { display: Display; view: { id: string; feetPerPx?: number }; onPlace: (it: PhotoIntent) => void }) {
  const onPhoto = Object.values(display.nodes).filter((n) => n.placements?.[view.id]);
  const hasOutlet = onPhoto.some((n) => n.kind === 'outlet');
  if (hasOutlet && view.feetPerPx) return null;
  const waiting = Object.values(display.nodes).find((n) => n.kind === 'outlet' && !n.placements?.[view.id]);
  return (
    <section className="start-here" aria-label="Start here">
      <h3>Start here</h3>
      <p className="muted small">
        {!hasOutlet ? 'Put an outlet on the photo first: everything plugs into one.' : ''}
        {!view.feetPerPx ? ' Measuring the photo makes lengths, bulbs and cords come out right.' : ''}
      </p>
      <div className="start-row">
        {!hasOutlet && (
          <button
            type="button"
            className="primary"
            onClick={() => onPlace(waiting ? { type: 'place', nodeId: waiting.id, name: `${waiting.id} ${waiting.label}` } : { type: 'place', presetId: 'outlet', name: 'Outlet' })}
          >
            🔌 {waiting ? `Place ${waiting.id} ${waiting.label}` : 'Add an outlet'}
          </button>
        )}
        {!view.feetPerPx && (
          <button type="button" onClick={() => onPlace({ type: 'scale' })}>
            📏 Measure the photo
          </button>
        )}
      </div>
    </section>
  );
}
