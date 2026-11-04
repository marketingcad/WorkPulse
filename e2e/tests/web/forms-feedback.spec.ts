import { readFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { expect, ok, search, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Forms and feedback (UX remediation, phase 4): no silent validation, no button that is grey
 * without a reason on the page, consequences stated before they happen, edits not lost to a stray
 * click, and exports that match what the list shows.
 */
test.use({ storageState: ADMIN_STATE });

async function sentInvoice(adminApi: { api: import('@playwright/test').APIRequestContext; orgApi: (p: string) => string }, clientName: string, email?: string) {
  const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: clientName, ...(email ? { email } : {}) } }), 'client');
  const today = new Date().toISOString().slice(0, 10);
  const inv = await ok<{ id: string; number: string }>(
    await adminApi.api.post(adminApi.orgApi('/invoices'), {
      data: { client_id: client.id, period_start: today, period_end: today, issue_date: today, due_date: today, group_by: 'project', tax_rate_bps: 0, include_expenses: false, notes: null, extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 10000, tax_rate_bps: 0 }] },
    }),
    'invoice',
  );
  await ok(await adminApi.api.post(adminApi.orgApi(`/invoices/${inv.id}/send`), { data: {} }), 'send');
  return { ...inv, clientId: client.id };
}

test.describe('invoices', () => {
  test('a custom line says what is wrong, and a stray link asks before the draft is lost', async ({ page, data, adminApi }) => {
    const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Lines ${uid()}` } }), 'client');
    await page.goto(`/o/${data.orgId}/finance/invoices/new?client=${client.id}`);
    await page.getByRole('button', { name: 'Preview lines' }).click();
    await page.getByRole('button', { name: 'Add line' }).click();
    // A blank line: the reason the next step is unavailable is written under the list.
    await expect(page.getByRole('status').filter({ hasText: 'Each custom line needs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dates & notes', exact: true })).toBeDisabled();
    // A discount typed as a negative price is explained, with what to do instead.
    await page.getByLabel(/Unit price/).fill('-50');
    await expect(page.getByRole('main').getByRole('alert').filter({ hasText: 'Prices cannot be negative' })).toContainText('lower the client’s rate');
    await page.getByLabel('Description').fill('Setup');
    await page.getByLabel(/Unit price/).fill('100');
    await expect(page.getByRole('status').filter({ hasText: 'Each custom line needs' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    // Leaving through the sidebar asks first; staying keeps the draft.
    const asked: string[] = [];
    page.once('dialog', (d) => (asked.push(d.message()), void d.dismiss()));
    await page.getByRole('navigation').getByRole('link', { name: 'Clients', exact: true }).first().click();
    await expect.poll(() => asked).toEqual(['You have unsaved changes. Leave this page and lose them?']);
    await expect(page).toHaveURL(/\/finance\/invoices\/new/);
    await expect(page.getByLabel('Description')).toHaveValue('Setup');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('navigation').getByRole('link', { name: 'Clients', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/clients`));
  });

  test('a reminder says what will be emailed, then confirms who got it', async ({ page, data, adminApi }) => {
    const inv = await sentInvoice(adminApi, `Remind ${uid()}`, `ap+${uid()}@e2e.test`);
    await page.goto(`/o/${data.orgId}/finance/invoices/${inv.id}`);
    await page.getByRole('button', { name: 'Send reminder' }).click();
    const confirm = page.getByRole('dialog', { name: `Send a reminder about ${inv.number}?` });
    await expect(confirm).toContainText('the amount still due ($100.00)');
    await expect(confirm).toContainText('The invoice does not change.');
    await confirm.getByRole('button', { name: 'Send reminder' }).click();
    await expect(page.getByText(/^Reminder sent to ap\+/)).toBeVisible();
  });

  test('without a client email the reminder is unavailable, and the page says why', async ({ page, data, adminApi }) => {
    const name = `No email ${uid()}`;
    const inv = await sentInvoice(adminApi, name);
    await page.goto(`/o/${data.orgId}/finance/invoices/${inv.id}`);
    await expect(page.getByRole('button', { name: 'Send reminder' })).toBeDisabled();
    await expect(page.getByRole('note').filter({ hasText: 'To send reminders' })).toHaveText(`To send reminders, add an email address to ${name} in Clients.`);
  });

  test('the export holds the chosen client and search only', async ({ page, data, adminApi }) => {
    const name = `Export ${uid()}`;
    const inv = await sentInvoice(adminApi, name);
    const other = await sentInvoice(adminApi, `Other ${uid()}`);
    await page.goto(`/o/${data.orgId}/finance/invoices`);
    await page.getByLabel('Date range').selectOption('this_month');
    await page.getByLabel('Client').selectOption({ label: name });
    await search(page, 'Search invoices', inv.number, '/invoices');
    await page.getByRole('button', { name: 'Export' }).click();
    const sent = page.waitForRequest((r) => r.url().includes('/reports/invoices/export'));
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'CSV' }).click();
    expect((await sent).postDataJSON()).toMatchObject({ client_ids: [inv.clientId], q: inv.number, format: 'CSV' });
    const csv = readFileSync(await (await download).path(), 'utf8');
    expect(csv).toContain(inv.number);
    expect(csv).not.toContain(other.number);
  });
});

test.describe('payments, budgets, currencies', () => {
  test('recording a payment says, before saving, when no invoice balance goes down', async ({ page, data, adminApi }) => {
    const name = `Payer ${uid()}`;
    await sentInvoice(adminApi, name);
    await page.goto(`/o/${data.orgId}/finance/invoices/payments`);
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Record payment' });
    await dialog.getByLabel(/^Amount/).fill('40');
    await expect(dialog.getByRole('status')).toContainText('$40.00 will not be applied to any invoice (no client is chosen)');
    await dialog.getByLabel('Client').selectOption({ label: name });
    await expect(dialog.getByRole('status')).toContainText('Use “Oldest first”');
    await dialog.getByRole('button', { name: 'Oldest first' }).click();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a budget warning level out of range is refused with a reason, not replaced', async ({ page, data, adminApi }) => {
    const project = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Budget ${uid()}` } }), 'project');
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await page.getByRole('button', { name: 'Set budget' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Set budget' });
    await dialog.getByLabel('Project').selectOption({ value: project.id });
    await dialog.getByLabel(/^(Hours|Amount)/).fill('100');
    await dialog.getByLabel('Warn at (%)').fill('150');
    const writes: string[] = [];
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/budgets') && writes.push(r.url()));
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Use a whole number from 1 to 100, e.g. 80.');
    expect(writes).toEqual([]);
    await dialog.getByLabel('Warn at (%)').fill('75');
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByText('Budget saved')).toBeVisible();
    const budgets = await ok<Array<{ subject_id: string; warn_pct: number }> | { data: Array<{ subject_id: string; warn_pct: number }> }>(await adminApi.api.get(adminApi.orgApi('/budgets')), 'budgets');
    expect((Array.isArray(budgets) ? budgets : budgets.data).find((b) => b.subject_id === project.id)?.warn_pct).toBe(75);
  });

  test('currencies are chosen from a list on expenses and rates', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await page.getByRole('button', { name: 'New expense' }).first().click();
    const expense = page.getByRole('dialog', { name: 'New expense' }).getByRole('combobox', { name: 'Currency' });
    await expect(expense).toHaveValue('USD');
    await expense.selectOption('EUR');
    await expect(expense).toHaveValue('EUR');
    await page.keyboard.press('Escape');
    await page.goto(`/o/${data.orgId}/finance/billing`);
    await page.getByRole('button', { name: 'Set bill rate' }).first().click();
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Currency' }).locator('option')).toContainText(['USD', 'EUR', 'GBP']);
  });
});

test.describe('payroll with no pay group yet', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Run payroll explains what a pay group is and creates one without leaving', async ({ page }) => {
    const su = await page.request.post('/api/v1/auth/signup', { headers: { Origin: WEB_URL }, data: { name: 'Pam Owner', email: `pam+${uid()}@e2e.test`, password: PASSWORD, organization_name: `Payroll ${uid()}`, timezone: 'UTC' } });
    expect(su.status()).toBe(201);
    const orgId = (await su.json()).organization_id as string;
    // The welcome tour starts on the first visit to the overview.
    await page.goto(`/o/${orgId}`);
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await page.goto(`/o/${orgId}/finance/payroll`);
    await page.getByRole('button', { name: 'Run payroll' }).first().click();
    const run = page.getByRole('dialog', { name: 'Run payroll' });
    await expect(run).toContainText('Payroll runs for a pay group: it sets the pay period, the currency and who is paid. There is none yet.');
    await expect(run.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    await run.getByRole('button', { name: 'Create a pay group' }).click();
    const group = page.getByRole('dialog', { name: 'New pay group' });
    await group.getByLabel('Name').fill('Monthly staff');
    await group.getByLabel('Members').click();
    await page.getByRole('option', { name: 'Pam Owner' }).getByRole('checkbox').check();
    await page.keyboard.press('Escape');
    await group.getByRole('button', { name: 'Create pay group' }).click();
    await expect(page.getByText('Pay group created')).toBeVisible();
    // Back in Run payroll, with the new group chosen.
    await expect(run.getByLabel('Pay group').locator('option:checked')).toContainText('Monthly staff');
    await expect(run.getByRole('button', { name: 'Create draft' })).toBeEnabled();
  });
});

test.describe('time off approvals', () => {
  test('the queue shows who else is away, and a bulk approval names who failed and why', async ({ page, data, adminApi }) => {
    const tag = `Leave ${uid()}`;
    const policy = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name: tag, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.worker.membershipId, data.admin.membershipId] } }), 'policy');
    const day = new Date(Date.UTC(2029, 0, 1 + 7 * Math.floor(Math.random() * 400))).toISOString().slice(0, 10);
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const w = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
    const mine = await ok<{ id: string }>(await worker.post(w('/time-off/requests'), { data: { policy_id: policy.id, start_date: day, end_date: day, half_day: false, reason: tag } }), 'worker request');
    await ok(await adminApi.api.post(adminApi.orgApi('/time-off/requests'), { data: { policy_id: policy.id, start_date: day, end_date: day, half_day: false, reason: tag } }), 'admin request');

    await page.goto(`/o/${data.orgId}/time-off?tab=requests`);
    await search(page, 'Search time off requests', tag, '/time-off/requests');
    // The worker's own row (the admin's row also names the worker, as also requesting that day).
    const row = page.getByRole('row', { name: new RegExp(`^Select row ${data.worker.name}`) });
    await expect(row).toContainText(`also requested: ${data.admin.name}`);
    await expect(row).toContainText(/left after approval|Balance not tracked/);

    // The worker withdraws it while the list is open: approving it now fails, and the message says whose and why.
    await ok(await worker.post(w(`/time-off/requests/${mine.id}/cancel`), { data: {} }), 'cancel');
    await row.getByRole('checkbox', { name: 'Select row' }).check();
    await page.getByRole('button', { name: 'Approve 1' }).click();
    await expect(page.getByText(new RegExp(`^Not approved: ${data.worker.name} \\(.+\\): .+`))).toBeVisible();
    await worker.dispose();
  });
});
