import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { expectText, newDisplay, setText } from './helpers';

const halloween = readFileSync(new URL('../fixtures/halloween-2026.outline.txt', import.meta.url), 'utf8');
const SAFE = { name: 'wiring-sketchpad.safety', value: '{"editsSinceBackup":0,"iosTipDone":true,"snoozeUntil":32503680000000}' };

/** Screen point for a spot on the sample house (1600 × 1000 drawing). */
async function tap(page: Page, x: number, y: number) {
  await page.waitForTimeout(150);
  const img = (await page.locator('.photo-stage img').boundingBox())!;
  await page.mouse.click(img.x + (img.width * x) / 1600, img.y + (img.height * y) / 1000);
}

test.describe('first visit', () => {
  // No tab or layout remembered yet.
  test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [SAFE] }] } });

  test('opens on the Photo tab; tabs are Photo, Plan, Install; phones get the tall plan', async ({ page, isMobile }) => {
    await page.goto('./');
    const tabs = page.getByRole('group', { name: 'Mode' }).getByRole('button');
    await expect(tabs).toHaveText(['Photo', 'Plan', 'Install']);
    await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Try it with a sample house' })).toBeVisible();

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    if (!isMobile) await page.getByRole('button', { name: 'Overall', exact: true }).click();
    const o1 = (await page.locator('.react-flow__node-item', { hasText: 'O01 Front porch outlet' }).boundingBox())!;
    const k1 = (await page.locator('.react-flow__node-item', { hasText: 'K01 Kasa' }).boundingBox())!;
    if (isMobile) {
      // Tall: K01 sits under the outlet, one step in.
      expect(k1.y).toBeGreaterThan(o1.y + o1.height - 2);
      expect(k1.x - o1.x).toBeGreaterThan(20);
      expect(k1.x - o1.x).toBeLessThan(60);
    } else {
      expect(k1.x).toBeGreaterThan(o1.x + o1.width); // wide: to the right
    }
    // Switch layouts from the diagram menu; the choice is remembered.
    await page.getByLabel('More diagram actions').click();
    await page.getByRole('menuitem', { name: isMobile ? 'Wide layout (left to right)' : 'Tall layout (top to bottom)' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('More diagram actions').click();
    await expect(page.getByRole('menuitem', { name: isMobile ? 'Tall layout (top to bottom)' : 'Wide layout (left to right)' })).toBeVisible();
  });
});

test('install sheet: choose what it includes; print the plan diagram one outlet per page', async ({ page }) => {
  await page.goto('./');
  await newDisplay(page);
  await setText(page, halloween);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: '🖨 Install sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Install sheet' });
  await expect(sheet.getByRole('region', { name: 'What to buy' })).toBeVisible();
  // Already have everything: leave the shopping list off.
  await sheet.getByRole('checkbox', { name: 'What to buy' }).uncheck();
  await expect(sheet.getByRole('region', { name: 'What to buy' })).toHaveCount(0);
  await sheet.getByRole('checkbox', { name: 'Plan diagram' }).check();
  await expect(sheet.getByRole('img', { name: /^Plan diagram: O01/ })).toBeVisible();
  // A take-down sheet instead.
  await sheet.getByRole('button', { name: 'Take down', exact: true }).click();
  await expect(sheet.getByRole('region', { name: 'Steps' })).toContainText('Take down, in this order');
  await expect(sheet.getByRole('region', { name: 'Steps' })).toContainText('1. ');
  await sheet.getByRole('button', { name: 'Close install sheet' }).click();
  // Remembered next time.
  await page.getByRole('button', { name: '🖨 Install sheet' }).click();
  await expect(sheet.getByRole('checkbox', { name: 'What to buy' })).not.toBeChecked();
  await sheet.getByRole('button', { name: 'Close install sheet' }).click();

  await page.getByRole('button', { name: '🖨 Plan diagram' }).click();
  const print = page.getByRole('dialog', { name: 'Print the plan diagram' });
  const outlets = await print.locator('.plan-figure').count();
  expect(outlets).toBeGreaterThan(2); // one per outlet (and one for what is not plugged in)
  await expect(print.locator('.plan-figure.page')).toHaveCount(outlets);
  await print.getByRole('checkbox', { name: 'One outlet per page' }).uncheck();
  await expect(print.locator('.plan-figure.page')).toHaveCount(0);
  await print.getByRole('button', { name: 'Tall', exact: true }).click();
  await expect(print.getByRole('checkbox', { name: 'Sideways (landscape)' })).not.toBeChecked();
  await print.getByRole('button', { name: 'Close plan diagram' }).click();
});

test('zip cord: draw it past the bushes and plug them all in with one tap', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wiring-sketchpad.followEdges', '0'));
  await page.goto('./');
  await newDisplay(page);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Try it with a sample house' }).click();
  await expect(page.locator('.photo-stage img')).toBeVisible();
  for (const cx of [390, 848]) {
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('searchbox').fill('net');
    await page.getByRole('dialog').getByRole('button').filter({ hasText: /Net lights/ }).first().click();
    for (const [dx, dy] of [[0, 735], [40, 715], [0, 700], [-40, 715]] as const) await tap(page, cx + dx, dy);
    await page.getByRole('button', { name: 'Done' }).click();
    // Once something is on the photo, a new item asks what it plugs into: not yet.
    const later = page.locator('.photo-banner').getByRole('button', { name: 'Later' });
    await page.waitForTimeout(200);
    if (await later.count()) await later.click();
  }
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByRole('searchbox').fill('spt');
  await page.getByRole('dialog').getByRole('button', { name: /SPT-1 zip cord/ }).first().click();
  // No window or arch shapes for a cord.
  await expect(page.getByRole('group', { name: 'Shape' })).toHaveCount(0);
  await tap(page, 250, 760);
  await tap(page, 1000, 760);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.toast')).toContainText('2 items along C01 can plug into it');
  const later = page.locator('.photo-banner').getByRole('button', { name: 'Later' });
  if (await later.count()) await later.click();
  await page.getByRole('region', { name: 'Selected C01' }).getByRole('button', { name: '🔌 Plug in 2 nearby' }).click();
  await expect(page.locator('.toast')).toContainText('Plugged L01, L02 into C01, each at its own female');
  // Both hang off the zip cord, each on its own female (the outline writes "tap2" as the next in order).
  await expectText(page, { contains: 'C01 SPT-1 zip cord\n  tap1: Net lights\n  Net lights\n' });
});
