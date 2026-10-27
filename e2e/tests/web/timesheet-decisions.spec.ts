import type { Page } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Deciding on a timesheet in Approvals: each decision is confirmed, and a draft says which decision
 * sent it back. Live, 28 Oct 2026: a reopened timesheet read "Changes requested by …" and "Draft by …".
 * Uses Nina Newcomer's week of 5 January 2026, which no other spec touches.
 */
test.use({ storageState: ADMIN_STATE });

const WEEK_DAY = '2026-01-07';

async function openNinasTimesheet(page: Page, orgId: string, tab: 'Pending' | 'Approved') {
  await page.goto(`/o/${orgId}/timesheets/approvals`);
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Timesheets' }).or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Timesheets', exact: true }) })).first();
  if (tab === 'Approved') await panel.getByRole('button', { name: 'Approved', exact: true }).click();
  await panel.getByRole('row', { name: /Nina Newcomer/ }).first().click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Nina Newcomer' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('approve, then reopen: each is confirmed, and the reopened draft says "Reopened"', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  await test.step('Nina has a submitted week (set up through the API)', async () => {
    const project = await ok(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Decisions ${data.run} ${Date.now() % 100000}`, member_ids: [data.newcomer.membershipId] } }), 'project');
    await ok(await adminApi.api.post(adminApi.orgApi('/manual-time'), { data: { membership_id: data.newcomer.membershipId, project_id: (project as { id: string }).id, local_date: WEEK_DAY, duration_seconds: 3600, reason: 'E2E: timesheet decisions' } }), 'manual time');
    await ok(await adminApi.api.post(adminApi.orgApi('/timesheets/submit'), { data: { membership_id: data.newcomer.membershipId, date: WEEK_DAY } }), 'submit');
  });

  await test.step('Approve shows a confirmation and the timesheet moves to Approved', async () => {
    const sheet = await openNinasTimesheet(page, data.orgId, 'Pending');
    await sheet.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Timesheet approved · Nina Newcomer')).toBeVisible();
  });

  await test.step('Reopen shows a confirmation, and the draft names the reopen, not "Changes requested"', async () => {
    const sheet = await openNinasTimesheet(page, data.orgId, 'Approved');
    await expect(sheet.getByText(`Approved by ${data.admin.name}`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Reopen', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Reopen timesheet' });
    await confirm.getByRole('textbox').fill('Include the Friday call');
    await confirm.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(page.getByText('Timesheet reopened as draft · Nina Newcomer')).toBeVisible();

    const reopened = page.getByRole('dialog').filter({ hasText: 'Nina Newcomer' });
    const banner = reopened.getByRole('status').filter({ hasText: 'Include the Friday call' });
    await expect(banner).toContainText(`Reopened by ${data.admin.name}`);
    await expect(banner).not.toContainText('Changes requested');
    await expect(reopened.getByText(new RegExp(`^Reopened by ${data.admin.name} · `))).toBeVisible();
    await expect(reopened.getByText(/^Draft by /)).toHaveCount(0);
  });

  await test.step('Request changes still reads "Changes requested"', async () => {
    await ok(await adminApi.api.post(adminApi.orgApi('/timesheets/submit'), { data: { membership_id: data.newcomer.membershipId, date: WEEK_DAY } }), 'submit again');
    const sheet = await openNinasTimesheet(page, data.orgId, 'Pending');
    await sheet.getByRole('button', { name: 'Request changes', exact: true }).click();
    const ask = page.getByRole('dialog').last();
    await ask.getByRole('textbox').fill('Split the call by client');
    await ask.getByRole('button', { name: /^Request changes/ }).click();
    await expect(page.getByText('Changes requested; the timesheet is back in draft · Nina Newcomer')).toBeVisible();
    // The sheet leaves Pending; the returned draft is on Nina's timesheet in Team week.
    await page.goto(`/o/${data.orgId}/timesheets/team?member=${data.newcomer.membershipId}&date=${WEEK_DAY}`);
    const banner = page.getByRole('status').filter({ hasText: 'Split the call by client' });
    await expect(banner).toContainText(`Changes requested by ${data.admin.name}`);
    await expect(banner).not.toContainText('Reopened');
  });
});
