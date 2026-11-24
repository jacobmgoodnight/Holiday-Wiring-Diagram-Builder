import { readFileSync, statSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { expectText, newDisplay, openDetails } from './helpers';

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

/** The sample house; "Follow edges" is off unless asked for, so drawn lengths are exact. */
async function sampleHouse(page: Page, opts: { follow?: boolean } = {}) {
  if (!opts.follow) await page.addInitScript(() => localStorage.setItem('wiring-sketchpad.followEdges', '0'));
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

  // Right after placing it, the photo asks what it plugs into: tap the outlet, and its cord shows.
  await expect(page.locator('.photo-banner')).toContainText('Tap what L02 plugs into');
  await page.getByRole('button', { name: 'O01 Outlet on photo' }).click();
  await expectText(page, { contains: 'O01 Outlet\n  Inflatable\n' });
  await expect(page.locator('.wire-line')).toHaveCount(1);
  await expect(page.locator('[data-wire="O01>L02"]')).toHaveCount(1);

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

test('plug in on the photo draws the cable; lights take colours and spacing; bushes get lit', async ({ page, isMobile }) => {
  await sampleHouse(page);
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);

  // "+ Plug in" on the outlet: pick C9s, draw them, and the cable runs from the outlet.
  await page.getByRole('region', { name: 'Selected O01' }).getByRole('button', { name: '+ Plug in' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add C9 roofline run', exact: true }).first().click();
  await expect(page.locator('.photo-banner')).toContainText('plugs into O01');
  for (const [x, y] of [[260, 430], [650, 190], [1040, 430]] as const) await tap(page, x, y);
  if (isMobile) await page.getByRole('button', { name: /Style/ }).click();
  await expect(page.getByLabel('Bulb spacing')).toHaveValue('12'); // C9s: a foot apart by default
  await page.getByLabel('Bulb colors').selectOption('multi');
  await page.getByLabel('Bulb spacing').selectOption('8');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-wire="O01>L01"]')).toHaveCount(1);
  // The roofline starts well away from the outlet, so an extension cord goes in between.
  await expect(page.locator('.toast')).toContainText('Added C01');
  await expectText(page, { contains: 'O01 Outlet\n  C01 Green extension cord\n    C9 roofline run\n' });
  const details = await openDetails(page, 'L01');
  await expect(details.getByLabel('Bulb colors')).toHaveValue('multi');
  await expect(details.getByLabel('Bulb spacing')).toHaveValue('8');
  await details.getByLabel('Wire color').selectOption('white');
  await expect(details.getByLabel('Wire color')).toHaveValue('white');
  if (isMobile) await page.keyboard.press('Escape');

  // Light a bush with net lights, then plug it in by tapping the outlet when asked.
  await tap(page, 100, 150); // empty sky: nothing selected
  await page.getByRole('button', { name: '✏️ Draw lights' }).click();
  await page.getByRole('button', { name: 'Light a bush with Net lights (bush)' }).click();
  await expect(page.locator('.photo-banner')).toContainText('Tap around the bush');
  for (const [x, y] of [[320, 725], [380, 690], [440, 725], [380, 760]] as const) await tap(page, x, y);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'L02 Net lights on a bush' })).toBeVisible();
  await expect(page.locator('.photo-banner')).toContainText('Tap what L02 plugs into');
  await page.getByRole('button', { name: 'O01 Outlet on photo' }).click();
  await expect(page.locator('[data-wire="O01>L02"]')).toHaveCount(1);
  await expectText(page, { contains: '  C02 Green extension cord\n    Net lights\n' });
});

test('strands snap end to end, a gap gets a sized extension cord, and females splice in where you tap', async ({ page }) => {
  await sampleHouse(page);
  // Measure the double garage door with the size chip.
  await page.getByRole('button', { name: /Measure/ }).click();
  await expect(page.locator('.photo-banner')).toContainText('front door (3 ft wide)');
  await tap(page, 1040, 760);
  await tap(page, 1340, 760);
  await page.getByRole('button', { name: 'Double garage door 16 ft' }).click();
  await expect(page.getByLabel('Length in feet')).toHaveValue('16');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const draw = async (points: (readonly [number, number])[]) => {
    await tap(page, 100, 150); // empty sky: nothing selected
    await page.getByRole('button', { name: '✏️ Draw lights' }).click();
    await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
    for (const [x, y] of points) await tap(page, x, y);
  };
  await draw([[260, 430], [650, 190]]);
  await page.getByRole('button', { name: 'Done' }).click();
  // Start the next strand on the end of the first: it plugs into L01's end female.
  await draw([[655, 195]]);
  await expect(page.locator('.photo-banner')).toContainText('✓ Plugs into L01 end');
  await tap(page, 1040, 430);
  await page.getByRole('button', { name: 'Done' }).click();
  await expectText(page, { contains: 'C9 roofline run\n  C9 roofline run\n' });

  // The garage strand starts a gap away: tap L02's end female and a 9 ft cord goes in between.
  await draw([[950, 480], [1190, 330], [1430, 480]]);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.photo-banner')).toContainText('Tap what L03 plugs into');
  await page.getByRole('button', { name: 'Open female end on L02' }).click();
  await expect(page.locator('.toast')).toContainText('Added C01, a 9 ft extension cord, to reach L02');
  await expectText(page, { contains: '    C01 Green extension cord 9ft\n      C9 roofline run\n' });

  // Splice an inline female into L01 where you tap, then plug a wreath into it.
  await tap(page, 455, 310);
  await page.getByRole('region', { name: 'Selected L01' }).getByRole('button', { name: '✂️ Add inline female' }).click();
  await tap(page, 455, 310);
  await expect(page.locator('.photo-banner')).toContainText('(1 added)');
  await page.locator('.photo-banner').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Open female tap 1 on L01' }).click();
  await expect(page.locator('.photo-banner')).toContainText('plugs into L01 tap 1');
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Wreath', exact: true }).first().click();
  await tap(page, 470, 330);
  await expect(page.locator('[data-wire="L01>L04"]')).toHaveCount(1);
  await expectText(page, { contains: 'C9 roofline run\n  end: C9 roofline run\n' });
  await expectText(page, { contains: '  Wreath\n' });
});

test('save the photo with its lights as a picture, and get a shopping list with footage', async ({ page }) => {
  await sampleHouse(page);
  await page.getByRole('button', { name: /Measure/ }).click();
  await tap(page, 1040, 760);
  await tap(page, 1340, 760);
  await page.getByRole('button', { name: 'Double garage door 16 ft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: '✏️ Draw lights' }).click();
  await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
  for (const [x, y] of [[260, 430], [650, 190]] as const) await tap(page, x, y);
  await page.getByRole('button', { name: 'Done' }).click();

  // The picture: a JPEG of the photo with the lights, day or night.
  await page.getByRole('button', { name: 'Save picture' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Save picture' });
  await expect(sheet.locator('.picture-preview img')).toBeVisible();
  let dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save picture' }).click();
  let file = await dl;
  expect(file.suggestedFilename()).toMatch(/-sample-house\.jpg$/);
  const path = (await file.path())!;
  expect(readFileSync(path).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
  expect(statSync(path).size).toBeGreaterThan(20_000);
  await sheet.getByRole('group', { name: 'Look' }).getByRole('button', { name: '🌙 Night' }).click();
  await expect(sheet.locator('.picture-preview img:not(.busy)')).toBeVisible();
  dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save picture' }).click();
  file = await dl;
  expect(file.suggestedFilename()).toMatch(/-night\.jpg$/);
  await page.keyboard.press('Escape');

  // The shopping list: feet from the measured photo, bulbs at 12 in.
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Shopping list…' }).click();
  const list = page.getByRole('dialog', { name: 'Shopping list' });
  const lights = list.getByRole('region', { name: 'Lights along the house' });
  await expect(lights).toContainText('C9/C7 light strings · Warm white · 12″ apart');
  await expect(lights).toContainText('~24 ft');
  await expect(lights).toContainText('(25 bulbs)');
  dl = page.waitForEvent('download');
  await list.getByRole('button', { name: 'Download CSV' }).click();
  file = await dl;
  expect(file.suggestedFilename()).toMatch(/-shopping-list\.csv$/);
  expect(readFileSync((await file.path())!, 'utf8')).toContain('section,item,quantity,detail,ids');
  // An ID jumps to that item.
  await list.getByRole('button', { name: 'L01' }).click();
  await expect(page.getByRole('region', { name: 'Selected L01' })).toBeVisible();
});

test('a new photo walks you through measure, outlet, lights and plug in; looks are remembered; ends swap', async ({ page, isMobile }) => {
  await sampleHouse(page);
  const coach = page.getByRole('region', { name: 'Next step' });
  await expect(coach).toContainText('Measure something you know');
  // "+ Add item" on an empty photo starts with an outlet or measuring.
  await page.getByRole('button', { name: '+ Add item' }).click();
  const start = page.getByRole('region', { name: 'Start here' });
  await expect(start.getByRole('button', { name: '🔌 Place O01 Outlet' })).toBeVisible();
  await expect(start.getByRole('button', { name: '📏 Measure the photo' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Two measurements: both are listed, with how well they agree; one can be removed.
  await coach.getByRole('button', { name: '📏 Start measuring' }).click();
  await tap(page, 1040, 760);
  await tap(page, 1340, 760);
  await page.getByRole('button', { name: 'Double garage door 16 ft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Scale set/ }).click();
  await tap(page, 625, 650);
  await tap(page, 695, 650);
  await page.getByRole('button', { name: 'Front door, wide 3 ft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Scale set/ }).click();
  const list = page.getByLabel('Measurements');
  await expect(list).toContainText('Double garage door 16 ft');
  await expect(list).toContainText('They differ by'); // the sample drawing is not to scale
  await list.getByRole('button', { name: 'Remove measurement 2' }).click();
  await expect(list).not.toContainText('Front door');
  await page.locator('.photo-banner').getByRole('button', { name: 'Cancel' }).click();

  // Outlet, then lights, from the guide.
  await expect(coach).toContainText('Put your outlets on the photo');
  await coach.getByRole('button', { name: '🔌 Place O01' }).click();
  await tap(page, 600, 700);
  await tap(page, 100, 150);
  await coach.getByRole('button', { name: '✏️ Draw your lights' }).click();
  await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
  for (const [x, y] of [[260, 430], [650, 190]] as const) await tap(page, x, y);
  if (isMobile) await page.getByRole('button', { name: /Style/ }).click();
  await page.getByLabel('Bulb colors').selectOption('red');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.photo-banner').getByRole('button', { name: 'Later' }).click();
  await tap(page, 100, 150);
  await expect(coach).toContainText('L01 C9 roofline run is not plugged in yet');

  // The next C9 starts red, like the last one.
  await page.getByRole('button', { name: '✏️ Draw lights' }).click();
  await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
  // The Style row stays open on a phone once opened.
  const style = page.getByRole('button', { name: /Style/ });
  await expect(style).toBeVisible();
  if ((await style.getAttribute('aria-expanded')) === 'false') await style.click();
  await expect(page.getByLabel('Bulb colors')).toHaveValue('red');
  await page.locator('.photo-banner').getByRole('button', { name: 'Cancel' }).click();

  // Swap the plug and the end of L01; undo puts it back.
  await tap(page, 455, 310);
  const plug = page.getByRole('img', { name: 'Plug end of L01' });
  await expect(plug).toBeVisible();
  await settled(page); // selecting re-fits the photo on a phone (the bottom bar changes)
  const before = (await plug.boundingBox())!;
  await page.getByRole('region', { name: 'Selected L01' }).getByRole('button', { name: '⇄ Swap plug and end' }).click();
  const photoH = (await page.locator('.photo-stage img').boundingBox())!.height;
  // Now at the peak of the roof, about a quarter of the photo higher.
  await expect.poll(async () => ((await plug.boundingBox())!.y - before.y) / photoH).toBeLessThan(-0.15);
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(async () => Math.abs((await plug.boundingBox())!.y - before.y)).toBeLessThan(3);

  // Plug it in from the guide; once everything is set up the guide goes away.
  await coach.getByRole('button', { name: '🔌 Plug it in' }).click();
  await page.getByRole('button', { name: 'O01 Outlet on photo' }).click();
  await expect(coach).toHaveCount(0);
});

test('follow edges traces the roof line; photos can be renamed and each has its own shopping list', async ({ page }) => {
  await sampleHouse(page, { follow: true });
  await page.getByRole('button', { name: '✏️ Draw lights' }).click();
  await page.getByRole('button', { name: 'Draw C9 roofline run' }).click();
  const follow = page.getByRole('button', { name: /Follow edges/ });
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expect(follow).not.toContainText('reading photo');
  // Tap a little inside the roof at both eaves and the peak: the corners land on the roof edge.
  for (const [x, y] of [[262, 440], [650, 200], [1038, 440]] as const) await tap(page, x, y);
  await expect(page.locator('.photo-banner')).toContainText('3 points');
  await page.getByRole('button', { name: 'Done' }).click();
  const roofY = (x: number) => (x <= 650 ? 430 - ((x - 260) * 240) / 390 : 190 + ((x - 650) * 240) / 390);
  await expect(page.getByLabel('Point 3 of L01')).toBeVisible();
  await settled(page); // the bottom bar changes after Done, and the photo re-fits on a phone
  const img = (await page.locator('.photo-stage img').boundingBox())!;
  for (const n of [1, 2, 3]) {
    const b = (await page.getByLabel(`Point ${n} of L01`).boundingBox())!;
    const x = ((b.x + b.width / 2 - img.x) / img.width) * 1600;
    const y = ((b.y + b.height / 2 - img.y) / img.height) * 1000;
    expect(Math.abs(y - roofY(x))).toBeLessThan(8);
  }

  // Name the photo, add a second one, and list what each needs.
  await page.getByLabel('Photo options').click();
  await page.getByRole('menuitem', { name: 'Rename this photo…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename this photo' });
  await rename.getByRole('button', { name: 'Front of house' }).click();
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: 'Front of house' })).toBeVisible();
  await page.getByLabel('Photo file').setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: readFileSync('public/icon-512.png') });
  await expect(page.getByRole('tab', { name: 'Photo 2' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Inflatable', exact: true }).first().click();
  await tap(page, 800, 500);
  await expect(page.getByRole('button', { name: 'L02 Inflatable on photo' })).toBeVisible();

  await page.getByLabel('Photo options').click();
  await page.getByRole('menuitem', { name: '🧾 Shopping list…' }).click();
  const list = page.getByRole('dialog', { name: 'Shopping list' });
  await expect(list.getByLabel('Which photo')).toHaveValue(/.+/); // this photo
  await expect(list.getByRole('region', { name: 'Props and other lights' })).toContainText('Inflatable');
  await expect(list.getByRole('region', { name: 'Lights along the house' })).toHaveCount(0);
  await list.getByLabel('Which photo').selectOption({ label: 'Everything in the plan' });
  await expect(list.getByRole('region', { name: 'Lights along the house' })).toBeVisible();
});

test('desktop: a cord that no longer reaches is flagged, and one tap makes it long enough', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'mouse drag');
  await sampleHouse(page);
  await page.getByRole('button', { name: /Measure/ }).click();
  await tap(page, 1040, 760);
  await tap(page, 1340, 760);
  await page.getByRole('button', { name: 'Double garage door 16 ft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);
  await page.getByRole('region', { name: 'Selected O01' }).getByRole('button', { name: '+ Plug in' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add C9 roofline run', exact: true }).first().click();
  for (const [x, y] of [[260, 430], [650, 190]] as const) await tap(page, x, y);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.toast')).toContainText('Added C01, a 40 ft extension cord');

  // Drag the roofline run up and to the left: the 40 ft cord no longer reaches.
  await settled(page);
  const [sx, sy] = await at(page, 455, 310);
  const [tx, ty] = await at(page, 205, 160);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
  const tag = page.getByRole('button', { name: /^C01 is too short: 40 ft, needs about \d+ ft$/ });
  await expect(tag).toBeVisible();

  // Tap the red tag to select the cord, then let it pick a length that reaches.
  await tag.click();
  await page.getByRole('region', { name: 'Selected C01' }).getByRole('button', { name: /Needs ~\d+ ft: use a 50 ft cord/ }).click();
  await expect(tag).toHaveCount(0);
  await expectText(page, { contains: 'C01 Green extension cord 50ft' });
});

test('install mode ticks items on the photo; the install sheet lists the plug-in order', async ({ page }) => {
  await sampleHouse(page);
  await page.getByRole('button', { name: /Place from plan/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /O01/ }).click();
  await tap(page, 580, 700);
  await page.getByRole('region', { name: 'Selected O01' }).getByRole('button', { name: '+ Plug in' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add Inflatable', exact: true }).first().click();
  await tap(page, 880, 850);
  await expect(page.getByRole('button', { name: 'L01 Inflatable on photo' })).toBeVisible();

  // Install mode: the next step is pointed out; a tap on an item marks it up.
  await page.getByRole('button', { name: 'Install mode' }).click();
  const bar = page.locator('.photo-banner');
  await expect(bar).toContainText('0 of 2 done on this photo');
  await expect(bar).toContainText('Next: 1. Start at O01 Outlet.');
  await bar.getByRole('button', { name: '✓ O01 is up' }).click();
  await expect(bar).toContainText('1 of 2 done');
  await page.getByRole('button', { name: 'L01 Inflatable on photo' }).click();
  await expect(bar).toContainText('2 of 2 done on this photo. All done.');
  await expect(page.getByRole('img', { name: 'installed' })).toHaveCount(2);
  await bar.getByRole('button', { name: 'Done' }).click();

  // The install sheet: numbered steps (installed ones ticked) and the numbered picture.
  await page.getByLabel('Photo options').click();
  await page.getByRole('menuitem', { name: '🖨 Install sheet…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Install sheet' });
  const steps = sheet.getByRole('region', { name: 'Steps' });
  await expect(steps).toContainText('1. Start at O01 Outlet.');
  await expect(steps).toContainText('2. Plug L01 Inflatable into O01.');
  await expect(steps.locator('li.done')).toHaveCount(2);
  await expect(sheet.locator('.install-figure img')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close install sheet' }).click();

  // Same ticks as the Checklist (and the outline).
  await expectText(page, { contains: 'Inflatable [installed]' });
});
