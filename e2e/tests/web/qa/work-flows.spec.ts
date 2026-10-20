import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../../../support/env';

/**
 * QA: tracking policy overrides (set, persist, reset to inherited) and expenses (a worker submits,
 * a manager approves and reimburses; nobody approves their own), through the UI and checked
 * against the API.
 */
test.describe('QA · Tracking policies (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a member override is saved, survives a reload, and can be reset to inherited', async ({ page, data, adminApi }) => {
    const layer = async () => (await ok<{ doc: { screenshots?: { enabled?: boolean } } }>(await adminApi.api.get(adminApi.orgApi(`/policies/WORKER/${data.worker.membershipId}`)), 'layer')).doc.screenshots?.enabled;
    const open = async () => {
      await page.goto(`/o/${data.orgId}/settings/policies`);
      await expect(page.getByRole('heading', { level: 1, name: 'Tracking policies' })).toBeVisible();
      await page.getByRole('radio', { name: 'Member' }).or(page.getByRole('button', { name: 'Member', exact: true })).first().click();
      await page.getByLabel('Member', { exact: true }).selectOption({ label: data.worker.name });
    };
    const shots = page.getByRole('switch', { name: 'Capture screenshots' });
    const row = page.getByRole('listitem').filter({ has: shots });
    const save = page.getByRole('button', { name: 'Save policy' });

    await open();
    const inherited = await shots.isChecked();
    await shots.click();
    await expect(row.getByText('Overridden')).toBeVisible();
    await expect(page.getByText('Unsaved')).toBeVisible();
    await save.click();
    await expect(page.getByText('Policy saved. Affected members have been notified.')).toBeVisible();
    expect(await layer()).toBe(!inherited);

    await open();
    await expect(shots).toBeChecked({ checked: !inherited });
    await expect(row.getByText('Overridden')).toBeVisible();
    await row.getByRole('button', { name: 'Reset to inherited' }).click();
    await expect(shots).toBeChecked({ checked: inherited });
    await save.click();
    await expect(page.getByText('Policy saved. Affected members have been notified.').first()).toBeVisible();
    await expect.poll(layer).toBeUndefined();
  });
});

test.describe('QA · Tracking policies (restricted role)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('a role without policy access cannot save policies', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/policies`);
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
  });
});

test.describe('QA · Expenses (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a worker’s expense is approved and reimbursed; your own expense cannot be approved by you', { tag: '@smoke' }, async ({ page, data }) => {
    const category = `QA Taxi ${uid()}`;
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const url = `/api/v1/orgs/${data.orgId}/expenses`;
    // A zero amount is refused.
    expect((await worker.post(url, { data: { category, amount_minor: 0, currency: 'USD', spent_on: '2026-10-01' } })).status()).toBe(400);
    const exp = await ok<{ id: string; status: string }>(await worker.post(url, { data: { category, amount_minor: 4250, currency: 'USD', spent_on: '2026-10-01', reimbursable: true } }), 'expense');
    expect(exp.status).toBe('SUBMITTED');

    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
    await page.getByLabel('Search expenses').fill(category);
    const row = page.getByRole('row').filter({ hasText: category });
    await expect(row).toContainText('$42.50');
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Expense approved')).toBeVisible();
    await row.getByRole('button', { name: 'Reimburse' }).click();
    await expect(page.getByText('Marked as reimbursed')).toBeVisible();
    const status = async () => (await ok<{ items?: Array<{ id: string; status: string }> } | Array<{ id: string; status: string }>>(await worker.get(`${url}?status=ALL&q=${encodeURIComponent(category)}`), 'expenses'));
    await expect.poll(async () => {
      const r = await status();
      return (Array.isArray(r) ? r : r.items ?? []).find((e) => e.id === exp.id)?.status;
    }).toBe('REIMBURSED');
    await worker.dispose();

    // The admin's own expense shows no decision buttons to them.
    const own = `QA Own ${uid()}`;
    await page.getByRole('button', { name: /New expense/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New expense' });
    await dialog.getByLabel('Category').fill(own);
    await dialog.getByLabel('Amount').fill('12.00');
    await dialog.getByRole('button', { name: /Submit|Save|Add/ }).last().click();
    await expect(page.getByText('Expense submitted for approval')).toBeVisible();
    await page.getByLabel('Search expenses').fill(own);
    const mine = page.getByRole('row').filter({ hasText: own });
    await expect(mine).toContainText('Your expense');
    await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});
