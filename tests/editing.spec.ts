import { type Locator, type Page, expect, test } from '@playwright/test';
import { newDisplay, outline } from './helpers';

const node = (page: Page, label: string) => page.locator(`.react-flow__node[aria-label^="${label}"]`);
const plus = (page: Page, id: string) => page.getByRole('button', { name: `Plug something into ${id}`, exact: true });
const pick = (page: Page, name: string) => page.getByRole('dialog').getByRole('button', { name: `Add ${name}`, exact: true }).first();

/**
 * Pan the diagram, as a person would, until `target` is fully visible in it. Pans start only on
 * empty canvas, so a pan is never mistaken for a tap. Returns the number of pans used.
 */
async function bringIntoView(page: Page, target: Locator): Promise<number> {
  const pane = page.locator('.diagram');
  let pans = 0;
  for (let i = 0; i < 4; i++) {
    const t = await target.boundingBox();
    const p = await pane.boundingBox();
    if (!t || !p) throw new Error('missing box');
    const top = p.y + 56; // below the toolbar
    const dx = t.x < p.x + 4 ? p.x + 24 - t.x : t.x + t.width + 20 > p.x + p.width ? p.x + p.width - 24 - (t.x + t.width) : 0;
    const dy = t.y < top ? top + 12 - t.y : t.y + t.height > p.y + p.height - 4 ? p.y + p.height - 24 - (t.y + t.height) : 0;
    if (!dx && !dy) return pans;
    const start = await page.evaluate(({ x, y, w, h }) => {
      for (let gy = 0.2; gy < 0.95; gy += 0.15)
        for (let gx = 0.1; gx < 0.95; gx += 0.1) {
          const px = x + w * gx;
          const py = y + h * gy;
          const el = document.elementFromPoint(px, py);
          if (el?.classList.contains('react-flow__pane') || el?.classList.contains('cluster')) return { x: px, y: py };
        }
      return null;
    }, { x: p.x, y: p.y, w: p.width, h: p.height });
    if (!start) throw new Error('no empty canvas to pan from');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
    await page.mouse.up();
    pans++;
  }
  return pans;
}

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone acceptance test');

  test('acceptance: rebuild the O02 branch with taps only in under a minute', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await expect(outline(page)).toHaveValue(/O01 Outlet\n$/);

    let taps = 0;
    let pans = 0;
    const tap = async (l: Locator) => {
      // Picker tiles are in the dialog; only diagram targets may need a pan.
      if (!(await page.getByRole('dialog').count())) pans += await bringIntoView(page, l);
      await l.click();
      taps++;
    };
    const started = Date.now();

    await tap(plus(page, 'O01'));
    await tap(pick(page, '2-port smart plug'));
    await tap(node(page, 'Unused socket 1 on K01'));
    await tap(pick(page, 'Extension cord'));
    await tap(node(page, 'Unused socket on C01'));
    await tap(pick(page, '4-way splitter'));
    for (const [port, preset] of [['1', 'Animated prop'], ['2', 'Spotlight'], ['3', 'Spotlight'], ['4', 'Tote']]) {
      await tap(node(page, `Unused socket ${port} on S01`));
      await tap(pick(page, preset));
    }
    for (const preset of ['Projector', 'Fan', '3-way splitter']) {
      await tap(plus(page, 'T01'));
      await tap(pick(page, preset));
    }
    const seconds = (Date.now() - started) / 1000;

    const v = await outline(page).inputValue();
    expect(v.split('\n').slice(1).join('\n')).toBe(
      'O01 Outlet\n  K01 2-port smart plug\n    C01 Extension cord\n      S01 4-way splitter\n        Animated prop\n        Spotlight\n        Spotlight\n        T01 Tote\n          Projector\n          Fan\n          S02 3-way splitter\n',
    );
    console.log(`O02 rebuild: ${taps} taps, ${pans} pans, ${seconds.toFixed(1)}s automated`);
    expect(taps).toBeLessThanOrEqual(20);
    expect(pans).toBeLessThanOrEqual(6);
    expect(seconds).toBeLessThan(60);
  });

  test('Move… re-plugs with two taps and can be undone', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Move\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n  C01 cord\n');
    await node(page, 'S01').click();
    // Move C01 into S01's free socket 2.
    await node(page, 'C01').click();
    await page.getByRole('button', { name: 'Move…' }).click();
    await expect(page.locator('.move-banner')).toBeVisible();
    await node(page, 'Unused socket 2 on S01').click();
    await expect(outline(page)).toHaveValue('# Move\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n    C01 cord\n');
    await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
    await expect(outline(page)).toHaveValue('# Move\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n  C01 cord\n');
  });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop-only interactions');

  test('drag an item onto a free socket to re-plug it; undo restores', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Drag\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n  C01 cord\n');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const from = node(page, 'C01');
    const to = node(page, 'Unused socket 2 on S01');
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 12 });
    await expect(page.locator('.dn.drop')).toHaveCount(1);
    await page.mouse.up();
    await expect(outline(page)).toHaveValue('# Drag\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n    C01 cord\n');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(outline(page)).toHaveValue('# Drag\nO01 Porch\n  S01 3-way splitter\n    Spotlight\n  C01 cord\n');
  });

  test('a short drag that lands nowhere changes nothing', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Drag\nO01 Porch\n  C01 cord\n');
    const a = (await node(page, 'C01').boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(outline(page)).toHaveValue('# Drag\nO01 Porch\n  C01 cord\n');
  });

  test('drop a preset from the palette onto a socket', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Palette\nO01 Porch\n  S01 2-way splitter\n');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.locator('.pal', { hasText: 'Inflatable' }).dragTo(node(page, 'Unused socket 2 on S01'));
    await expect(outline(page)).toHaveValue('# Palette\nO01 Porch\n  S01 2-way splitter\n    2: Inflatable\n');
  });

  test('panel edits write one outline line; undo spans typing and diagram edits', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Panel\nO01 Porch\n  Wreath\n');
    await page.waitForTimeout(1100); // end the typing burst so the next edit is its own undo step
    await node(page, 'L01').click();
    const qty = page.getByLabel('Qty', { exact: true });
    await qty.fill('2');
    await qty.press('Enter');
    await expect(outline(page)).toHaveValue('# Panel\nO01 Porch\n  Wreath x2\n');
    await page.getByRole('button', { name: 'Installed' }).click();
    await expect(outline(page)).toHaveValue('# Panel\nO01 Porch\n  Wreath x2 [installed]\n');
    await page.locator('body').press('ControlOrMeta+z');
    await expect(outline(page)).toHaveValue('# Panel\nO01 Porch\n  Wreath x2\n');
    await page.locator('body').press('ControlOrMeta+z');
    await expect(outline(page)).toHaveValue('# Panel\nO01 Porch\n  Wreath\n');
    await page.locator('body').press('ControlOrMeta+Shift+z');
    await expect(outline(page)).toHaveValue('# Panel\nO01 Porch\n  Wreath x2\n');
  });

  test('picker search, Enter to add, favourites and recent', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await plus(page, 'O01').click();
    await page.getByRole('searchbox', { name: 'Search presets' }).fill('candy');
    await page.keyboard.press('Enter');
    await expect(outline(page)).toHaveValue(/O01 Outlet\n  Pathway lights\n$/);
    const dialog = page.getByRole('dialog');
    // The view re-centres on the new item one frame after adding; under heavy test load a
    // click can land mid-move, so retry until the picker is open.
    await expect(async () => {
      await plus(page, 'O01').click();
      await expect(dialog.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 8000 });
    await dialog.getByRole('button', { name: 'Star Fan as a favourite' }).first().click();
    await expect(dialog.getByRole('heading', { name: 'Favourites' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('a loop is refused with a message', async ({ page }) => {
    await page.goto('./');
    await newDisplay(page);
    await outline(page).fill('# Loop\nO01 Porch\n  S01 2-way splitter\n    C01 cord\n');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await node(page, 'S01').click();
    await page.getByRole('button', { name: 'Move…' }).click();
    await node(page, 'C01').click();
    await expect(outline(page)).toHaveValue('# Loop\nO01 Porch\n  S01 2-way splitter\n    C01 cord\n');
    // S01, C01 and S01's free socket cannot be targets.
    await expect(page.locator('.dn.blocked')).toHaveCount(3);
    await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toHaveCount(0);
  });
});
