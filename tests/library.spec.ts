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
  await menu(page, 'Labels and zip ties…');
  const sheet = page.getByRole('dialog', { name: 'Labels' });
  await expect(sheet.locator('.label').first()).toContainText('K01');
  // Cords: the same short label on both ends (the flag format prints each side twice).
  await expect(sheet.getByLabel('Label C02 10 ft', { exact: true })).toHaveCount(2);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.bar')).toBeHidden();
  await expect(sheet.locator('.labels-controls')).toBeHidden();
  await expect(sheet.locator('.label').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  await sheet.getByLabel('Format').selectOption('maker');
  await sheet.getByRole('checkbox', { name: 'Where it plugs in' }).check();
  await expect(sheet.getByLabel('Label text')).toContainText('C02 10 ft · into K01 left');
  const dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Download CSV for label software' }).click();
  expect((await dl).suggestedFilename()).toBe('halloween-2026-labels.csv');
  await sheet.getByRole('button', { name: 'Close labels' }).click();
  await expect(sheet).toHaveCount(0);
});

test('labels: zip ties by outlet colour and story, where lights go; marks show on install day', async ({ page }) => {
  await load(page, '# Ties\nO01 Porch outlet\n  C01 green cord 25ft\n    L01 C9 roofline run\nO02 Garage outlet\n  L02 Wreath\n');
  await menu(page, 'Labels and zip ties…');
  const sheet = page.getByRole('dialog', { name: 'Labels' });
  const prep = sheet.getByRole('status');
  await expect(prep).toHaveText('4 labels'); // C01 (both ends), L01, L02; no ties yet
  await expect(sheet.locator('.tie-dots')).toHaveCount(0);

  // Colours: each outlet gets a different one, and you can change it.
  await sheet.getByRole('checkbox', { name: 'A colour for each outlet' }).check();
  await sheet.getByText(/^Set up/).click();
  await expect(sheet.getByLabel('Zip-tie colour for O01')).toHaveValue('red');
  await expect(sheet.getByLabel('Zip-tie colour for O02')).toHaveValue('blue');
  await sheet.getByLabel('Zip-tie colour for O02').selectOption('white');
  await expect(prep).toHaveText('4 labels · zip ties: 3 red, 1 white');

  // Stories: the roofline goes on the second story, so it gets two ties.
  await sheet.getByRole('checkbox', { name: /One tie per story/ }).check();
  await sheet.getByRole('group', { name: 'Story for L01' }).getByRole('button', { name: '2' }).click();
  await expect(prep).toHaveText('4 labels · zip ties: 4 red, 1 white');
  await expect(sheet.getByRole('img', { name: '2 red ties' }).first()).toBeVisible();

  // Where the lights go becomes their label.
  await sheet.getByLabel('Where L01 goes').fill('Garage peak');
  await sheet.getByLabel('Where L01 goes').press('Enter');
  await expect(sheet.getByLabel('Label L01 Garage peak', { exact: true })).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Close labels' }).click();

  // On install day the steps show the same marks, and say what goes up high.
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  const step = page.getByRole('list', { name: 'Steps to put it up' }).locator('li', { hasText: 'L01' });
  await expect(step).toContainText('Plug L01 C9 roofline run into C01 (2nd story).');
  await expect(step.getByRole('img', { name: '2 red ties' })).toBeVisible();
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
