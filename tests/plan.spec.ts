import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { expectText, newDisplay, openDetails, setText } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const node = (page: Page, label: string) => page.locator(`.react-flow__node[aria-label^="${label}"]`);
const picker = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('searchbox', { name: 'Search presets' }) });
const pick = (page: Page, name: string) => picker(page).getByRole('button', { name: `Add ${name}`, exact: true }).first();

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'keyboard flow');

  test('mind-map keyboard flow: Tab, Enter, duplicate, arrows, fold, rename, delete', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await node(page, 'O01').click();

    // Tab plugs something into the selected item; the picker suggests what fits there.
    await page.keyboard.press('Tab');
    await expect(picker(page).getByRole('heading', { name: 'Suggested here' })).toBeVisible();
    await expect(picker(page).locator('.tiles.row').first().locator('.tile-name').first()).toHaveText('2-port smart plug');
    await pick(page, '2-port smart plug').click();
    await expect(page.getByRole('region', { name: 'Selected K01' })).toBeVisible();
    await page.keyboard.press('Tab');
    await pick(page, 'Extension cord').click();
    await page.keyboard.press('Tab');
    await expect(picker(page).locator('.tiles.row').first().locator('.tile-name').first()).toHaveText('3-way splitter');
    await pick(page, '4-way splitter').click();
    await page.keyboard.press('Tab');
    await pick(page, 'Spotlight').click();

    // Enter adds another item next to it: "Another Spotlight" is suggested first.
    await page.keyboard.press('Enter');
    await pick(page, 'Another Spotlight').click();
    // Ctrl/⌘+D duplicates in one keystroke.
    await page.keyboard.press('ControlOrMeta+d');
    await expectText(page, { contains: '      S01 4-way splitter\n        Spotlight\n        Spotlight\n        Spotlight\n' });

    // Arrow left goes to what it plugs into; Space folds and unfolds.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('region', { name: 'Selected S01' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Unfold S01 (3 hidden)' })).toBeVisible();
    await expect(node(page, 'L01')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(node(page, 'L01')).toHaveCount(1);

    // Arrow right and down walk the tree; F2 renames on the canvas.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('region', { name: 'Selected L02' })).toBeVisible();
    await page.keyboard.press('F2');
    const rename = page.getByRole('textbox', { name: 'Rename L02' });
    await expect(rename).toBeFocused();
    await rename.fill('Gable spotlight');
    await rename.press('Enter');
    await expectText(page, { contains: '        Spotlight\n        Gable spotlight\n        Spotlight\n' });

    // Delete removes it (and selects what it plugged into); Undo brings it back.
    await page.keyboard.press('Delete');
    await expect(page.getByRole('region', { name: 'Selected S01' })).toBeVisible();
    await expectText(page, { notContains: 'Gable spotlight' });
    await page.locator('body').press('ControlOrMeta+z');
    await expectText(page, { contains: 'Gable spotlight' });
  });

  test('double-click renames; Escape cancels', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await setText(page, '# R\nO01 Porch\n  Wreath\n');
    await node(page, 'L01').dblclick();
    const rename = page.getByRole('textbox', { name: 'Rename L01' });
    await rename.fill('Never mind');
    await rename.press('Escape');
    await expect(rename).toHaveCount(0);
    await expectText(page, '# R\nO01 Porch\n  Wreath\n');
  });

  test('find jumps to an item on another outlet; "/" opens it', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await setText(page, halloween);
    await page.getByRole('button', { name: 'O02 Garage-side outlet' }).click();
    await page.locator('body').press('/');
    const find = page.getByRole('searchbox', { name: 'Search the plan' });
    await find.fill('groundbr');
    await expect(page.getByRole('listbox', { name: 'Matches' })).toContainText('Groundbreaker blacklight · on O01');
    await find.press('Enter');
    await expect(page.getByRole('region', { name: /^Selected L\d+$/ })).toContainText('Groundbreaker blacklight');
    await expect(page.getByRole('button', { name: 'O01 Front porch outlet' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('fold all keeps exports complete; help lists shortcuts and colours', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await setText(page, halloween);
    await page.getByRole('button', { name: 'Overall', exact: true }).click();
    const before = await page.locator('.dn').count();
    await page.getByLabel('More diagram actions').click();
    await page.getByRole('menuitem', { name: 'Fold all branches' }).click();
    await expect.poll(() => page.locator('.dn').count()).toBeLessThan(before / 2);
    const dl = page.waitForEvent('download');
    await page.getByLabel('More diagram actions').click();
    await page.getByRole('menuitem', { name: 'Download SVG' }).click();
    const svg = readFileSync((await (await dl).path())!, 'utf8');
    for (const id of ['S08', 'C09', 'T01', 'S09']) expect(svg).toContain(`>${id}</tspan>`);
    // Folding is remembered on this device.
    await page.reload();
    await page.getByRole('button', { name: 'Overall', exact: true }).click();
    await expect.poll(() => page.locator('.dn').count()).toBeLessThan(before / 2);
    await page.getByLabel('More diagram actions').click();
    await page.getByRole('menuitem', { name: 'Unfold all' }).click();
    await expect.poll(() => page.locator('.dn').count()).toBe(before);

    await page.getByLabel('More diagram actions').click();
    await page.getByRole('menuitem', { name: 'Shortcuts and colours' }).click();
    const help = page.getByRole('dialog', { name: 'Shortcuts and colours' });
    await expect(help).toContainText('Plug something into the selected item');
    await expect(help).toContainText('New this year');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('the selection bar does the common things in one tap', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await setText(page, '# P\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n');
    await expect(page.getByRole('textbox', { name: 'Outline' })).toHaveCount(0); // no outline on the plan screen
    await node(page, 'L01').click();
    const bar = page.getByRole('region', { name: 'Selected L01' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByRole('region', { name: 'Selected L02' })).toBeVisible();
    await page.getByRole('region', { name: 'Selected L02' }).getByRole('button', { name: '+ Into S01' }).click();
    await pick(page, 'Another Spotlight').click();
    await expectText(page, '# P\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n    Spotlight\n    Spotlight\n');

    // Details open in a sheet; Fold from the bar; tap the "+3" pill to unfold.
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await node(page, 'S01').click();
    const details = await openDetails(page, 'S01');
    await expect(details.getByLabel('Sockets')).toHaveValue('3');
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'Selected S01' }).getByRole('button', { name: 'Fold' }).click();
    await expect(node(page, 'L01')).toHaveCount(0);
    await page.getByRole('button', { name: 'Unfold S01 (3 hidden)' }).click();
    await expect(node(page, 'L01')).toHaveCount(1);
  });
});
