import { request } from '@playwright/test';
import { expect, ok, test, usd, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Payroll: the finalized payroll from the shared setup, a full run for a new pay group (create the
 * group, run payroll, add a bonus, finalize, mark as paid), the checks along the way, and who must
 * not see payroll at all. Each run test invites its own person, so the shared Workers' pay stubs
 * (used by the desktop pay stub specs) never change.
 */
test.describe('Payroll (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens the finalized payroll and sees each pay stub', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/payroll`);
    await expect(page.getByRole('heading', { level: 1, name: 'Payroll' })).toBeVisible();
    await page.getByRole('row', { name: new RegExp(`Weekly ${data.run}`) }).click();

    await expect(page).toHaveURL(new RegExp(`/finance/payroll/[0-9a-f-]{36}$`));
    await expect(page.getByText('Finalized').first()).toBeVisible();
    const wade = page.getByRole('row', { name: new RegExp(data.worker.name) });
    await expect(wade).toContainText(usd(data.payStub.netMinor));
    await expect(wade.getByRole('link', { name: 'Stub' })).toBeVisible();
    // A finalized payroll can no longer be changed, only marked as paid.
    await expect(page.getByRole('button', { name: 'Finalize' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adjust', exact: true })).toHaveCount(0);
  });

  test('an admin creates a pay group, runs payroll with a bonus, finalizes it and marks it paid', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const suffix = `${data.run}-${uid()}`;
    const person = `Pat Payroll ${suffix}`;
    const group = `Pat's group ${suffix}`;
    await invitePerson(adminApi, `pat+${suffix}@e2e.test`, person);

    await page.goto(`/o/${data.orgId}/finance/payroll`);
    await page.getByRole('button', { name: 'Pay groups' }).click();
    await page.getByRole('button', { name: 'New pay group' }).click();
    const groupDialog = page.getByRole('dialog', { name: 'New pay group' });
    await groupDialog.getByLabel('Name').fill(group);
    await groupDialog.getByLabel('Members').click();
    await page.getByRole('option', { name: person }).getByRole('checkbox').check();
    await page.keyboard.press('Escape');
    await groupDialog.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByText('Pay group created')).toBeVisible();

    await page.getByRole('button', { name: 'Payrolls' }).click();
    await page.getByRole('button', { name: 'Run payroll' }).first().click();
    const runDialog = page.getByRole('dialog', { name: 'Run payroll' });
    await selectGroup(runDialog, group);
    await runDialog.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(new RegExp(`/finance/payroll/[0-9a-f-]{36}$`));
    await expect(page.getByText('Draft').first()).toBeVisible();
    const line = page.getByRole('row', { name: new RegExp(person) });
    await expect(line).toBeVisible();

    await line.getByRole('button', { name: 'Adjust', exact: true }).click();
    const adjust = page.getByRole('dialog', { name: `Bonuses and deductions · ${person}` });
    await adjust.getByRole('button', { name: 'Add line' }).click();
    // A line needs a label and an amount before it can be saved.
    await expect(adjust.getByRole('button', { name: 'Save' })).toBeDisabled();
    await adjust.getByLabel('Label').fill('Signing bonus');
    await adjust.getByLabel('Amount (USD)').fill('150');
    await expect(adjust.getByRole('button', { name: 'Save' })).toBeEnabled();
    await adjust.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Adjustments saved')).toBeVisible();
    await expect(line).toContainText(usd(15000));

    await page.getByRole('button', { name: 'Finalize' }).click();
    // Finalizing is irreversible and says so (money audit M17); corrections go on the next payroll.
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog')).getByText(/This cannot be undone.*bonus or deduction on the next payroll/)).toBeVisible();
    await page.getByRole('button', { name: 'Finalize' }).last().click();
    await expect(page.getByText('Payroll finalized; members can see their pay stubs')).toBeVisible();
    await expect(line.getByRole('link', { name: 'Stub' })).toBeVisible();

    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await page.getByRole('button', { name: 'Mark as paid' }).last().click();
    await expect(page.getByText('Payroll marked as paid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
  });

  test('the same pay group cannot be paid twice for one period', async ({ page, data, adminApi }) => {
    const suffix = `${data.run}-${uid()}`;
    const person = `Quinn Payroll ${suffix}`;
    const group = `Quinn's group ${suffix}`;
    const membershipId = await invitePerson(adminApi, `quinn+${suffix}@e2e.test`, person);
    await ok(await adminApi.api.post(adminApi.orgApi('/payroll/profiles'), { data: { name: group, period: { type: 'weekly' }, currency: 'USD', member_ids: [membershipId] } }), 'pay group');

    await page.goto(`/o/${data.orgId}/finance/payroll`);
    for (const attempt of [1, 2]) {
      await page.getByRole('button', { name: 'Run payroll' }).first().click();
      const runDialog = page.getByRole('dialog', { name: 'Run payroll' });
      await selectGroup(runDialog, group);
      await runDialog.getByRole('button', { name: 'Create draft' }).click();
      if (attempt === 1) {
        await expect(page).toHaveURL(new RegExp(`/finance/payroll/[0-9a-f-]{36}$`));
        await page.goto(`/o/${data.orgId}/finance/payroll`);
      } else {
        // The second run for the same period is refused, and the dialog stays open with the reason.
        await expect(runDialog.getByRole('alert')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/finance/payroll$`));
      }
    }
  });

  test('time approved after its payroll was finalized is paid by the next payroll', async ({ page, data, adminApi }) => {
    const suffix = `${data.run}-${uid()}`;
    const person = `Remy Late ${suffix}`;
    const membershipId = await invitePerson(adminApi, `remy+${suffix}@e2e.test`, person);
    const o = adminApi.orgApi;
    const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    await ok(await adminApi.api.post(o('/rates'), { data: { kind: 'PAY', scope: 'WORKER', scope_id: membershipId, amount_minor: 3000, currency: 'USD', effective_from: '2020-01-01' } }), 'pay rate');
    const project = await ok<{ id: string }>(await adminApi.api.post(o('/projects'), { data: { name: `Late work ${suffix}`, member_ids: [membershipId] } }), 'project');
    const group = await ok<{ id: string }>(await adminApi.api.post(o('/payroll/profiles'), { data: { name: `Remy's group ${suffix}`, period: { type: 'weekly' }, currency: 'USD', member_ids: [membershipId] } }), 'pay group');

    // The payroll for two weeks ago is finalized before Remy's time that week is approved.
    const earlier = await ok<{ id: string }>(await adminApi.api.post(o('/payroll/runs'), { data: { profile_id: group.id, date: day(-14) } }), 'earlier payroll');
    await ok(await adminApi.api.post(o(`/payroll/runs/${earlier.id}/finalize`), { data: {} }), 'finalize earlier');
    const start = new Date(`${day(-14)}T10:00:00Z`);
    await ok(await adminApi.api.post(o('/manual-time'), { data: { membership_id: membershipId, project_id: project.id, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 2 * 3600_000).toISOString(), reason: 'late timesheet' } }), 'manual time');
    const ts = await ok<{ id: string }>(await adminApi.api.post(o('/timesheets/submit'), { data: { membership_id: membershipId, date: day(-14) } }), 'submit');
    await ok(await adminApi.api.post(o(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve');

    // Last week's payroll pays those 2 hours, and says where they come from.
    const next = await ok<{ id: string }>(await adminApi.api.post(o('/payroll/runs'), { data: { profile_id: group.id, date: day(-7) } }), 'next payroll');
    await page.goto(`/o/${data.orgId}/finance/payroll/${next.id}`);
    const line = page.getByRole('row', { name: new RegExp(person) });
    await expect(line).toContainText('from earlier periods');
    await expect(line).toContainText(usd(6000));
  });

  // Audit 28 Oct 2026 (F9): paid time off for someone with no worker or organization pay rate was paid
  // nothing, with no sign of it. The line now says so before anyone pays.
  test('a pay stub line with time off but no pay rate says "No pay rate for time off"', async ({ page, data, adminApi }) => {
    const suffix = `${data.run}-${uid()}`;
    const person = `Nora Norate ${suffix}`;
    const email = `nora+${suffix}@e2e.test`;
    const membershipId = await invitePerson(adminApi, email, person);
    const o = adminApi.orgApi;
    const policy = await ok<{ id: string }>(
      await adminApi.api.post(o('/time-off/policies'), { data: { name: `Leave ${suffix}`, requires_approval: false, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [membershipId] } }),
      'policy',
    );
    // Nora takes a day off in a month no other spec pays.
    const nora = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL }, storageState: { cookies: [], origins: [] } });
    await ok(await nora.post('/api/v1/auth/login', { data: { email, password: PASSWORD } }), 'sign in');
    await ok(await nora.post(`/api/v1/orgs/${data.orgId}/time-off/requests`, { data: { policy_id: policy.id, start_date: '2024-04-10', end_date: '2024-04-10' } }), 'time off');
    await nora.dispose();
    const group = await ok<{ id: string }>(await adminApi.api.post(o('/payroll/profiles'), { data: { name: `Nora's group ${suffix}`, period: { type: 'monthly' }, currency: 'USD', member_ids: [membershipId] } }), 'pay group');
    const run = await ok<{ id: string }>(await adminApi.api.post(o('/payroll/runs'), { data: { profile_id: group.id, date: '2024-04-10' } }), 'payroll');

    await page.goto(`/o/${data.orgId}/finance/payroll/${run.id}`);
    const line = page.getByRole('row', { name: new RegExp(person) });
    await expect(line).toContainText('8 h');
    await expect(line).toContainText('No pay rate for time off');
  });
});

test.describe('Payroll (no money access)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without payroll access sees neither the menu item nor the pages', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Payroll' })).toHaveCount(0);

    await page.goto(`/o/${data.orgId}/finance/payroll`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run payroll' })).toHaveCount(0);
  });
});

/** Invite someone as a Worker and accept the invitation, as a new member would. Returns their membership id. */
async function invitePerson(adminApi: { api: import('@playwright/test').APIRequestContext; orgApi: (p: string) => string }, email: string, name: string): Promise<string> {
  const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
  const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email, name, role_id: roles.find((r) => r.key === 'WORKER')!.id } }), 'invite');
  // Signed out: inside a test, a new request context would otherwise reuse the file's admin session.
  const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL }, storageState: { cookies: [], origins: [] } });
  const accepted = await ok<{ membership_id: string }>(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(invite.invite_url).searchParams.get('token'), name, password: PASSWORD } }), 'accept');
  await ctx.dispose();
  return accepted.membership_id;
}

/** Pick a pay group in the "Run payroll" dialog by its name (the option also shows period, currency and size). */
async function selectGroup(dialog: import('@playwright/test').Locator, name: string): Promise<void> {
  const value = await dialog.getByLabel('Pay group').locator('option', { hasText: name }).getAttribute('value');
  await dialog.getByLabel('Pay group').selectOption(value!);
}
