import type { Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * QA audit, 11 Nov 2026 (Phase 4): screens that showed the wrong thing while a slow server answered.
 * The test server is fast, so each test holds a request back, as production's 2-3 s did.
 * - BUG-03: Members › Former members showed the current members (the active owner, under "Date left").
 * - BUG-04: the Overview was blank under its heading until the dashboard layout arrived.
 * - C-11: after Submit or a decision, the status and the queue kept the old state until a full reload.
 * Mona Lead's timesheets in March 2026 are used here only.
 */
test.use({ storageState: ADMIN_STATE });

/** Holds matching GET requests back for `ms` while `hold.on` is true. */
async function holdBack(page: Page, pattern: RegExp, ms: number) {
  const hold = { on: true };
  await page.route(pattern, async (route) => {
    if (route.request().method() === 'GET' && hold.on) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  return hold;
}

test('Former members never shows current members while it loads', { tag: '@smoke' }, async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/workers`);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(data.admin.name) })).toBeVisible();
  await holdBack(page, /\/api\/v1\/orgs\/[^/]+\/workers\?.*view=former/, 2500);
  await page.getByRole('tab', { name: 'Former members' }).or(page.getByRole('button', { name: 'Former members', exact: true })).first().click();
  // While the former list loads: a loading state, and not the owner, who has not left.
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(data.admin.name) })).toHaveCount(0);
  await expect(page.getByText('No former members').or(page.getByRole('columnheader', { name: /Date left/i })).first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(data.admin.name) })).toHaveCount(0);
});

test('the Overview shows placeholder cards, not a blank page, until its layout arrives', async ({ page, data }) => {
  await holdBack(page, /\/api\/v1\/orgs\/[^/]+\/dashboard\/layout/, 2500);
  await page.goto(`/o/${data.orgId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('overview-loading')).toBeVisible();
  await expect(page.getByTestId('overview-loading').locator('[aria-busy="true"]').first()).toBeVisible();
  // Then the widgets replace them.
  await expect(page.getByTestId('overview-loading')).toHaveCount(0, { timeout: 15_000 });
});

test('a submitted or approved timesheet changes at once, before the slow refresh', async ({ page, data, adminApi }) => {
  const mona = data.manager.membershipId;
  const day = '2026-03-04';
  const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Stale ${uid()}`, member_ids: [mona] } }), 'project');
  await ok(await adminApi.api.post(adminApi.orgApi('/manual-time'), { data: { membership_id: mona, project_id: project.id, local_date: day, duration_seconds: 3600, reason: 'E2E: stale screens' } }), 'manual time');

  await test.step('Submit: the status reads Submitted at once', async () => {
    await page.goto(`/o/${data.orgId}/timesheets/team?member=${mona}&date=${day}`);
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
    const hold = await holdBack(page, /\/api\/v1\/orgs\/[^/]+\/timesheets\?/, 6000);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Submit for approval' }).click();
    // Well before the held-back refresh (6 s) could answer.
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible({ timeout: 3000 });
    hold.on = false;
  });

  await test.step('Approve: the timesheet leaves Pending at once', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto(`/o/${data.orgId}/timesheets/approvals`);
    const row = page.getByRole('row', { name: new RegExp(`${data.manager.name}.*Mar 2 – Mar 8, 2026`) });
    await row.click();
    const sheet = page.getByRole('dialog').filter({ hasText: data.manager.name });
    await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await holdBack(page, /\/api\/v1\/orgs\/[^/]+\/timesheets\/approvals/, 6000);
    await sheet.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(`Timesheet approved · ${data.manager.name}`)).toBeVisible();
    await expect(row).toHaveCount(0, { timeout: 3000 });
  });
});
