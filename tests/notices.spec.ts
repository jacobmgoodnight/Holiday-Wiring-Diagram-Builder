import { expect, test } from '@playwright/test';
import { newDisplay, setText } from './helpers';

// These start from a fresh browser: no reminder snoozed, no tip seen.
test.use({ storageState: { cookies: [], origins: [] } });

test('after a lot of work, a reminder to back up; backing up clears it', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wiring-sketchpad.safety', JSON.stringify({ editsSinceBackup: 45, iosTipDone: true }));
  });
  await page.goto('./');
  const notice = page.getByRole('status').filter({ hasText: 'Back up so nothing is lost' });
  await expect(notice).toBeVisible();
  const dl = page.waitForEvent('download');
  await notice.getByRole('button', { name: 'Back up now' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^wiring-sketchpad-backup-.*\.json$/);
  await expect(notice).toHaveCount(0);
});

test('iPhone in Safari: a one-time tip to add the app to the Home Screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'iPhone only');
  await page.goto('./');
  await newDisplay(page);
  const tip = page.getByRole('status').filter({ hasText: 'Add to Home Screen' });
  for (let i = 1; i <= 5; i++) await setText(page, `# Tip ${i}\nO01 Outlet\n`);
  await expect(tip).toBeVisible();
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Display' })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test('a newer published version offers a reload', async ({ page }) => {
  await page.route('**/version.json*', (route) => route.fulfill({ json: { build: 'a-newer-build' } }));
  await page.goto('./');
  const notice = page.getByRole('status').filter({ hasText: 'A new version of the app is ready' });
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await notice.getByRole('button', { name: 'Later' }).click();
  await expect(notice).toHaveCount(0);
});
