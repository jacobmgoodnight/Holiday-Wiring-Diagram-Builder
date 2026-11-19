import { expect, it } from 'vitest';
import { fileSlug, pngScale } from './exportImage';

it('makes safe file names', () => {
  expect(fileSlug('Christmas 2026 (example)')).toBe('christmas-2026-example');
  expect(fileSlug('!!!')).toBe('display');
});

it('limits PNG size for Safari', () => {
  expect(pngScale(1000, 800)).toBe(2);
  const s = pngScale(3000, 6000);
  expect(3000 * 6000 * s * s).toBeLessThanOrEqual(16_000_001);
});
