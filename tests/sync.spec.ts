import { type BrowserContext, type Page, type Route, expect, test } from '@playwright/test';
import { expectText, newDisplay, setText } from './helpers';

/**
 * Sync between two devices against a stand-in for the server: the same few functions as
 * supabase/migrations/*_hwd_sync.sql, kept in memory here, so the test can also check that
 * only scrambled data reaches it.
 */
const SERVER = { url: 'https://sync.example.test', key: 'sb_publishable_test' };

function fakeServer() {
  const vaults = new Map<string, { rev: number; doc: string }>();
  const photos = new Map<string, Map<string, string>>();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const handle = async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const fn = new URL(req.url()).pathname.split('/').pop();
    const a = req.postDataJSON() as { p_lookup: string; p_base_rev?: number; p_doc?: string; p_photo_id?: string; p_data?: string };
    let body: unknown = null;
    const v = vaults.get(a.p_lookup);
    switch (fn) {
      case 'hwd_pull':
        body = v ? [{ rev: v.rev, doc: v.doc }] : [];
        break;
      case 'hwd_push':
        if (a.p_base_rev === 0) {
          if (v) body = 0;
          else {
            vaults.set(a.p_lookup, { rev: 1, doc: a.p_doc! });
            body = 1;
          }
        } else if (v && v.rev === a.p_base_rev) {
          v.rev++;
          v.doc = a.p_doc!;
          body = v.rev;
        } else body = 0;
        break;
      case 'hwd_photo_ids':
        body = [...(photos.get(a.p_lookup)?.keys() ?? [])];
        break;
      case 'hwd_photo_put': {
        if (!v) return route.fulfill({ status: 400, headers: cors, json: { message: 'no such vault' } });
        const m = photos.get(a.p_lookup) ?? new Map<string, string>();
        m.set(a.p_photo_id!, a.p_data!);
        photos.set(a.p_lookup, m);
        break;
      }
      case 'hwd_photo_get':
        body = photos.get(a.p_lookup)?.get(a.p_photo_id!) ?? null;
        break;
      case 'hwd_forget':
        vaults.delete(a.p_lookup);
        photos.delete(a.p_lookup);
        break;
      default:
        return route.fulfill({ status: 404, headers: cors, json: { message: 'no such function' } });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  };
  return { vaults, photos, handle };
}

/** Point the app at the stand-in server and keep drawn lengths exact. */
async function useFakeServer(target: Page | BrowserContext, server: ReturnType<typeof fakeServer>) {
  await target.addInitScript((s) => {
    localStorage.setItem('wiring-sketchpad.syncServer', JSON.stringify(s));
    localStorage.setItem('wiring-sketchpad.followEdges', '0');
  }, SERVER);
  await target.route(`${SERVER.url}/**`, server.handle);
}

async function openSync(page: Page) {
  await page.getByLabel('More display actions').click();
  await page.getByRole('menuitem', { name: 'Sync with other devices…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sync with your other devices' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** A second device: same kind of browser as this project, its own storage. */
async function otherDevice(page: Page, server: ReturnType<typeof fakeServer>) {
  const ctx = await page.context().browser()!.newContext({ ...test.info().project.use, storageState: 'tests/storage-state.json' });
  await useFakeServer(ctx, server);
  return { ctx, page: await ctx.newPage() };
}

test('sync: turn on here, join on the other device; plans, photos and edits go across, scrambled', async ({ page }) => {
  const server = fakeServer();
  await useFakeServer(page, server);
  await page.goto('./');
  await newDisplay(page);
  await setText(page, '# Synced house\nO01 Outlet\n');
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Try it with a sample house' }).click();
  await expect(page.locator('.photo-stage img')).toBeVisible();

  let sheet = await openSync(page);
  await sheet.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(sheet.getByRole('status')).toContainText('Synced just now');
  const code = (await sheet.getByLabel('Your sync code').textContent())!.trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: /^Synced/ })).toBeVisible();

  // The server only ever sees scrambled data: no titles, no outline text, no JPEG bytes.
  await expect.poll(() => server.photos.size).toBe(1);
  const [vault] = [...server.vaults.values()];
  expect(vault.doc).not.toContain('Synced house');
  expect(vault.doc).not.toContain('Outlet');
  const [photo] = [...[...server.photos.values()][0].values()];
  expect(photo.startsWith('/9j/')).toBe(false);

  // The other device joins with the code and gets the plan and its photo.
  const phone = await otherDevice(page, server);
  const p2 = phone.page;
  await p2.goto('./');
  await expect(p2.getByRole('combobox', { name: 'Display' })).toBeVisible();
  sheet = await openSync(p2);
  await sheet.getByRole('button', { name: 'I have a code' }).click();
  await sheet.getByLabel('Sync code').fill(code.toLowerCase().replace(/-/g, ' '));
  await sheet.getByRole('button', { name: 'Join' }).click();
  await expect(sheet.getByRole('status')).toContainText('Synced just now');
  await sheet.getByRole('button', { name: 'Close' }).click();
  const picker = p2.getByRole('combobox', { name: 'Display' });
  await expect(picker.locator('option', { hasText: 'Synced house' })).toHaveCount(1);
  // Each device started with the example plan; joining keeps one, not two.
  await expect(picker.locator('option', { hasText: '(example)' })).toHaveCount(1);
  await picker.selectOption({ label: 'Synced house' });
  await p2.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(p2.locator('.photo-stage img')).toBeVisible();

  // An edit on the other device shows up here after a sync.
  const revBefore = [...server.vaults.values()][0].rev;
  await setText(p2, '# Synced house\nO01 Outlet\nE01 Extension cord 25 ft\n');
  await expect.poll(() => [...server.vaults.values()][0].rev, { timeout: 15_000 }).toBeGreaterThan(revBefore);
  await syncNow(page);
  await expect(page.locator('.toast')).toContainText('Updated with changes from your other device');
  await expectText(page, { contains: 'E01 Extension cord' });
  await phone.ctx.close();
});

/** Open the sync sheet from the ⇅ button, press Sync now, close it. */
async function syncNow(page: Page) {
  await page.getByRole('button', { name: /^Synced|^Syncing|^Not synced/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Sync with your other devices' });
  await sheet.getByRole('button', { name: 'Sync now' }).click();
  await expect(sheet.getByRole('status')).toContainText('Synced');
  await sheet.getByRole('button', { name: 'Close' }).click();
}

test('sync: a mistyped code is refused; a sync link asks first; deleting the cloud copy turns it off', async ({ page }) => {
  const server = fakeServer();
  await useFakeServer(page, server);
  await page.goto('./');
  let sheet = await openSync(page);
  await sheet.getByRole('button', { name: 'I have a code' }).click();
  await sheet.getByLabel('Sync code').fill('not a code');
  await sheet.getByRole('button', { name: 'Join' }).click();
  await expect(sheet).toContainText('That is not a sync code');
  await sheet.getByLabel('Sync code').fill('0000-0000-0000-0000-0000-0000');
  await sheet.getByRole('button', { name: 'Join' }).click();
  await expect(sheet).toContainText('No synced plans use that code');
  expect(server.vaults.size).toBe(0);
  await sheet.getByRole('button', { name: 'Back' }).click();
  await sheet.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(sheet.getByRole('status')).toContainText('Synced just now');
  const code = (await sheet.getByLabel('Your sync code').textContent())!.trim();
  await sheet.getByRole('button', { name: 'Close' }).click();

  // A link with the code opens the join screen (it never joins by itself) and leaves the address.
  const other = await otherDevice(page, server);
  await other.page.goto(`./#sync=${code}`);
  sheet = other.page.getByRole('dialog', { name: 'Sync with your other devices' });
  await expect(sheet).toContainText('Join the plans from this sync link?');
  await expect(sheet.getByLabel('Sync code')).toHaveValue(code);
  expect(new URL(other.page.url()).hash).toBe('');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await other.ctx.close();

  // Delete the cloud copy: asks first, then the server forgets it and sync is off here.
  sheet = await openSync(page);
  await sheet.getByRole('button', { name: 'Delete the cloud copy' }).click();
  const ask = page.getByRole('dialog', { name: 'Delete the cloud copy' });
  await ask.getByRole('button', { name: 'Delete cloud copy' }).click();
  await expect(page.locator('.toast')).toContainText('Cloud copy deleted');
  expect(server.vaults.size).toBe(0);
  await expect(page.getByRole('button', { name: /^Synced/ })).toHaveCount(0);
  sheet = await openSync(page);
  await expect(sheet.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
});
