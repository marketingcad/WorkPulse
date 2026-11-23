import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * The notification bell (QA pass, feature 27): empty, a new notification with its unread count, opening
 * it from the list, and "Mark all read". Runs in an organization of its own, so the shared accounts'
 * notifications are left as they are.
 */
test.use({ storageState: ADMIN_STATE });

test('the bell shows a new notification, opens it and marks everything read', { tag: '@smoke' }, async ({ page, adminApi }) => {
  const org = await ok<{ organization_id: string }>(await adminApi.api.post('/api/v1/me/organizations', { data: { name: `Bell Co ${uid()}`, timezone: 'UTC', currency: 'USD' } }), 'organization');
  const api = (p: string) => `/api/v1/orgs/${org.organization_id}${p}`;
  await page.goto(`/o/${org.organization_id}`);

  // Nothing yet.
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  await bell.click();
  await expect(page.getByText('You are all caught up.')).toBeVisible();
  await page.keyboard.press('Escape');

  // A background export tells its owner when the file is ready.
  await ok(await adminApi.api.post(api('/reports/time-activity/export-runs'), { data: { from: '2026-11-01', to: '2026-11-07', format: 'CSV' } }), 'export');
  await expect.poll(async () => ((await (await adminApi.api.get(api('/notifications'))).json()) as { unread: number }).unread, { timeout: 30_000 }).toBe(1);

  await page.reload();
  const unread = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(unread).toBeVisible();
  await unread.click();
  await expect(page.getByRole('link', { name: /export is ready/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
  expect(((await (await adminApi.api.get(api('/notifications'))).json()) as { unread: number }).unread).toBe(0);
});
