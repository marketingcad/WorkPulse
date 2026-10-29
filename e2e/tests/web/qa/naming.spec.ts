import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE } from '../../../support/env';

/**
 * Audit 28 Oct 2026, phase 5: names and places. One address for a member's timesheet, "Timesheet
 * period" for the timesheet setting (payroll has its own pay periods), report categories named like
 * the sidebar with sentence-case titles, and rate fields that say they apply from today.
 */
test.describe('QA · Names and places (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an old link to a member’s timesheet opens it under Team week', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/timesheets?member=${data.worker.membershipId}&date=2025-03-05`);
    await expect(page).toHaveURL(new RegExp(`/timesheets/team\\?member=${data.worker.membershipId}&date=2025-03-05$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Team week' })).toBeVisible();
    await expect(page.getByLabel('Member', { exact: true })).toHaveValue(data.worker.membershipId);
  });

  test('the timesheet setting is called "Timesheet period"', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/time`);
    await expect(page.getByRole('heading', { name: 'Timesheet period' })).toBeVisible();
    await expect(page.getByLabel('Timesheet period')).toBeVisible();
    await expect(page.getByText('Pay period', { exact: true })).toHaveCount(0);
  });

  test('report categories match the sidebar, and titles are in sentence case', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/reports`);
    await expect(page.getByRole('heading', { name: 'Workforce' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Timesheet approval/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Time & activity/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toHaveCount(0);
  });

  test('project rate fields say they apply from today, and link to Rates', async ({ page, data, adminApi }) => {
    const name = `Rated ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name } }), 'project');
    await page.goto(`/o/${data.orgId}/projects`);
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit project' });
    await expect(dialog.getByText(/what you pay, from today/)).toBeVisible();
    await expect(dialog.getByText(/what you charge, from today/)).toBeVisible();
    await expect(dialog.getByRole('link', { name: /See all rates/ })).toHaveAttribute('href', `/o/${data.orgId}/finance/billing`);
  });
});
