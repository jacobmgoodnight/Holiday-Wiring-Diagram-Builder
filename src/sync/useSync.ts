/**
 * Sync in the app: runs a sync when the app opens, a few seconds after edits, when the app
 * comes back to the screen, and every minute or two while it is open. One sync at a time;
 * asking during a sync runs one more afterwards.
 */
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type SyncServer, syncApi } from './api';
import { newSyncCode, normalizeCode } from './code';
import { deriveKeys, openJson } from './crypto';
import { type SyncOutcome, type SyncState, readSyncState, runSync, writeSyncState } from './engine';
import type { SyncDoc } from './merge';

export interface SyncStatus {
  busy: boolean;
  error?: string;
}

interface Options {
  /** The plans have loaded and storage works. */
  ready: boolean;
  server: SyncServer | undefined;
  /** Save pending edits first. */
  beforeSync: () => Promise<void>;
  /** Show what arrived; `editedDuring` is true when the user edited while the sync ran. */
  afterSync: (o: SyncOutcome, editedDuring: boolean) => Promise<void>;
  /** Goes up with every edit. */
  editSeq: MutableRefObject<number>;
}

const EVERY_MS = 90_000;
const AFTER_EDIT_MS = 4_000;

export class SyncJoinError extends Error {}

export function useSync({ ready, server, beforeSync, afterSync, editSeq }: Options) {
  const [state, setState] = useState<SyncState | undefined>();
  const [status, setStatus] = useState<SyncStatus>({ busy: false });
  const stateRef = useRef<SyncState | undefined>(undefined);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const cb = useRef({ beforeSync, afterSync });
  cb.current = { beforeSync, afterSync };

  const setBoth = (s: SyncState | undefined) => {
    stateRef.current = s;
    setState(s);
  };

  const run = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const go = async () => {
      do {
        again.current = false;
        const s = stateRef.current;
        if (!s || !server) return;
        dirty.current = false;
        setStatus((st) => ({ ...st, busy: true }));
        try {
          await cb.current.beforeSync();
          const seq = editSeq.current;
          const out = await runSync(s, syncApi(server));
          // Turned off (or switched codes) while this ran: keep what arrived, but stay off.
          if (stateRef.current?.code !== s.code) return setStatus({ busy: false });
          await writeSyncState(out.state);
          setBoth(out.state);
          await cb.current.afterSync(out, editSeq.current !== seq);
          setStatus({ busy: false });
        } catch (e) {
          setStatus({ busy: false, error: e instanceof Error ? e.message : 'Sync failed' });
          return;
        }
      } while (again.current);
    };
    running.current = go().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [server, editSeq]);

  // Start: read the saved state and sync once.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void readSyncState().then((s) => {
      if (!live) return;
      setBoth(s);
      if (s) void run();
    });
    return () => {
      live = false;
    };
  }, [ready, run]);

  // While on: every so often, and when the app comes back (or leaves with unsynced edits).
  const on = !!state;
  useEffect(() => {
    if (!on) return;
    const every = window.setInterval(() => document.visibilityState === 'visible' && void run(), EVERY_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible' || dirty.current) void run();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [on, run]);

  /** Something changed here: sync in a few seconds. */
  const syncSoon = useCallback(() => {
    if (!stateRef.current) return;
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), AFTER_EDIT_MS);
  }, [run]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Start syncing with a new code (this device's plans become the cloud copy). */
  const turnOn = async () => {
    const s: SyncState = { code: newSyncCode(), base: { hashes: {} } };
    await writeSyncState(s);
    setBoth(s);
    await run();
  };

  /** Join plans synced from another device. Checks the code finds them first. */
  const join = async (input: string) => {
    if (!server) throw new SyncJoinError('Sync is not available in this version of the app.');
    const code = normalizeCode(input);
    if (!code) throw new SyncJoinError('That is not a sync code. It has 24 letters and numbers, like 7KQM-2XRD-….');
    setStatus({ busy: true });
    try {
      const keys = await deriveKeys(code);
      const row = await syncApi(server).pull(keys.lookup);
      if (!row) throw new SyncJoinError('No synced plans use that code. Check it on your other device (⋯ → Sync with other devices).');
      try {
        await openJson<SyncDoc>(keys, row.doc, 'doc');
      } catch {
        throw new SyncJoinError('That code does not open the synced plans.');
      }
    } catch (e) {
      setStatus({ busy: false });
      throw e;
    }
    setStatus({ busy: false });
    const s: SyncState = { code, base: { hashes: {} } };
    await writeSyncState(s);
    setBoth(s);
    await run();
  };

  /** Stop syncing on this device (its plans stay). */
  const turnOff = async () => {
    window.clearTimeout(timer.current);
    await writeSyncState(undefined);
    setBoth(undefined);
    setStatus({ busy: false });
  };

  /** Delete the cloud copy, then stop syncing here. */
  const forget = async () => {
    const s = stateRef.current;
    if (!s || !server) return turnOff();
    const keys = await deriveKeys(s.code);
    await syncApi(server).forget(keys.lookup);
    await turnOff();
  };

  return { state, status, syncNow: run, syncSoon, turnOn, join, turnOff, forget };
}
