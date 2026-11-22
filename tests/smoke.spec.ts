import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeText, expectText, newDisplay, openText, outline, setText } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');


test('outline → diagram, live, with saving and export', async ({ page, isMobile }) => {
  await page.goto('./');
  await expect(page.getByRole('combobox', { name: 'Display' })).toBeVisible();
  // Starts with the generic example.
  await expect(page.locator('.dn').first()).toBeVisible();

  await setText(page, halloween);
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

  // Tapping a diagram item selects it and shows its actions.
  // The view fits one frame after switching; retry if a click lands mid-jump under load.
  await expect(async () => {
    await page.locator('.dn', { hasText: 'S01' }).click();
    await expect(page.getByRole('region', { name: 'Selected S01' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 8000 });

  // In "Edit as text", the selected item's line is highlighted, and a typing mistake shows
  // inline without losing text.
  await openText(page);
  await expect(page.locator('.gl.g-sel')).toHaveText('37');
  await outline(page).fill(halloween + '     odd indent\n');
  await expect(page.locator('.gl.g-warning')).toHaveCount(1);
  await closeText(page);
  await expectText(page, halloween + '     odd indent\n');

  // Saved locally: survives an immediate reload (before the IndexedDB autosave fires).
  await page.reload();
  await expectText(page, halloween + '     odd indent\n');

  // SVG export downloads a file.
  const download = page.waitForEvent('download');
  await page.getByLabel('More diagram actions').click();
  await page.getByRole('menuitem', { name: 'Download SVG' }).click();
  expect((await download).suggestedFilename()).toBe('halloween-2026.svg');
});

test('a second display is kept separately', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('combobox', { name: 'Display' })).toBeVisible();
  await newDisplay(page);
  await setText(page, '# Garage test\nO01 Garage outlet\n  Inflatable 120W\n');
  await expect(page.getByRole('combobox', { name: 'Display' })).toContainText('Garage test');
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Christmas 2026 (example)' });
  await expectText(page, /^# Christmas 2026 \(example\)/);
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Garage test' });
  await expectText(page, '# Garage test\nO01 Garage outlet\n  Inflatable 120W\n');
});

test('deleting a display asks in the page, and Cancel keeps it', async ({ page }) => {
  await page.goto('./');
  await newDisplay(page);
  await setText(page, '# Keep me\nO01 Porch\n');
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Delete this display' }).click();
  const ask = page.getByRole('dialog', { name: 'Delete display' });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expectText(page, '# Keep me\nO01 Porch\n');
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Delete this display' }).click();
  await ask.getByRole('button', { name: 'Delete display' }).click();
  await expect(page.getByRole('combobox', { name: 'Display' }).locator('option', { hasText: 'Keep me' })).toHaveCount(0);
});
