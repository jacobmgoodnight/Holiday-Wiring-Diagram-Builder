/**
 * Undo/redo shared by both editors. Snapshots are whole documents (outline + model), so undo
 * always restores both views together. Bursts of typing coalesce into one step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey?: string;
  lastAt?: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export interface PushOptions {
  /** Consecutive pushes with the same key within COALESCE_MS become one undo step. */
  coalesceKey?: string;
  now?: number;
}

export function push<T>(h: History<T>, next: T, opts: PushOptions = {}): History<T> {
  const now = opts.now ?? Date.now();
  const merge = opts.coalesceKey !== undefined && h.lastKey === opts.coalesceKey && h.lastAt !== undefined && now - h.lastAt < COALESCE_MS;
  if (merge) return { ...h, present: next, future: [], lastAt: now };
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: opts.coalesceKey, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
