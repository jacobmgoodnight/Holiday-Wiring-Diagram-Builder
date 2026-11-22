/**
 * Model → outline sync for diagram edits: write the outline from the model, then re-read it
 * with the model as history so IDs and model-only fields (notes, socket counts) carry over.
 */
import type { Display } from '../model/types';
import { type BuildResult, buildDisplay } from './build';
import { serializeOutline } from './serialize';

export function syncFromModel(display: Display): { text: string; result: BuildResult } {
  const { text, lineNodeIds } = serializeOutline(display);
  const result = buildDisplay(text, { previous: { display, text, lineNodeIds } });
  return { text, result };
}
