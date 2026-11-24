import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { closeText, expectText, newDisplay, openDetails, openText, outline, setText } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');

async function load(page: Page, text: string) {
  await page.goto('./');
  await newDisplay(page);
  await setText(page, text);
  await page.waitForTimeout(1100);
}

const menu = async (page: Page, item: string) => {
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('save an item as a preset, add it, autocomplete it, remove it', async ({ page }) => {
  await load(page, '# Lib\nO01 Porch\n  C01 green cord 25ft\n  S01 3-way splitter\n');
  await page.locator('.react-flow__node[aria-label^="C01"]').click();
  const panel = await openDetails(page, 'C01');
  await panel.getByRole('button', { name: 'Save as preset' }).click();
  await panel.getByLabel('Preset name').fill('Green 25');
  await panel.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.locator('.toast')).toContainText('Saved "Green 25"');

  // In the picker under My presets.
  await page.keyboard.press('Escape'); // close the details sheet on phones
  await page.locator('.react-flow__node[aria-label^="S01"]').click();
  await page.getByRole('region', { name: 'Selected S01' }).getByRole('button', { name: '+ Plug in' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'My presets' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add Green 25', exact: true }).first().click();
  await expectText(page, '# Lib\nO01 Porch\n  C01 green cord 25ft\n  S01 3-way splitter\n    C02 green cord 25ft\n');

  // "Edit as text" autocomplete offers it while typing.
  await openText(page);
  await outline(page).focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('    gre');
  const sug = page.getByRole('button', { name: /green cord 25ft/ });
  await expect(sug).toBeVisible();
  await sug.click();
  await expect(outline(page)).toHaveValue(/\n    green cord 25ft$/);
  await closeText(page);

  // Remove it from My presets.
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.locator('.react-flow__node[aria-label^="S01"]').click();
  await page.getByRole('region', { name: 'Selected S01' }).getByRole('button', { name: '+ Plug in' }).click();
  await dialog.getByRole('button', { name: 'Remove my preset Green 25' }).click();
  await page.getByRole('dialog', { name: 'Remove preset' }).getByRole('button', { name: 'Remove preset' }).click();
  await expect(dialog.getByRole('heading', { name: 'My presets' })).toHaveCount(0);
});

test('labels: paper sheet prints only the labels; label-maker text and CSV', async ({ page }) => {
  await load(page, halloween);
  await menu(page, 'Cord and plug labels…');
  const sheet = page.getByRole('dialog', { name: 'Cord and plug labels' });
  await expect(sheet.locator('.label').first()).toContainText('K01');
  await expect(sheet.locator('.label', { hasText: 'K01-left → S02' })).toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.bar')).toBeHidden();
  await expect(sheet.locator('.labels-controls')).toBeHidden();
  await expect(sheet.locator('.label').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  await sheet.getByLabel('Format').selectOption('maker');
  await expect(sheet.getByLabel('Label text')).toContainText('C02: K01-left → S02 ');
  const dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Download CSV for label software' }).click();
  expect((await dl).suggestedFilename()).toBe('halloween-2026-labels.csv');
  await sheet.getByRole('button', { name: 'Close labels' }).click();
  await expect(sheet).toHaveCount(0);
});

test('CSV of items', async ({ page }) => {
  await load(page, halloween);
  const dl = page.waitForEvent('download');
  await menu(page, 'Download items as CSV');
  const file = await dl;
  expect(file.suggestedFilename()).toBe('halloween-2026.csv');
  const text = readFileSync((await file.path())!, 'utf8');
  expect(text.split('\r\n')[0]).toMatch(/^id,kind,name,plugs_into,socket/);
  expect(text).toContain('C02,cord,black cord,K01,left,power,planned');
});

test('back up all displays and import them again without overwriting', async ({ page }) => {
  await load(page, halloween);
  const dl = page.waitForEvent('download');
  await menu(page, 'Back up all displays (JSON)');
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^wiring-sketchpad-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = (await file.path())!;

  await page.getByLabel('Backup file').setInputFiles(path);
  await expect(page.locator('.toast')).toContainText('already here came in as copies');
  await expectText(page, /^# .* \(imported\)\n/);
  // The original is still there, unchanged.
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Halloween 2026' });
  await expectText(page, halloween);
});

test('a file that is not a backup is refused with a reason', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('combobox', { name: 'Display' })).toBeVisible();
  await page.getByLabel('Backup file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('.toast')).toContainText('not a Wiring Sketchpad backup');
});

test('one-click Back up button downloads the same backup', async ({ page }) => {
  await load(page, halloween);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up', exact: true }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^wiring-sketchpad-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(backup.format).toBe('wiring-sketchpad-backup');
  expect(backup.displays.some((d: { title: string }) => d.title === 'Halloween 2026')).toBe(true);
});

test('Excel: download, then import it back as a new display', async ({ page }) => {
  await load(page, halloween);
  const dl = page.waitForEvent('download');
  await menu(page, 'Download as Excel (.xlsx)');
  const file = await dl;
  expect(file.suggestedFilename()).toBe('halloween-2026.xlsx');

  await page.getByLabel('Excel file').setInputFiles((await file.path())!);
  await expect(page.locator('.toast')).toContainText('Imported "Halloween 2026 (imported)" with 55 items as a new display.');
  await expectText(page, /^# Halloween 2026 \(imported\)\n/);
  // The original is still there, unchanged.
  await page.getByRole('combobox', { name: 'Display' }).selectOption({ label: 'Halloween 2026' });
  await expectText(page, halloween);
});

test('an Excel file that is not a workbook is refused with a reason', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('combobox', { name: 'Display' })).toBeVisible();
  await page.getByLabel('Excel file').setInputFiles({ name: 'x.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') });
  await expect(page.locator('.toast')).toContainText('not an Excel workbook');
});

test('device list for the dashboard', async ({ page }) => {
  await load(page, halloween);
  const dl = page.waitForEvent('download');
  await menu(page, 'Device list for dashboard (JSON)');
  const file = await dl;
  expect(file.suggestedFilename()).toBe('halloween-2026-devices.json');
  const data = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(data.format).toBe('holiday-devices');
  expect(data.devices).toHaveLength(55);
  expect(data.devices.find((d: { id: string }) => d.id === 'C02')).toMatchObject({ plugsInto: 'K01', socket: 'left', outlet: 'O01' });
});
