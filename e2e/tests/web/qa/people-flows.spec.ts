import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../../../support/env';

/** The next Monday after today, as 'YYYY-MM-DD' (a working day, never today). */
function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/**
 * QA: time off (policy → request → decision), teams (create → add a manager) and the password reset
 * request, end to end through the UI, with the result checked against the API.
 */
test.describe('QA · Time off (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin creates a policy for a worker, the worker requests a day off, and the admin approves it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const policy = `QA leave ${uid()}`;
    await page.goto(`/o/${data.orgId}/time-off?tab=admin`);
    await expect(page.getByRole('heading', { level: 1, name: 'Time off' })).toBeVisible();
    await page.getByRole('button', { name: /New policy/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New time off policy' });
    const create = dialog.getByRole('button', { name: 'Create policy' });
    // A name is required, and "Selected members" needs at least one member.
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill(policy);
    await dialog.getByRole('radio', { name: 'Selected members' }).check();
    await expect(create).toBeDisabled();
    await dialog.getByRole('checkbox', { name: new RegExp(data.worker.name) }).check();
    await expect(dialog.getByRole('switch', { name: /Requires approval/ })).toBeChecked();
    await create.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(policy).first()).toBeVisible();

    // The worker (desktop-only on the web) requests the day through the API, as the app does.
    const policies = await ok<Array<{ id: string; name: string }>>(await adminApi.api.get(adminApi.orgApi('/time-off/policies')), 'policies');
    const policyId = policies.find((p) => p.name === policy)!.id;
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const day = nextMonday();
    const reason = `QA trip ${uid()}`;
    const backwards = await worker.post(`/api/v1/orgs/${data.orgId}/time-off/requests`, { data: { policy_id: policyId, start_date: day, end_date: '2020-01-01', half_day: false, reason } });
    expect(backwards.status()).toBe(400);
    const sent = await ok<{ id: string; status: string }>(await worker.post(`/api/v1/orgs/${data.orgId}/time-off/requests`, { data: { policy_id: policyId, start_date: day, end_date: day, half_day: false, reason } }), 'request');
    expect(sent.status).toBe('PENDING');

    // The admin decides it on Requests.
    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    const row = page.getByRole('row').filter({ hasText: reason });
    await expect(row).toContainText(data.worker.name);
    await row.getByRole('button', { name: 'Approve' }).click();
    const mine = async () => (await ok<Array<{ id: string; status: string }>>(await worker.get(`/api/v1/orgs/${data.orgId}/time-off/requests`), 'requests')).find((r) => r.id === sent.id)?.status;
    await expect.poll(mine).toBe('APPROVED');
    await worker.dispose();
  });

  test('a request needs an end on or after its start', async ({ page, data, adminApi }) => {
    await ok(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name: `QA own leave ${uid()}`, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.admin.membershipId] } }), 'policy');
    await page.goto(`/o/${data.orgId}/time-off?tab=mine`);
    await page.getByRole('button', { name: /Request time off/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Request time off' });
    await dialog.getByLabel('Start date').fill('2030-05-10');
    await dialog.getByLabel('End date').fill('2030-05-09');
    await expect(dialog.getByText('End date must be on or after the start date')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });
});

test.describe('QA · Teams (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin creates a team and makes a member its manager', async ({ page, data, adminApi }) => {
    const name = `QA Team ${uid()}`;
    await page.goto(`/o/${data.orgId}/teams`);
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    await page.getByRole('button', { name: 'New team' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New team' });
    await expect(dialog.getByRole('button', { name: 'Create team' })).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(dialog).toBeHidden();

    // The new team opens straight away, to add its members.
    const drawer = page.getByRole('dialog', { name });
    await expect(drawer.getByText('No members yet')).toBeVisible();
    await drawer.getByLabel('Add member').selectOption({ label: data.worker.name });
    await drawer.getByLabel('Role', { exact: true }).selectOption('MANAGER');
    await drawer.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(drawer.getByLabel(`Team role for ${data.worker.name}`)).toHaveValue('MANAGER');

    const teams = await ok<Array<{ name: string; members: Array<{ membership_id: string; role: string }> }>>(await adminApi.api.get(adminApi.orgApi('/teams')), 'teams');
    expect(teams.find((t) => t.name === name)?.members).toEqual([expect.objectContaining({ membership_id: data.worker.membershipId, role: 'MANAGER' })]);
  });
});

test.describe('QA · Teams (restricted role)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('a role without team access cannot create teams', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/teams`);
    await expect(page.getByRole('button', { name: 'New team' })).toHaveCount(0);
  });
});

test.describe('QA · Password reset request (signed out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the reset request gives the same answer whether or not the account exists', async ({ page, data }) => {
    const answers: string[] = [];
    for (const email of [data.admin.email, `nobody-${uid()}@example.com`]) {
      await page.goto('/forgot-password');
      await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
      const res = page.waitForResponse((r) => r.url().endsWith('/auth/password/forgot'));
      await page.getByLabel('Work email').fill(email);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      answers.push(String((await res).status()));
      await expect(page.getByText(`If an account exists for ${email}, a reset link is on its way.`)).toBeVisible();
    }
    expect(answers[0]).toBe(answers[1]);
  });

  test('a reset link with a bad token does not change the password', async ({ page }) => {
    await page.goto('/reset-password?token=not-a-real-token');
    await page.getByLabel('New password').fill('Another-Strong-Pass-123');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Password updated.')).toHaveCount(0);
  });
});
