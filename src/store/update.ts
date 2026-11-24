/**
 * "A new version is ready": the build id baked into this copy of the app is compared with
 * version.json on the server (always fetched fresh). Only in production builds.
 */
export async function newVersionAvailable(fetchFn: typeof fetch = fetch, current = __BUILD_ID__): Promise<boolean> {
  try {
    const res = await fetchFn(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const v = (await res.json()) as { build?: unknown };
    return typeof v.build === 'string' && v.build !== '' && v.build !== current;
  } catch {
    return false; // offline: nothing to say
  }
}
