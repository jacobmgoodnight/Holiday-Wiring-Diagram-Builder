import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { newDisplay, outline } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const christmas = readFileSync(new URL('../fixtures/christmas-2026.outline.txt', import.meta.url), 'utf8');

async function load(page: Page, text: string) {
  await page.goto('./');
  await newDisplay(page);
  await outline(page).fill(text);
  await page.waitForTimeout(1100); // end the typing burst: later edits are their own undo steps
}

const menu = async (page: Page, item: string) => {
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('install checklist ticks write status into the same plan', async ({ page }) => {
  await load(page, halloween);
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(page.locator('.cl-total')).toHaveText('1 of 55 installed'); // S08 is [installed] in the fixture
  const o1 = page.getByRole('region', { name: 'O01 Front porch outlet' });
  await expect(o1.locator('.cl-row').first()).toContainText('O01');
  await o1.getByRole('checkbox', { name: 'C02 black cord: installed' }).check();
  await expect(page.locator('.cl-total')).toHaveText('2 of 55 installed');
  await o1.getByRole('button', { name: 'Verified: C02' }).click();
  await page.getByRole('checkbox', { name: 'Hide done' }).check();
  await expect(o1.getByRole('checkbox', { name: 'C02 black cord: installed' })).toHaveCount(0);
  // Back on the plan: the outline line carries the status, and the item is selected.
  await o1.locator('.cl-row', { hasText: 'K01' }).getByRole('button', { name: 'Show K01 on the diagram' }).click();
  await expect(outline(page)).toContainText('    left: C02 black cord 10ft [verified]\n');
  await expect(page.getByRole('region', { name: 'Details for K01' })).toBeVisible();
});

test('teardown runs back to the wall and remembers what is packed', async ({ page }) => {
  await load(page, halloween);
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await page.getByRole('button', { name: 'Teardown', exact: true }).click();
  const o3 = page.getByRole('region', { name: 'O03 Back porch outlet (temporary fog branch)' });
  await expect(o3.locator('.cl-row').last()).toContainText('O03');
  await o3.getByRole('checkbox', { name: /^S07 .*: packed$/ }).check();
  await expect(page.locator('.cl-total')).toHaveText('1 of 55 packed');
  await expect(outline(page)).toHaveCount(0); // field mode shows the checklist only
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await page.getByRole('button', { name: 'Teardown', exact: true }).click();
  await expect(page.locator('.cl-total')).toHaveText('1 of 55 packed');
});

test('copy for next year: fresh statuses, new items flagged, changes listed', async ({ page }) => {
  await load(page, halloween);
  await menu(page, 'Copy for next year…');
  const dialog = page.getByRole('dialog', { name: 'Copy for next year' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Halloween 2027');
  await dialog.getByRole('button', { name: 'Make the copy' }).click();
  await expect(page.getByRole('combobox', { name: 'Display' })).toHaveValue(/.+/);
  await expect(outline(page)).toHaveValue(/^# Halloween 2027\n/);
  await expect(outline(page)).not.toContainText('[installed]');
  // The original is untouched.
  await expect(page.getByRole('combobox', { name: 'Display' }).locator('option', { hasText: 'Halloween 2026' })).toHaveCount(1);

  // Find S03 from the checklist, then plug something into it from its panel.
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await page.getByRole('button', { name: 'Show S03 on the diagram' }).click();
  await page.getByRole('region', { name: 'Details for S03' }).getByRole('button', { name: '+ Plug something in' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Inflatable', exact: true }).first().click();
  await expect(outline(page)).toContainText('      3: Inflatable [new]\n');

  await menu(page, 'Changes since last year…');
  const changes = page.getByRole('dialog', { name: 'Changes since Halloween 2026' });
  await expect(changes).toContainText('Added (1)');
  await expect(changes).toContainText('Inflatable · into S03 · 3');
});

test('restore points: save, change, restore, and undo the restore', async ({ page }) => {
  await load(page, '# Restore\nO01 Porch\n  Wreath\n');
  await menu(page, 'Restore points…');
  await page.getByRole('button', { name: 'Save a restore point now' }).click();
  await expect(page.getByRole('dialog').locator('.snap-list li')).not.toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await outline(page).fill('# Restore\nO01 Porch\n  Wreath\n  Inflatable\n');
  await menu(page, 'Restore points…');
  const manual = page.getByRole('dialog').locator('.snap-list li', { hasText: 'Saved by you' });
  await manual.getByRole('button', { name: 'Restore' }).click();
  await expect(outline(page)).toHaveValue('# Restore\nO01 Porch\n  Wreath\n');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(outline(page)).toHaveValue('# Restore\nO01 Porch\n  Wreath\n  Inflatable\n');
});

test('tag filter fades everything else', async ({ page }) => {
  await load(page, christmas);
  await page.getByRole('button', { name: 'Overall', exact: true }).click();
  await page.getByRole('combobox', { name: 'Highlight tag' }).selectOption('roofline');
  await expect(page.locator('.dn:not(.dim):not(.ghost)')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Highlight tag' }).selectOption('');
  await expect(page.locator('.dn.dim')).toHaveCount(0);
});
