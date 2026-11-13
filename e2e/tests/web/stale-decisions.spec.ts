import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * QA audit, 13 Nov 2026 (BUG-18). A timesheet page opened before someone else approved the timesheet
 * kept showing "Submitted" with an Approve button. Pressing it was refused (409), and the page still
 * offered the same button. Now the page says what happened and shows the current status.
 * Mona Lead's May 2026 weeks: no other spec uses them, and she is in no finalized payroll.
 */
test.use({ storageState: ADMIN_STATE });

test('approving a timesheet someone already approved explains it and shows the current status', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const mona = data.manager.membershipId;
  const day = '2026-05-06';
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: mona, project_id: data.projects.website.id, local_date: day, duration_seconds: 5400, reason: 'E2E: stale decision' } }), 'manual time');
  const ts = await ok<{ id: string }>(await api.post(orgApi('/timesheets/submit'), { data: { membership_id: mona, date: day } }), 'submit');

  // The page is open with the timesheet still submitted…
  await page.goto(`/o/${data.orgId}/timesheets/team?member=${mona}&date=${day}`);
  const main = page.getByRole('main');
  await expect(main.getByText('Submitted', { exact: true }).first()).toBeVisible();
  const approve = main.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeVisible();

  // …when someone else approves it.
  await ok(await api.post(orgApi(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve elsewhere');

  await approve.click();
  await expect(page.getByText(/It changed since this page opened, so it now shows its current status\./)).toBeVisible();
  // The page catches up: approved, and no Approve button that can never work.
  await expect(main.getByText(/Approved by/).first()).toBeVisible();
  await expect(approve).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Reopen' })).toBeVisible();
});
