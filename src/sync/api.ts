/**
 * The sync server: a few database functions (supabase/migrations/*_hwd_sync.sql) that store
 * and return scrambled blobs by lookup id. They can't read anything, and nothing else in the
 * database is reachable with this key.
 */
export interface SyncServer {
  url: string;
  /** The project's public (anon/publishable) key: it only allows calling these functions. */
  key: string;
}

/** The sync server (supabase/migrations/*_hwd_sync*.sql). The key is the project's public one. */
export const SYNC_SERVER: SyncServer | undefined = {
  url: 'https://rwqclcpmtuebxndadkxv.supabase.co',
  key: 'sb_publishable_n9bHU-XwYaLOHmC_dh3UEw_aEGuoqBj',
};

const OVERRIDE = 'wiring-sketchpad.syncServer';

/** The server to use: a local override (tests, development) or the built-in one. */
export function syncServer(): SyncServer | undefined {
  try {
    const raw = localStorage.getItem(OVERRIDE);
    if (raw) {
      const s = JSON.parse(raw) as SyncServer;
      if (s.url && s.key) return s;
    }
  } catch {
    // ignore
  }
  return SYNC_SERVER;
}

export interface SyncApi {
  pull(lookup: string): Promise<{ rev: number; doc: string } | undefined>;
  /** Write a new cloud copy over `baseRev` (0 = first). Returns the new rev, or 0 when someone else wrote first. */
  push(lookup: string, baseRev: number, doc: string): Promise<number>;
  photoIds(lookup: string): Promise<string[]>;
  photoPut(lookup: string, id: string, data: string): Promise<void>;
  photoGet(lookup: string, id: string): Promise<string | undefined>;
  /** Delete the cloud copy (all devices keep their own plans). */
  forget(lookup: string): Promise<void>;
}

export function syncApi(server = syncServer()): SyncApi {
  if (!server) throw new Error('Sync is not set up for this app yet');
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const headers: Record<string, string> = { apikey: server.key, 'Content-Type': 'application/json' };
    if (server.key.startsWith('eyJ')) headers.Authorization = `Bearer ${server.key}`; // legacy anon JWT
    let res: Response;
    try {
      res = await fetch(`${server.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch {
      throw new Error('Could not reach the sync server (offline?)');
    }
    if (!res.ok) {
      let msg = `Sync server error ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) msg += `: ${body.message}`;
      } catch {
        // keep the status
      }
      throw new Error(msg);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  return {
    pull: async (lookup) => (await call<{ rev: number; doc: string }[]>('hwd_pull', { p_lookup: lookup }))?.[0],
    push: async (lookup, baseRev, doc) => Number(await call<number>('hwd_push', { p_lookup: lookup, p_base_rev: baseRev, p_doc: doc })) || 0,
    photoIds: async (lookup) => (await call<string[]>('hwd_photo_ids', { p_lookup: lookup })) ?? [],
    photoPut: async (lookup, id, data) => {
      await call('hwd_photo_put', { p_lookup: lookup, p_photo_id: id, p_data: data });
    },
    photoGet: async (lookup, id) => (await call<string | null>('hwd_photo_get', { p_lookup: lookup, p_photo_id: id })) ?? undefined,
    forget: async (lookup) => {
      await call('hwd_forget', { p_lookup: lookup });
    },
  };
}
