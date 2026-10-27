import { readFileSync } from 'node:fs';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Phase 2 of the admin simplification: one Timesheets item (Approvals with timesheets and manual
 * time on one page, and Team week), what members are owed on Payroll, Export on the finance list
 * pages, and the Organization settings split into Organization and Time & pay. Old addresses
 * keep working.
 */
const sidebar = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Primary' });

test.describe('Consolidated pages (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Timesheets: Approvals holds submitted timesheets and manual time; Team week is the other tab', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const nav = sidebar(page);
    const group = nav.getByRole('button', { name: 'Time' });
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await nav.getByRole('link', { name: 'Timesheets' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/timesheets/approvals$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Timesheets' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Manual time requests' })).toBeVisible();
    // In the panel's header (the empty state may offer the same button).
    await expect(page.getByRole('button', { name: 'Request manual time' }).first()).toBeVisible();

    const tabs = page.getByRole('navigation', { name: 'Timesheets' });
    await tabs.getByRole('link', { name: 'Team week' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Team week' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Hours per member this week' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Timesheets' })).toHaveAttribute('aria-current', 'page');
  });

  test('a timesheet opens in a drawer from Approvals (loaded when opened)', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/timesheets/approvals`);
    // The Timesheets panel (the manual time panel below has its own Approved tab).
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: 'Timesheets' }) });
    await panel.getByRole('button', { name: 'Approved', exact: true }).click();
    await panel.getByRole('table', { name: 'Timesheets' }).getByRole('row', { name: new RegExp(data.worker.name) }).first().click();
    const drawer = page.getByRole('dialog', { name: data.worker.name });
    await expect(drawer.getByRole('link', { name: 'Open full page' })).toBeVisible();
    // The timesheet itself, with its decision buttons (approved, so it can be reopened).
    await expect(drawer.getByRole('button', { name: 'Reopen' })).toBeVisible();
  });

  test('a manual time request is decided on Approvals', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const reason = `Client visit ${uid()}`;
    // Manual time for a member (an admin's entry may be approved at once; the All tab lists it either way).
    const req = await api.post(orgApi('/manual-time'), { data: { membership_id: data.worker.membershipId, project_id: data.projects.website.id, started_at: '2025-09-02T09:00:00.000Z', ended_at: '2025-09-02T10:00:00.000Z', reason } });
    expect(req.ok()).toBe(true);
    await page.goto(`/o/${data.orgId}/timesheets/approvals`);
    await page.getByLabel('Search manual time').fill(reason);
    await page.getByRole('button', { name: /^All/ }).click();
    await expect(page.getByRole('table', { name: 'Manual time requests' })).toContainText(reason);
  });

  test('what members are owed is on Payroll › Owed; Rates is only rates', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/billing`);
    await expect(page.getByRole('heading', { level: 1, name: 'Rates' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amounts owed' })).toHaveCount(0);

    await page.goto(`/o/${data.orgId}/finance/payroll?tab=owed`);
    await expect(page.getByRole('heading', { level: 1, name: 'Payroll' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Owed', pressed: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Amounts owed by member' })).toBeVisible();
    await page.getByRole('button', { name: 'Payrolls' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Payrolls' })).toBeVisible();
  });

  test('finance pages export what they show; Export asks for a period first', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    const exportButton = page.getByRole('button', { name: 'Export' });
    await expect(exportButton).toBeDisabled();
    await expect(exportButton).toHaveAttribute('title', 'Pick a period to export');

    await page.getByLabel('Date range').selectOption('this_month');
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^expenses_\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(readFileSync((await file.path())!, 'utf8').split('\n')[0]).toContain('Date');

    for (const path of ['/finance/invoices', '/finance/invoices/payments']) {
      await page.goto(`/o/${data.orgId}${path}`);
      await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
      await page.getByLabel('Date range').selectOption('last_30');
      await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
    }
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  test('a period filters the invoice list; Any date shows everything again', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/invoices`);
    await page.getByLabel('Date range').selectOption('custom');
    // Exact labels: "To" is also a substring of other names on every page (the calculator button).
    await page.getByLabel('From', { exact: true }).fill('2001-01-01');
    await page.getByLabel('To', { exact: true }).fill('2001-01-31');
    await expect(page.getByText(/No invoices/)).toBeVisible();
    await page.getByLabel('Date range').selectOption('all');
    await expect(page.getByLabel('From', { exact: true })).toHaveCount(0);
  });

  test('Organization and Time & pay save separately, without undoing each other', async ({ page, data, adminApi }) => {
    const { api } = adminApi;
    // A throwaway organization, so other specs never see these settings.
    const created = await ok<{ organization_id: string }>(await api.post('/api/v1/me/organizations', { data: { name: `Split ${uid()}`, timezone: 'UTC', currency: 'USD' } }), 'org');
    const orgId = created.organization_id;
    await page.goto(`/o/${orgId}/settings/time`);
    await expect(page.getByRole('heading', { level: 1, name: 'Time & pay' })).toBeVisible();
    await page.getByLabel('Lock time older than (days)').fill('9');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Time & pay settings saved')).toBeVisible();

    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Organization' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
    await expect(page.getByLabel('Lock time older than (days)')).toHaveCount(0);
    await page.getByLabel('Company brief').fill('Builds things');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Organization settings saved')).toBeVisible();

    await page.goto(`/o/${orgId}/settings/time`);
    await expect(page.getByLabel('Lock time older than (days)')).toHaveValue('9');
    await expect(page.getByRole('heading', { name: 'Break types' })).toBeVisible();
  });
});

test.describe('Consolidated pages (restricted role)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('no report access, no Export; no Timesheets item without approval or team access', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
    await expect(sidebar(page).getByRole('link', { name: 'Timesheets' })).toHaveCount(0);
  });
});
