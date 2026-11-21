import { type Page, expect } from '@playwright/test';

export const outline = (page: Page) => page.getByRole('textbox', { name: 'Outline' });

/** Start a new display and wait until it is open (typing earlier would go to the old one). */
export async function newDisplay(page: Page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(outline(page)).toHaveValue(/^# New display \d{4}\nO01 Outlet\n$/);
  await expect(outline(page)).not.toHaveAttribute('readonly');
}
