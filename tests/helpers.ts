import { type Page, expect } from '@playwright/test';

/** The outline text box (only on screen while "Edit as text" is open). */
export const outline = (page: Page) => page.getByRole('textbox', { name: 'Outline' });

export async function openText(page: Page) {
  if (await outline(page).isVisible()) return;
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Edit as text…' }).click();
  await expect(outline(page)).toBeVisible();
}

export async function closeText(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Edit as text' });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Replace the whole plan by typing it as text (⋯ → Edit as text…). */
export async function setText(page: Page, text: string) {
  await openText(page);
  await outline(page).fill(text);
  await closeText(page);
}

export async function getText(page: Page): Promise<string> {
  await openText(page);
  const v = await outline(page).inputValue();
  await closeText(page);
  return v;
}

/** The plan's text equals (string), matches (RegExp), or contains ({ contains }) something. */
export async function expectText(page: Page, want: string | RegExp | { contains: string } | { notContains: string }) {
  await expect
    .poll(async () => {
      const v = await getText(page);
      if (typeof want === 'string') return v === want ? true : v;
      if (want instanceof RegExp) return want.test(v) ? true : v;
      if ('contains' in want) return v.includes(want.contains) ? true : v;
      return !v.includes(want.notContains) ? true : v;
    }, { timeout: 6000 })
    .toBe(true);
}

/** Start a new display and wait until it is open. */
export async function newDisplay(page: Page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Display' })).toContainText('New display');
  await expectText(page, /^# New display \d{4}\nO01 Outlet\n$/);
}

/** Show an item's details: docked on desktop, a sheet on phones. */
export async function openDetails(page: Page, id: string) {
  const details = page.getByRole('region', { name: `Details for ${id}` });
  if (await details.isVisible()) return details;
  await page.getByRole('region', { name: `Selected ${id}` }).getByRole('button', { name: 'Details' }).click();
  await expect(details).toBeVisible();
  return details;
}
