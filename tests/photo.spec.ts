import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { expectText, newDisplay } from './helpers';

/** Screen point for a spot on the sample house (1600 × 1000 drawing). */
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const img = (await page.locator('.photo-stage img').boundingBox())!;
  return [img.x + (img.width * x) / 1600, img.y + (img.height * y) / 1000];
}
/** Wait until the photo stops moving (it re-fits when panels open or close). */
async function settled(page: Page) {
  let last = '';
  for (let i = 0; i < 20; i++) {
    const box = JSON.stringify(await page.locator('.photo-stage img').boundingBox());
    if (box === last) return;
    last = box;
    await page.waitForTimeout(60);
  }
}
const tap = async (page: Page, x: number, y: number) => {
  await settled(page);
  const [sx, sy] = await at(page, x, y);
  await page.mouse.click(sx, sy);
};

async function sampleHouse(page: Page) {
  await page.goto('./');
  await newDisplay(page);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Try it with a sample house' }).click();
  await expect(page.locator('.photo-stage img')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sample house' })).toBeVisible();
  await page.waitForTimeout(300);
}

test('draw lights, place items, measure, and plug in from the photo', async ({ page }) => {
  await sampleHouse(page);

  // Draw a C9 run along the main roof: three taps and Done.
  await page.getByRole('button', { name: '✏️ Draw lights' }).click();
  await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
  for (const [x, y] of [[260, 430], [650, 190], [1040, 430]] as const) await tap(page, x, y);
  await expect(page.locator('.photo-banner')).toContainText('3 points');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'L01 C9 roofline run light run' })).toBeVisible();
  await expectText(page, /\n\nC9 roofline run\n$/);

  // Place the existing outlet from the plan, and add an inflatable.
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);
  await expect(page.getByRole('button', { name: 'O01 Outlet on photo' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Inflatable', exact: true }).first().click();
  await tap(page, 880, 850);
  const inflatable = page.getByRole('button', { name: 'L02 Inflatable on photo' });
  await expect(inflatable).toBeVisible();

  // Plug the inflatable into the outlet by tapping it on the photo.
  await page.getByRole('region', { name: 'Selected L02' }).getByRole('button', { name: 'Move…' }).click();
  await expect(page.locator('.photo-banner')).toContainText('Tap what L02 plugs into');
  await page.getByRole('button', { name: 'O01 Outlet on photo' }).click();
  await expectText(page, { contains: 'O01 Outlet\n  Inflatable\n' });
  await expect(page.locator('.wire-line')).toHaveCount(1);

  // Measure the 16 ft garage door; the run now shows its length and can use it.
  await page.getByRole('button', { name: /Measure/ }).click();
  await tap(page, 1040, 760);
  await tap(page, 1340, 760);
  await page.getByLabel('Length in feet').fill('16');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /Scale set/ })).toBeVisible();
  await tap(page, 455, 310); // on the roof edge, along the run
  const panel = page.getByRole('region', { name: 'Selected L01' });
  const use = panel.getByRole('button', { name: /^Use ~\d+ ft as length$/ });
  await expect(use).toBeVisible();
  const ft = Number(/~(\d+)/.exec((await use.textContent())!)![1]);
  expect(ft).toBeGreaterThan(40);
  expect(ft).toBeLessThan(60);
  await use.click();
  await expectText(page, { contains: `C9 roofline run ~${ft}ft` });

  // Night look, and undo takes the length back off.
  await page.getByRole('button', { name: /Night/ }).click();
  await expect(page.locator('.photo.night')).toHaveCount(1);
  await page.locator('body').press('ControlOrMeta+z');
  await expectText(page, { notContains: `~${ft}ft` });
});

test('photo and placements survive a reload; a backup carries the photo', async ({ page }) => {
  await sampleHouse(page);
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(page.locator('.photo-stage img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'O01 Outlet on photo' })).toBeVisible();

  const dl = page.waitForEvent('download');
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Back up all displays (JSON)' }).click();
  const backup = JSON.parse(readFileSync((await (await dl).path())!, 'utf8'));
  expect(backup.version).toBe(2);
  expect(backup.photos.length).toBeGreaterThan(0);
  expect(backup.photos[0].type).toBe('image/jpeg');
  const withPhoto = backup.displays.find((d: { display: { views?: unknown[] } }) => d.display.views?.length);
  expect(withPhoto.display.nodes.O01.placements).toBeTruthy();
});

test('desktop: drag a marker to move it; removing the photo can be undone', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'mouse drag');
  await sampleHouse(page);
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);
  const marker = page.getByRole('button', { name: 'O01 Outlet on photo' });
  const before = (await marker.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + 12 + 40, { steps: 8 });
  await page.mouse.up();
  const after = (await marker.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(80);

  await page.getByLabel('Photo options').click();
  await page.getByRole('menuitem', { name: 'Remove this photo' }).click();
  await expect(page.getByRole('button', { name: 'Try it with a sample house' })).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(marker).toBeVisible();
});
