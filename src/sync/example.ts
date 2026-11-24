import { buildDisplay } from '../outline';
import { SAMPLE_OUTLINE } from '../sample';
import type { StoredDisplay } from '../store/db';

/**
 * The starter example exactly as the app made it on first run (never edited). A device that
 * joins sync drops its own, so the plans do not end up with one example per device.
 */
export function isUntouchedExample(rec: Pick<StoredDisplay, 'id' | 'text' | 'display'>): boolean {
  if (rec.text !== SAMPLE_OUTLINE) return false;
  return JSON.stringify(buildDisplay(SAMPLE_OUTLINE, { id: rec.id }).display) === JSON.stringify(rec.display);
}
