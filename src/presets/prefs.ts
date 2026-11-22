/** Recent and favourite presets: per-device conveniences in localStorage (never required). */
const RECENT = 'wiring-sketchpad.recentPresets';
const FAVS = 'wiring-sketchpad.favoritePresets';
const MAX_RECENT = 8;

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* blocked storage: lists just reset next visit */
  }
}

export const getRecent = () => read(RECENT);
export const getFavorites = () => read(FAVS);

export function noteUsed(id: string): string[] {
  const next = [id, ...getRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
  write(RECENT, next);
  return next;
}

export function toggleFavorite(id: string): string[] {
  const cur = getFavorites();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  write(FAVS, next);
  return next;
}
