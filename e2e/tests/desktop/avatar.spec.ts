import { request } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * The worker's own avatar in the desktop app: their curated avatar or picture from the server (only
 * ever their own, through the device's own-data API), initials when there is none or when offline.
 */
test.describe.configure({ mode: 'serial' });

async function asWorker<T>(fn: (api: import('@playwright/test').APIRequestContext) => Promise<T>): Promise<T> {
  const api = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  try {
    return await fn(api);
  } finally {
    await api.dispose();
  }
}

test.afterAll(async () => {
  await asWorker((api) => api.delete('/api/v1/me/avatar'));
});

const profile = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Profile' });

test('with no picture, the worker sees their initials', async ({ page, openDesktop, workerDevice, data }) => {
  await asWorker((api) => api.delete('/api/v1/me/avatar'));
  await openDesktop(workerDevice);
  const initials = data.worker.name
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('');
  await expect(profile(page)).toContainText(initials);
  await expect(profile(page).locator('img, svg rect')).toHaveCount(0);
});

test('their curated avatar, then their own picture, show in the app', async ({ page, openDesktop, workerDevice }) => {
  await asWorker(async (api) => ok(await api.put('/api/v1/me/avatar', { data: { preset: 'person-2' } }), 'preset'));
  await openDesktop(workerDevice);
  await expect(profile(page).locator('svg')).toHaveCount(1);

  // A picture: a 1×1 PNG uploaded on the website, shown from the device's own-data API.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');
  await asWorker(async (api) => ok(await api.post('/api/v1/me/avatar', { multipart: { file: { name: 'me.png', mimeType: 'image/png', buffer: png } } }), 'upload'));
  await page.reload();
  await expect(profile(page).locator('img')).toHaveAttribute('src', /^data:image\/webp;base64,/);
});

test('offline, the profile still works and shows initials', async ({ page, openDesktop, workerDevice, data }) => {
  await openDesktop(workerDevice, { offline: ['avatar'] });
  await expect(profile(page)).toContainText(data.worker.name.trim().split(/\s+/)[0]![0]!.toUpperCase());
  await expect(profile(page).locator('img')).toHaveCount(0);
  await profile(page).click();
  await expect(page.getByRole('menu')).toContainText(data.worker.email);
});
