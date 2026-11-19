import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, WORKER_STATE } from '../../support/env';

/**
 * Expenses (QA pass, feature 15). Approving, rejecting and reimbursing are covered by qa/work-flows and
 * navigation-flows; this spec covers submitting from the page and the rules the server enforces.
 *
 * - BUG-35: a future date was accepted.
 * - BUG-36: a billable expense with no project, which could never reach an invoice, was accepted.
 */
const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.describe('An admin', () => {
  test.use({ storageState: ADMIN_STATE });

  async function openForm(page: import('@playwright/test').Page, orgId: string, category: string) {
    await page.goto(`/o/${orgId}/finance/expenses`);
    await page.getByRole('button', { name: 'New expense' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New expense' });
    await dialog.getByLabel(/^Category/).fill(category);
    await dialog.getByLabel(/^Amount/).fill('12.50');
    return dialog;
  }

  test('submits an expense, which waits for someone else to approve it', { tag: '@smoke' }, async ({ page, data }) => {
    const category = `Parking ${uid()}`;
    const dialog = await openForm(page, data.orgId, category);
    await dialog.getByRole('button', { name: 'Submit expense' }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Search expenses').fill(category);
    const row = page.getByRole('row', { name: new RegExp(category) });
    await expect(row).toBeVisible();
    await expect(row.getByText('$12.50')).toBeVisible();
    // Nobody approves their own expense.
    await expect(row.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  });

  test('a future date is refused on the date field (BUG-35)', async ({ page, data }) => {
    const category = `Future ${uid()}`;
    const dialog = await openForm(page, data.orgId, category);
    await dialog.getByLabel(/^Date/).fill(dateIn(3));
    await dialog.getByRole('button', { name: 'Submit expense' }).click();
    await expect(dialog.getByText('Use the date you spent it, today or earlier')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('a billable expense needs a project to bill (BUG-36)', async ({ page, data }) => {
    const dialog = await openForm(page, data.orgId, `Billable ${uid()}`);
    await dialog.getByRole('checkbox', { name: 'Billable to client' }).check();
    await dialog.getByRole('button', { name: 'Submit expense' }).click();
    await expect(dialog.getByText('Choose a project, or untick Billable')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('says when a search finds nothing', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await page.getByLabel('Search expenses').fill(`nothing-${uid()}`);
    await expect(page.getByText('No expenses match your search')).toBeVisible();
  });
});

test.describe('A team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('sees only their team’s expenses', async ({ page, data, adminApi }) => {
    // An expense by the admin, who is in no team the manager manages.
    const category = `Admin only ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/expenses'), { data: { category, amount_minor: 900, currency: 'USD', spent_on: dateIn(-1) } }), 'admin expense');
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/expenses?page=1&page_size=100&q=${encodeURIComponent(category)}`);
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0);
  });
});

test.describe('A worker', () => {
  test.use({ storageState: WORKER_STATE });

  test('cannot read anyone else’s expenses', async ({ page, data, adminApi }) => {
    const category = `Not yours ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/expenses'), { data: { category, amount_minor: 900, currency: 'USD', spent_on: dateIn(-1) } }), 'admin expense');
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/expenses?page=1&page_size=100&q=${encodeURIComponent(category)}`);
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0);
  });
});
