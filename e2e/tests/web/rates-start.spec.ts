import { request, type APIRequestContext, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, WEB_URL } from '../../support/env';

/**
 * QA audit, 11 Nov 2026 (BUG-08). Rates typed into the project form started "today", so time already
 * worked was paid and billed $0, with nothing to say why. Now the form has a "Rates start" date (a new
 * project defaults to its start date), Summary and the timesheet panel warn about time with no rate,
 * and setting a rate that covers approved time prices it. No invitations: accepting one is rate-limited
 * to 20 a clock hour across the whole run, as in production, and the suite already uses them. The
 * pricing journeys use Nina Newcomer and the paid-at-$0 one Mona Lead (Nina must stay in no finalized
 * payroll), each in its own February 2026 week, which no other spec touches.
 */
test.use({ storageState: ADMIN_STATE });

type AdminApi = { api: APIRequestContext; orgApi: (p: string) => string };

/** One hour on `day` for the person, submitted and approved through the API. */
async function approvedHour(adminApi: AdminApi, membershipId: string, projectId: string, day: string) {
  await ok(await adminApi.api.post(adminApi.orgApi('/manual-time'), { data: { membership_id: membershipId, project_id: projectId, local_date: day, duration_seconds: 3600, reason: 'E2E: rates start' } }), 'manual time');
  const ts = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/timesheets/submit'), { data: { membership_id: membershipId, date: day } }), 'submit');
  await ok(await adminApi.api.post(adminApi.orgApi(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve');
}

async function openWeek(page: Page, orgId: string, membershipId: string, day: string) {
  await page.goto(`/o/${orgId}/timesheets/team?member=${membershipId}&date=${day}`);
  await expect(page.getByText('Est. pay').first()).toBeVisible();
}

async function editProject(page: Page, orgId: string, name: string) {
  await page.goto(`/o/${orgId}/projects`);
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  return page.getByRole('dialog', { name: 'Edit project' });
}

let person = '';

test.describe('Seeded people, a February 2026 week per journey', () => {
  test.beforeAll(({ data }) => {
    person = data.newcomer.membershipId;
  });

  test('a project created with an earlier start date pays and bills the time already worked', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const day = '2026-02-04';
    const name = `Started early ${uid()}`;

    await test.step('create the project in the form with a February start date and rates', async () => {
      await page.goto(`/o/${data.orgId}/projects`);
      await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
      await page.getByRole('button', { name: 'New project' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New project' });
      await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
      await dialog.getByLabel('Start date').fill('2026-02-01');
      await dialog.getByLabel('Pay rate per hour').fill('25');
      await dialog.getByLabel('Bill rate per hour').fill('100');
      // Empty means: from the project's start date (it is earlier than today).
      await expect(dialog.getByText('Empty: the project’s start date if it is earlier, otherwise today.')).toBeVisible();
      await expect(dialog.getByText(/Rates set here start on the “Rates start” date/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Create project' }).click();
      await expect(page.getByText('Project created')).toBeVisible();
    });

    const project = (await ok<Array<{ id: string; name: string }>>(await adminApi.api.get(adminApi.orgApi('/projects')), 'projects')).find((p) => p.name === name)!;
    await ok(await adminApi.api.patch(adminApi.orgApi(`/projects/${project.id}`), { data: { member_ids: [person] } }), 'assign');
    await approvedHour(adminApi, person, project.id, day);

    await test.step('the approved week is priced, with no warning', async () => {
      await openWeek(page, data.orgId, person, day);
      await expect(page.getByText('$25.00').first()).toBeVisible();
      await expect(page.getByText('$100.00').first()).toBeVisible();
      await expect(page.getByText(/has no pay rate/)).toHaveCount(0);
    });
  });

  test('approved time with no rate is flagged, and a dated rate prices it', async ({ page, data, adminApi }) => {
    const day = '2026-02-11';
    const name = `No rate yet ${uid()}`;
    const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name, member_ids: [person], billable_default: true } }), 'project');
    await approvedHour(adminApi, person, project.id, day);

    await test.step('the week says the hour has no pay or bill rate and counts as $0', async () => {
      await openWeek(page, data.orgId, person, day);
      const warning = page.getByRole('status').filter({ hasText: 'has no pay rate' });
      await expect(warning).toContainText('1h 00m has no pay rate and 1h 00m of billable time has no bill rate');
      await expect(warning.getByRole('link', { name: 'Set rates →' })).toHaveAttribute('href', `/o/${data.orgId}/finance/billing`);
    });

    await test.step('saving rates from 1 February first says what they would price; Cancel saves nothing', async () => {
      const dialog = await editProject(page, data.orgId, name);
      await expect(dialog.getByText('Empty: today.')).toBeVisible();
      await dialog.getByLabel('Pay rate per hour').fill('30');
      await dialog.getByLabel('Bill rate per hour').fill('120');
      await dialog.getByLabel('Rates start').fill('2026-02-01');
      await dialog.getByRole('button', { name: 'Save project' }).click();
      const ask = page.getByRole('dialog', { name: 'Price approved time?' });
      await expect(ask).toContainText('1h 00m of pay ($30.00) and 1h 00m of billable time ($120.00)');
      await ask.getByRole('button', { name: 'Cancel' }).click();
      await expect(ask).toHaveCount(0);
      await expect(dialog).toBeVisible(); // still editing, nothing saved
      const rates = await ok<Array<{ scope_id: string }>>(await adminApi.api.get(adminApi.orgApi('/rates')), 'rates');
      expect(rates.filter((r) => r.scope_id === project.id)).toHaveLength(0);
    });

    await test.step('saving again and agreeing prices the hour', async () => {
      await page.getByRole('dialog', { name: 'Edit project' }).getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('dialog', { name: 'Price approved time?' }).getByRole('button', { name: 'Save and price' }).click();
      await expect(page.getByText('Project updated')).toBeVisible();
    });

    await test.step('the approved hour is now paid and billed, and the warning is gone', async () => {
      await openWeek(page, data.orgId, person, day);
      await expect(page.getByText('$30.00').first()).toBeVisible();
      await expect(page.getByText('$120.00').first()).toBeVisible();
      await expect(page.getByText(/has no pay rate/)).toHaveCount(0);
    });

    await test.step('the rates start on the chosen day', async () => {
      const rates = await ok<Array<{ scope_id: string; effective_from: string; effective_to: string | null }>>(await adminApi.api.get(adminApi.orgApi('/rates')), 'rates');
      expect(rates.filter((r) => r.scope_id === project.id && r.effective_to === null).map((r) => r.effective_from)).toEqual(['2026-02-01', '2026-02-01']);
    });
  });

  test('a date alone moves an unchanged rate earlier', async ({ page, data, adminApi }) => {
    const name = `Backdate ${uid()}`;
    const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name, bill_rate_minor: 9000 } }), 'project');
    const dialog = await editProject(page, data.orgId, name);
    await dialog.getByLabel('Rates start').fill('2026-02-01');
    await dialog.getByRole('button', { name: 'Save project' }).click();
    await expect(page.getByText('Project updated')).toBeVisible();
    const rates = await ok<Array<{ scope_id: string; amount_minor: number; effective_from: string; effective_to: string | null }>>(await adminApi.api.get(adminApi.orgApi('/rates')), 'rates');
    expect(rates.filter((r) => r.scope_id === project.id && r.effective_to === null).map((r) => [r.amount_minor, r.effective_from])).toEqual([[9000, '2026-02-01']]);
  });

  test('time a finalized payroll already paid at $0 says to add a bonus instead', async ({ page, data, adminApi }) => {
    const person = data.manager.membershipId; // Mona: in no pay group, and no spec checks her pay stubs
    const day = '2026-02-18';
    const name = `Paid at zero ${uid()}`;
    const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name, member_ids: [person], billable_default: false } }), 'project');
    await approvedHour(adminApi, person, project.id, day);
    const group = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/payroll/profiles'), { data: { name: `Zero group ${uid()}`, period: { type: 'weekly' }, currency: 'USD', member_ids: [person] } }), 'pay group');
    const run = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/payroll/runs'), { data: { profile_id: group.id, date: day } }), 'payroll');
    await ok(await adminApi.api.post(adminApi.orgApi(`/payroll/runs/${run.id}/finalize`), { data: {} }), 'finalize');

    await openWeek(page, data.orgId, person, day);
    const warning = page.getByRole('status').filter({ hasText: 'finalized payroll' });
    await expect(warning).toContainText('1h 00m with no pay rate was already paid at 0 by a finalized payroll. A rate no longer changes it: add a bonus on the next payroll.');
    await expect(warning.getByRole('link', { name: 'Open Payroll →' })).toHaveAttribute('href', `/o/${data.orgId}/finance/payroll`);
    // Nothing to fix with a rate, so it does not say so.
    await expect(page.getByText(/has no pay rate/)).toHaveCount(0);
  });
});

test.describe('Who must not see it', () => {
  test.use({ storageState: MANAGER_STATE });

  test('a Team Manager sees no money, so no unpriced-time warning and no rate fields', async ({ page, data }) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const summary = await ok<{ money_visible: boolean; totals: { unpriced_pay_seconds: number | null; unpriced_bill_seconds: number | null } }>(await api.get(`/api/v1/orgs/${data.orgId}/insights?from=2026-01-01&to=2026-12-31`), 'insights');
    await api.dispose();
    expect(summary.money_visible).toBe(false);
    expect(summary.totals).toMatchObject({ unpriced_pay_seconds: null, unpriced_bill_seconds: null });

    await page.goto(`/o/${data.orgId}/insights`);
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible();
    await expect(page.getByText('Time logged').first()).toBeVisible();
    await expect(page.getByText(/has no pay rate|has no bill rate/)).toHaveCount(0);
    await expect(page.getByLabel('Rates start')).toHaveCount(0);
  });
});
