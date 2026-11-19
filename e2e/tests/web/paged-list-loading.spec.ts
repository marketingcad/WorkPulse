import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * A paged list that switches tab or filter shows that it is loading, never the previous list's rows
 * or its empty message under the new heading (QA round 6, BUG-24: Approvals said "No approved
 * timesheets" for about 3 s while the Approved tab loaded). The answer is held back on purpose, as a
 * slow connection would.
 */
test.use({ storageState: ADMIN_STATE });

test('Approvals: the Approved tab says it is loading, then shows the approved timesheets', async ({ page, data }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/v1/orgs/*/timesheets/approvals?*status=APPROVED*', async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(`/o/${data.orgId}/timesheets/approvals`);
  const timesheets = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Timesheets', exact: true }) }).last();
  // The Pending tab has loaded (rows or its own empty message).
  await expect(timesheets.getByRole('table').or(timesheets.getByText('Nothing waiting for approval')).first()).toBeVisible();

  const approvedTab = page.getByRole('tab', { name: /^Approved/ }).or(page.getByRole('button', { name: /^Approved/ })).first();
  await approvedTab.click();
  // While the answer is on its way: loading, not "none", and not the Pending tab's list.
  await expect(timesheets.getByLabel('Loading')).toBeVisible();
  await expect(timesheets.getByText('No approved timesheets')).toHaveCount(0);
  await expect(timesheets.getByText('Nothing waiting for approval')).toHaveCount(0);

  release();
  // The shared setup approved a week for the worker, so the tab is not empty.
  await expect(timesheets.getByRole('row', { name: new RegExp(data.worker.name) }).first()).toBeVisible();
  await expect(timesheets.getByText('No approved timesheets')).toHaveCount(0);
});
