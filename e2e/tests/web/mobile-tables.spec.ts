import AxeBuilder from '@axe-core/playwright';
import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * UX audit, phase 1 (C2): below tablet width every list becomes stacked cards. The cards used to
 * drop the row actions and the selection checkboxes, so nothing could be approved, edited or
 * revoked on a phone. They also could not be opened from the keyboard.
 */
test.use({ storageState: ADMIN_STATE });

const PHONE = { width: 390, height: 844 };

test.describe('lists on a phone', () => {
  test('a row keeps its actions menu', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const name = `Phone client ${data.run} ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    await page.setViewportSize(PHONE);
    await page.goto(`/o/${data.orgId}/clients`);
    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeVisible();
  });

  test('a manager selects and approves a time-off request', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    // A policy for the worker, and a request the worker sends through the API, as the desktop app does.
    const name = `Phone leave ${uid()}`;
    const policy = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.worker.membershipId] } }), 'policy');
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const requests = `/api/v1/orgs/${data.orgId}/time-off/requests`;
    const reason = `Phone trip ${data.run}-${uid()}`;
    const sent = await ok<{ id: string }>(await worker.post(requests, { data: { policy_id: policy.id, start_date: '2027-03-01', end_date: '2027-03-01', half_day: false, reason } }), 'request');

    await page.setViewportSize(PHONE);
    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    const card = page.getByRole('listitem').filter({ hasText: reason });
    await expect(card).toBeVisible();
    // Selection for bulk approval is still there on a phone.
    await card.getByRole('checkbox', { name: 'Select row' }).check();
    await expect(page.getByText('1 selected')).toBeVisible();
    await card.getByRole('checkbox', { name: 'Select row' }).uncheck();
    // And so is the row's own Approve button.
    await card.getByRole('button', { name: 'Approve' }).click();
    const status = async () => (await ok<Array<{ id: string; status: string }>>(await worker.get(requests), 'requests')).find((r) => r.id === sent.id)?.status;
    await expect.poll(status).toBe('APPROVED');
    await worker.dispose();
  });

  test('the stacked list has no accessibility violations', async ({ page, data, adminApi }) => {
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Axe client ${data.run} ${uid()}` } }), 'client');
    await page.setViewportSize(PHONE);
    await page.goto(`/o/${data.orgId}/clients`);
    await expect(page.getByRole('listitem').filter({ hasText: 'Axe client' }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).include('main ul').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('rows from the keyboard', () => {
  test('Enter opens the row; Enter on its actions button opens only the menu', async ({ page, data, adminApi }) => {
    const name = `Keys client ${data.run} ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    await page.goto(`/o/${data.orgId}/clients`);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await row.getByRole('button', { name: `Actions for ${name}` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeHidden();
  });

  test('Space opens a stacked card on a phone', async ({ page, data, adminApi }) => {
    const name = `Space client ${data.run} ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    await page.setViewportSize(PHONE);
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('listitem').filter({ hasText: name }).getByRole('button').filter({ hasText: name }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Edit client' })).toBeVisible();
  });
});

test.describe('wide tables', () => {
  test('a table wider than its box scrolls inside it, not the whole page', async ({ page, data, adminApi }) => {
    // Regression: the screen-reader-only "Actions" header escaped the table's scroll box and widened the page.
    const long = `A project with a deliberately very long name to make the table wide ${uid()}`;
    const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: long, member_ids: [data.worker.membershipId] } }), 'project');
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    await ok(await worker.post(`/api/v1/orgs/${data.orgId}/manual-time`, { data: { project_id: project.id, started_at: '2025-07-07T09:00:00.000Z', ended_at: '2025-07-07T10:00:00.000Z', reason: `${long} — and an equally long reason` } }), 'manual time');
    await worker.dispose();
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/o/${data.orgId}/timesheets/approvals`);
    await expect(page.getByRole('row').filter({ hasText: long }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe('Overview when it cannot load', () => {
  test('a failed load is an error with a retry, not "no access"', async ({ page, data }) => {
    let fail = true;
    await page.route('**/dashboard/widgets**', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) }) : route.continue()));
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible();
    await expect(page.getByText('You do not have access to this widget')).toHaveCount(0);
    fail = false;
    await page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first().getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Something went wrong on our side')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  });
});
