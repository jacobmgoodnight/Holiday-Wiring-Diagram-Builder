import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newDisplay, outline } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');


test('outline → diagram, live, with saving and export', async ({ page, isMobile }) => {
  await page.goto('./');
  await expect(outline(page)).toBeVisible();
  // Starts with the generic example.
  await expect(page.locator('.dn').first()).toBeVisible();

  await outline(page).fill(halloween);
  await expect(page.locator('.counts')).toHaveText('55 items · 46 power · 4 signal');

  if (isMobile) {
    // Phones keep whatever view is chosen; Overall is one tap away.
    await page.getByRole('button', { name: 'Overall', exact: true }).click();
  }
  await expect(page.locator('.cluster-title')).toHaveText([
    'O01 Front porch outlet',
    'O02 Garage-side outlet',
    'O03 Back porch outlet (temporary fog branch)',
    'O04 Office outlet',
    'O05 Garage window',
    'O06 Upstairs window',
  ]);

  // One outlet at a time.
  await page.getByRole('button', { name: 'O02 Garage-side outlet' }).click();
  await expect(page.locator('.cluster-title')).toHaveText(['O02 Garage-side outlet']);
  await expect(page.locator('.dn:not(.ghost)')).toHaveCount(11);
  await expect(page.locator('.dn.ghost')).toHaveCount(4);

  // Tapping a diagram item highlights its outline line.
  await page.locator('.dn', { hasText: 'S01' }).click();
  await expect(page.locator('.gl.g-sel')).toHaveText('37');

  // A typing mistake shows inline without losing text.
  await outline(page).fill(halloween + '     odd indent\n');
  await expect(page.locator('.gl.g-warning')).toHaveCount(1);
  await expect(outline(page)).toHaveValue(halloween + '     odd indent\n');

  // Saved locally: survives an immediate reload (before the IndexedDB autosave fires).
  await page.reload();
  await expect(outline(page)).toHaveValue(halloween + '     odd indent\n');

  // SVG export downloads a file.
  const download = page.waitForEvent('download');
  await page.getByLabel('Export').click();
  await page.getByRole('button', { name: 'SVG' }).click();
  expect((await download).suggestedFilename()).toBe('halloween-2026.svg');
});

test('a second display is kept separately', async ({ page }) => {
  await page.goto('./');
  await expect(outline(page)).toBeVisible();
  await newDisplay(page);
  await outline(page).fill('# Garage test\nO01 Garage outlet\n  Inflatable 120W\n');
  await expect(page.getByRole('combobox', { name: 'Display' })).toContainText('Garage test');
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Christmas 2026 (example)' });
  await expect(outline(page)).toHaveValue(/^# Christmas 2026 \(example\)/);
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Garage test' });
  await expect(outline(page)).toHaveValue('# Garage test\nO01 Garage outlet\n  Inflatable 120W\n');
});
