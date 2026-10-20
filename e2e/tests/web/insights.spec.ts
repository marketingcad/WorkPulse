import { expect, test, usd } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Insights: time, estimated pay and billable totals per person. An admin sees everyone with money;
 * someone who may only see their own time sees no one else and no money.
 * Data: global-setup logs 3 h of approved time for Wade at $25/h on the first day of the last pay week.
 */

/** Open Insights on the month that holds the setup's approved time (this month or the previous one). */
async function openMonthWithWadesTime(page: import('@playwright/test').Page, orgId: string, day: string) {
  await page.goto(`/o/${orgId}/insights`);
  await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible();
  // The setup's organization is in UTC; "Monthly" is the default period.
  if (day.slice(0, 7) !== new Date().toISOString().slice(0, 7)) await page.getByRole('button', { name: 'Previous period' }).click();
}

test.describe('Insights (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin sees each person’s time and estimated pay', { tag: '@smoke' }, async ({ page, data }) => {
    await openMonthWithWadesTime(page, data.orgId, data.payStub.periodStart);
    const people = page.getByRole('table', { name: 'Time and money per person' });
    await expect(people.getByRole('columnheader', { name: 'Est. pay' })).toBeVisible();
    const wade = people.getByRole('row', { name: new RegExp(data.worker.name) });
    await expect(wade).toContainText('3h 00m');
    await expect(wade).toContainText(usd(7500));
  });
});

test.describe('Insights (own time only)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone who may only see their own time sees no one else and no money', async ({ page, data }) => {
    await openMonthWithWadesTime(page, data.orgId, data.payStub.periodStart);
    await expect(page.getByText('Time logged')).toBeVisible();
    await expect(page.getByText('Est. pay')).toHaveCount(0);
    await expect(page.getByText('Est. billable')).toHaveCount(0);
    await expect(page.getByText(data.worker.name)).toHaveCount(0);
    await expect(page.getByText(usd(7500))).toHaveCount(0);
  });
});
