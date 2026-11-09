import { request, type APIRequestContext } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Schedules: planned working hours per member, saved as versions from an effective date.
 *
 * The schedule edited here is the shared team manager's. Managers are not tracked, so attendance
 * leaves them out, and no other spec depends on their schedule; each test removes what it saved.
 * (A member of its own would cost an invitation acceptance, which the run is short of.)
 */
test.describe.configure({ mode: 'serial' });

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function clearSchedules(api: APIRequestContext, orgApi: (p: string) => string, membershipId: string) {
  const list = await ok<Array<{ id: string; membership_id: string }>>(await api.get(orgApi(`/schedules?membership_ids=${membershipId}`)), 'schedules');
  for (const s of list.filter((x) => x.membership_id === membershipId)) await api.delete(orgApi(`/schedules/${s.id}`));
}

test.describe('Schedules (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });
  test.beforeEach(async ({ data, adminApi }) => clearSchedules(adminApi.api, adminApi.orgApi, data.manager.membershipId));
  test.afterAll(async ({ data }) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    await clearSchedules(api, (p) => `/api/v1/orgs/${data.orgId}${p}`, data.manager.membershipId);
    await api.dispose();
  });

  test('sets a member’s working hours, sees them in the week, then deletes the version', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const name = `QA hours ${uid()}`;
    await page.goto(`/o/${data.orgId}/schedules`);
    await expect(page.getByRole('heading', { level: 1, name: 'Schedules' })).toBeVisible();
    await page.getByLabel('Search members').fill(data.manager.name);
    const row = page.getByRole('row').filter({ hasText: data.manager.name });
    await expect(row).toContainText('No schedule');

    await row.getByRole('button', { name: `Edit schedule for ${data.manager.name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Schedule · ${data.manager.name}` });
    // Managers are not tracked, and the editor says what that means for attendance.
    await expect(dialog.getByRole('note')).toContainText(`Time tracking is off for ${data.manager.name}, so attendance does not include them.`);
    await expect(dialog.getByText('No schedule yet')).toBeVisible();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('checkbox', { name: 'Friday' }).uncheck();
    await expect(dialog.getByLabel('Friday start')).toBeDisabled();
    await dialog.getByLabel('Monday start').fill('08:00');
    await dialog.getByLabel('Monday end').fill('16:00');
    await dialog.getByRole('button', { name: 'Save new version' }).click();
    await expect(page.getByText(`Schedule saved for ${data.manager.name}`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row).not.toContainText('No schedule');

    // Monday to Thursday, once each in any seven days from the effective date (today).
    const saved = await ok<Array<{ id: string; name: string; effective_from: string; days: Array<{ dow: number; start: string; end: string }> }>>(await adminApi.api.get(adminApi.orgApi(`/schedules?membership_ids=${data.manager.membershipId}`)), 'schedules');
    const version = saved.find((s) => s.name === name)!;
    expect(version.days.map((d) => d.dow).sort()).toEqual([1, 2, 3, 4]);
    expect(version.days.find((d) => d.dow === 1)).toMatchObject({ start: '08:00', end: '16:00' });
    const from = version.effective_from;
    const shifts = await ok<Array<{ membership_id: string }>>(await adminApi.api.get(adminApi.orgApi(`/shifts?from=${from}&to=${addDays(from, 6)}&membership_ids=${data.manager.membershipId}`)), 'shifts');
    expect(shifts.filter((s) => s.membership_id === data.manager.membershipId)).toHaveLength(4);

    // The version is listed as current; deleting it asks first.
    await row.getByRole('button', { name: `Edit schedule for ${data.manager.name}` }).click();
    await expect(dialog.getByText(name)).toBeVisible();
    await expect(dialog.getByText('Current')).toBeVisible();
    await dialog.getByRole('button', { name: /^Delete version from / }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete schedule version?' }).or(page.getByRole('dialog', { name: 'Delete schedule version?' }));
    await expect(confirm).toContainText('Attendance for those days will be recalculated without it.');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Schedule version deleted')).toBeVisible();
    await expect(dialog.getByText('No schedule yet')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('No schedule');
  });

  test('a shift must end after it starts, and Cancel saves nothing', async ({ page, data, adminApi }) => {
    await page.goto(`/o/${data.orgId}/schedules`);
    await page.getByLabel('Search members').fill(data.manager.name);
    await page.getByRole('button', { name: `Edit schedule for ${data.manager.name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Schedule · ${data.manager.name}` });
    const save = dialog.getByRole('button', { name: 'Save new version' });
    await dialog.getByLabel('Tuesday start').fill('18:00');
    await dialog.getByLabel('Tuesday end').fill('09:00');
    await expect(dialog.getByRole('alert')).toContainText('Tuesday: the shift must end after it starts. Split overnight shifts across two days.');
    await expect(dialog.getByLabel('Tuesday end')).toHaveAttribute('aria-invalid', 'true');
    await expect(save).toBeDisabled();
    // Turning the day off clears the problem.
    await dialog.getByRole('checkbox', { name: 'Tuesday' }).uncheck();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const list = await ok<unknown[]>(await adminApi.api.get(adminApi.orgApi(`/schedules?membership_ids=${data.manager.membershipId}`)), 'schedules');
    expect(list).toHaveLength(0);
  });

  test('searching for nobody says so', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/schedules`);
    await page.getByLabel('Search members').fill(`nobody-${uid()}`);
    await expect(page.getByText('No matching members')).toBeVisible();
  });

  test('shows an error with a retry when schedules cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/schedules**`, (route) =>
      fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) }) : route.continue(),
    );
    await page.goto(`/o/${data.orgId}/schedules`);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(page.getByLabel('Search members')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toHaveCount(0);
  });
});

test.describe('Schedules for people with less access', () => {
  test('a team manager sees and edits only their team, and the API refuses others', async ({ browser, data, adminApi }) => {
    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/schedules`);
    await expect(page.getByRole('heading', { level: 1, name: 'Schedules' })).toBeVisible();
    // Their team's worker is there; the admin, who is not on their team, is not.
    await expect(page.getByRole('row').filter({ hasText: data.worker.name })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit schedule for ${data.worker.name}` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: data.admin.name })).toHaveCount(0);

    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.post(`/api/v1/orgs/${data.orgId}/schedules`, { data: { membership_id: data.admin.membershipId, name: 'Not yours', timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: today } });
    expect(res.status()).toBe(403);
    const admins = await ok<Array<{ name: string }>>(await adminApi.api.get(adminApi.orgApi(`/schedules?membership_ids=${data.admin.membershipId}`)), 'schedules');
    expect(admins.some((s) => s.name === 'Not yours')).toBe(false);
    await Promise.all([api.dispose(), ctx.close()]);
  });

  test('a custom role without schedule access is told so, and the API refuses them', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/schedules`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(page.getByLabel('Search members')).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await api.get(`/api/v1/orgs/${data.orgId}/schedules`)).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });
});
