import { describe, expect, it } from 'vitest';
import { buildDisplay } from '../outline';
import { SAMPLE_OUTLINE } from '../sample';
import { isUntouchedExample } from './example';

describe('the starter example on joining sync', () => {
  const made = (text = SAMPLE_OUTLINE) => ({ id: 'd1', text, display: buildDisplay(text, { id: 'd1' }).display });

  it('is dropped only when it is exactly as the app made it', () => {
    expect(isUntouchedExample(made())).toBe(true);
    expect(isUntouchedExample(made(SAMPLE_OUTLINE.replace('Front porch', 'Back porch')))).toBe(false);
    const moved = made();
    moved.display = { ...moved.display, views: [{ id: 'v1', name: 'Front', photoId: 'p1', width: 10, height: 10 }] };
    expect(isUntouchedExample(moved)).toBe(false); // a photo was added: keep it
  });
});
