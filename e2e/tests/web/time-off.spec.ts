import { request, type APIRequestContext } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Time off decisions. Creating a policy, requesting, approving, cancelling and archiving are in
 * qa/people-flows.spec.ts; this covers rejecting with a comment, who may decide whose request, and
 * the queue's empty and error states. Every request is on a policy the test creates, far in the
 * future, so nothing else's balances or calendar change.
 */

const asWorker = () => request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
/** A distinct far-future weekday per call, so requests never overlap each other or other specs'. */
const futureDay = () => {
  const d = new Date(Date.UTC(2033 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27)));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function policyFor(adminApi: { api: APIRequestContext; orgApi: (p: string) => string }, memberIds: string[]) {
  const name = `QA decide ${uid()}`;
  const p = await ok<{ id: string }>(
    await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: memberIds } }),
    'policy',
  );
  return { id: p.id, name };
}

async function requestAs(api: APIRequestContext, orgId: string, policyId: string, reason: string) {
  const day = futureDay();
  return ok<{ id: string; status: string }>(await api.post(`/api/v1/orgs/${orgId}/time-off/requests`, { data: { policy_id: policyId, start_date: day, end_date: day, half_day: false, reason } }), 'request');
}

test.describe('Deciding time off (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('rejects a request with a comment the member can read', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const policy = await policyFor(adminApi, [data.worker.membershipId]);
    const worker = await asWorker();
    const reason = `QA reject ${uid()}`;
    const sent = await requestAs(worker, data.orgId, policy.id, reason);

    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    const row = page.getByRole('row').filter({ hasText: reason });
    await expect(row).toContainText(data.worker.name);
    await row.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject request' });
    await expect(dialog).toContainText(`${data.worker.name} · ${policy.name}`);
    // Cancel keeps it waiting.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Reject' }).click();
    await dialog.getByLabel('Comment').fill('That week is our launch. Can you move it a week later?');
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText('Request rejected')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: reason })).toHaveCount(0); // gone from the waiting queue

    // The Rejected filter shows it with the comment, and the member reads both.
    await page.getByRole('radiogroup', { name: 'Status' }).getByRole('radio', { name: 'Rejected' }).click();
    await expect(page.getByRole('row').filter({ hasText: reason })).toContainText('Can you move it a week later?');
    const theirs = (await ok<Array<{ id: string; status: string; decision_comment: string | null }>>(await worker.get(`/api/v1/orgs/${data.orgId}/time-off/requests`), 'requests')).find((r) => r.id === sent.id)!;
    expect(theirs).toMatchObject({ status: 'REJECTED', decision_comment: 'That week is our launch. Can you move it a week later?' });
    // A decided request cannot be decided again.
    expect((await adminApi.api.post(adminApi.orgApi(`/time-off/requests/${sent.id}/approve`), { data: {} })).status()).toBeGreaterThanOrEqual(400);
    await worker.dispose();
  });

  test('a search that matches nothing says so', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    await page.getByLabel('Search time off requests').fill(`nothing-${uid()}`);
    await expect(page.getByText('No requests match your search')).toBeVisible();
  });

  test('shows an error with a retry when requests cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/time-off/requests**`, (route) =>
      fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) }) : route.continue(),
    );
    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' }).first()).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).first().click();
    await expect(page.getByLabel('Search time off requests')).toBeVisible();
  });
});

test.describe('Who may decide whose time off', () => {
  test('a team manager decides their team’s requests, but not someone outside the team', async ({ browser, data, adminApi }) => {
    const policy = await policyFor(adminApi, [data.worker.membershipId, data.admin.membershipId]);
    const worker = await asWorker();
    const teamReason = `QA team ${uid()}`;
    const outsideReason = `QA outside ${uid()}`;
    const teamRequest = await requestAs(worker, data.orgId, policy.id, teamReason);
    const outside = await requestAs(adminApi.api, data.orgId, policy.id, outsideReason); // the admin is not on the manager's team

    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    const row = page.getByRole('row').filter({ hasText: teamReason });
    await expect(row).toContainText(data.worker.name);
    await expect(page.getByRole('row').filter({ hasText: outsideReason })).toHaveCount(0);
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect.poll(async () => (await ok<Array<{ id: string; status: string }>>(await worker.get(`/api/v1/orgs/${data.orgId}/time-off/requests`), 'requests')).find((r) => r.id === teamRequest.id)?.status).toBe('APPROVED');

    const manager = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    // Outside their scope the request is not theirs to see: refused as not found (or forbidden), and it stays pending.
    expect([403, 404]).toContain((await manager.post(`/api/v1/orgs/${data.orgId}/time-off/requests/${outside.id}/approve`, { data: {} })).status());
    const still = (await ok<Array<{ id: string; status: string }>>(await adminApi.api.get(adminApi.orgApi('/time-off/requests')), 'requests')).find((r) => r.id === outside.id)!;
    expect(still.status).toBe('PENDING');
    await adminApi.api.post(adminApi.orgApi(`/time-off/requests/${outside.id}/cancel`), { data: {} });
    await Promise.all([manager.dispose(), worker.dispose(), ctx.close()]);
  });

  test('a member cannot approve their own request', async ({ data, adminApi }) => {
    const policy = await policyFor(adminApi, [data.worker.membershipId]);
    const worker = await asWorker();
    const sent = await requestAs(worker, data.orgId, policy.id, `QA self ${uid()}`);
    expect((await worker.post(`/api/v1/orgs/${data.orgId}/time-off/requests/${sent.id}/approve`, { data: {} })).status()).toBe(403);
    await worker.post(`/api/v1/orgs/${data.orgId}/time-off/requests/${sent.id}/cancel`, { data: {} });
    await worker.dispose();
  });

  test('a custom role without time off access is told so', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/time-off`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Requests' })).toHaveCount(0);
    await ctx.close();
  });
});
