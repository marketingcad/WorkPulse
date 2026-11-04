import AxeBuilder from '@axe-core/playwright';
import { request, type Page } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * The profile picture: upload with crop, a curated avatar, or initials; shown in the account menu
 * and the member list; private to whom may see it, and never across organizations.
 */
test.use({ storageState: ADMIN_STATE });

/** A real picture, drawn in the browser (two colors, so a crop shows). */
async function picture(page: Page, w = 900, h = 600): Promise<Buffer> {
  const data = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = '#2f6db5';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#e8b04a';
      x.fillRect(w / 3, h / 4, w / 3, h / 2);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    { w, h },
  );
  return Buffer.from(data, 'base64');
}

const accountButton = (page: Page) => page.getByRole('button', { name: 'Account menu' });
const panel = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Profile picture' }) });

test.afterAll(async () => {
  // Leave the shared admin with initials, as other specs expect.
  const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  await api.delete('/api/v1/me/avatar');
  await api.dispose();
});

test('upload a picture, crop it, see it in the account menu and the member list; replace, choose and remove', { tag: '@smoke' }, async ({ page, data }) => {
  // Start from initials (a retry, or another test in this file, may have left a picture).
  await page.request.delete('/api/v1/me/avatar', { headers: { Origin: WEB_URL } });
  await page.goto(`/o/${data.orgId}/me/profile`);
  await expect(panel(page).getByRole('button', { name: 'Upload photo' })).toBeVisible();
  // No picture yet: initials, and no picture in the account menu.
  await expect(accountButton(page).locator('img')).toHaveCount(0);

  await panel(page).locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await picture(page) });
  const editor = page.getByRole('dialog', { name: 'Crop your picture' });
  await expect(editor).toBeVisible();
  // Reposition and zoom with the keyboard (as well as by dragging).
  const area = editor.getByRole('group', { name: /Picture position/ });
  await area.focus();
  const zoom = editor.getByRole('slider', { name: 'Zoom' });
  await expect(zoom).toHaveValue('1');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(zoom).not.toHaveValue('1');
  await page.keyboard.press('ArrowLeft');
  await editor.getByRole('button', { name: 'Reset' }).click();
  await expect(zoom).toHaveValue('1');
  await page.keyboard.press('+');
  const uploaded = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/avatar') && r.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Save picture' }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(page.getByText('Profile picture saved')).toBeVisible();
  await expect(editor).toBeHidden();

  // The account menu shows it straight away.
  const menuImg = accountButton(page).locator('img');
  await expect(menuImg).toHaveAttribute('src', /^\/api\/v1\/me\/avatar\?v=/);
  const first = await menuImg.getAttribute('src');
  await expect(panel(page).getByRole('button', { name: 'Replace photo' })).toBeVisible();

  // The member list shows it for the admin (from the organization's avatars).
  await page.goto(`/o/${data.orgId}/workers`);
  const row = page.getByRole('row').filter({ hasText: data.admin.email });
  await expect(row.locator('img')).toHaveAttribute('src', new RegExp(`/api/v1/orgs/${data.orgId}/avatars/${data.admin.membershipId}\\?v=`));

  // Replace: a new picture, at a new address.
  await page.goto(`/o/${data.orgId}/me/profile`);
  await panel(page).locator('input[type="file"]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: await picture(page, 600, 900) });
  await page.getByRole('dialog', { name: 'Crop your picture' }).getByRole('button', { name: 'Save picture' }).click();
  await expect(page.getByText('Profile picture saved')).toBeVisible();
  await expect(menuImg).not.toHaveAttribute('src', first!);

  // A curated avatar instead, previewed before it is applied.
  await panel(page).getByRole('button', { name: 'Choose an avatar' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose an avatar' });
  const option = picker.getByRole('button', { name: 'People avatar 3' });
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('img', { name: 'Preview' }).locator('svg')).toHaveCount(1);
  await picker.getByRole('button', { name: 'Use this avatar' }).click();
  await expect(page.getByText('Avatar applied')).toBeVisible();
  await expect(accountButton(page).locator('svg').first()).toBeVisible();
  await expect(menuImg).toHaveCount(0);

  // Remove: back to initials.
  await panel(page).getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove your profile picture?' });
  await expect(confirm).toContainText('Your initials show instead');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Profile picture removed')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Upload photo' })).toBeVisible();
});

test('a file that is not a picture is refused with a reason, before anything is sent', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/me/profile`);
  const sent: string[] = [];
  page.on('request', (r) => r.url().endsWith('/api/v1/me/avatar') && r.method() === 'POST' && sent.push(r.url()));
  const input = panel(page).locator('input[type="file"]');
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('Use a JPEG, PNG or WebP picture.')).toBeVisible();
  // Text pretending to be a PNG: the browser cannot open it.
  await input.setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
  await expect(page.getByText('This picture could not be opened. Try another one.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Crop your picture' })).toHaveCount(0);
  expect(sent).toEqual([]);
});

test('the editor is usable on a phone, and Cancel keeps the current picture', async ({ page, data }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${data.orgId}/me/profile`);
  // Whatever the admin has now (a picture, an avatar or initials) must still be there after Cancel.
  await expect(panel(page).getByRole('button', { name: /Upload photo|Replace photo/ })).toBeVisible();
  const before = await accountButton(page).innerHTML();
  const sent: string[] = [];
  page.on('request', (r) => r.url().endsWith('/api/v1/me/avatar') && r.method() !== 'GET' && sent.push(r.method()));
  await panel(page).locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await picture(page) });
  const editor = page.getByRole('dialog', { name: 'Crop your picture' });
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Drag to reposition with a pointer.
  const area = (await editor.getByRole('group', { name: /Picture position/ }).boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 - 60, area.y + area.height / 2, { steps: 5 });
  await page.mouse.up();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();
  expect(sent).toEqual([]);
  expect(await accountButton(page).innerHTML()).toBe(before);
});

test('a worker cannot see or change anyone else’s picture, and another organization sees none', async ({ data }) => {
  const admin = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  await ok(await admin.put('/api/v1/me/avatar', { data: { preset: 'shape-2' } }), 'admin preset');
  const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  // The worker sees only their own entry, never the admin's.
  const seen = await ok<Array<{ membership_id: string }>>(await worker.get(`/api/v1/orgs/${data.orgId}/avatars`), 'worker avatars');
  expect(seen.every((a) => a.membership_id === data.worker.membershipId)).toBe(true);
  // There is no way to change someone else's: the picture routes only act on the signed-in account.
  for (const method of ['put', 'post', 'delete'] as const) {
    const r = await worker[method](`/api/v1/orgs/${data.orgId}/avatars/${data.admin.membershipId}`, method === 'put' ? { data: { preset: 'person-1' } } : {});
    expect([404, 405], method).toContain(r.status());
  }
  const after = await ok<Array<{ membership_id: string; avatar: { kind: string } }>>(await admin.get(`/api/v1/orgs/${data.orgId}/avatars`), 'admin avatars');
  expect(after.find((a) => a.membership_id === data.admin.membershipId)?.avatar).toEqual({ kind: 'preset', preset: 'shape-2' });

  // Another organization: the worker is not a member of it, so its avatars are out of reach. (A second
  // real organization, and a picture shared between two, are covered in packages/api/test/avatar.test.ts;
  // signing up here would use the run's limited sign-ups.)
  const elsewhere = '0190a000-0000-7000-8000-0000000000ee';
  expect([403, 404]).toContain((await worker.get(`/api/v1/orgs/${elsewhere}/avatars`)).status());
  expect([403, 404]).toContain((await worker.get(`/api/v1/orgs/${elsewhere}/avatars/${data.admin.membershipId}`)).status());
  // Signed out: nothing.
  const anon = await request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { Origin: WEB_URL } });
  expect((await anon.get(`/api/v1/orgs/${data.orgId}/avatars/${data.admin.membershipId}`)).status()).toBe(401);
  expect((await anon.get('/api/v1/me/avatar')).status()).toBe(401);
  await Promise.all([admin.dispose(), worker.dispose(), anon.dispose()]);
});

test('the editor and the avatar collection pass axe', async ({ page, data }) => {
  const serious = async () =>
    (await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
  await page.goto(`/o/${data.orgId}/me/profile`);
  await panel(page).locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await picture(page) });
  await expect(page.getByRole('dialog', { name: 'Crop your picture' })).toBeVisible();
  expect(await serious()).toEqual([]);
  await page.getByRole('dialog', { name: 'Crop your picture' }).getByRole('button', { name: 'Cancel' }).click();
  await panel(page).getByRole('button', { name: 'Choose an avatar' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose an avatar' })).toBeVisible();
  expect(await serious()).toEqual([]);
  // Keyboard: Tab reaches the options, Space selects one.
  await page.getByRole('button', { name: 'Minimal avatar 1' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Minimal avatar 1' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose an avatar' })).toBeHidden();
});
