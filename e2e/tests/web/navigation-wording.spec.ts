import type { APIRequestContext } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';

/**
 * QA audit, 11 Nov 2026, Phase 6: navigation and wording.
 * - BUG-06: a signed-in person opening /login goes where they were heading, or to their workspace.
 * - BUG-07: an organization that does not exist (or is not theirs) shows the normal "Page not found".
 * - BUG-11: the team panel says "1 manager", not "1 managers".
 * - BUG-12: a timesheet submitted by someone else names who submitted it.
 * - BUG-13: a second invoice for an invoiced period names the invoice that holds the time.
 * - C-10: a new invoice starts on the month of the client's approved time not yet invoiced.
 * - C-8: re-inviting an address with a pending invitation says the earlier link will stop working.
 * No invitation is accepted (accepting is rate-limited across the whole run). Approved time is Mona
 * Lead's, in April 2026 weeks no other spec uses. Not Nina Newcomer: she must stay out of payroll.
 */
test.use({ storageState: ADMIN_STATE });

type AdminApi = { api: APIRequestContext; orgApi: (p: string) => string };
const NO_ORG = '00000000-0000-4000-8000-000000000000';

/** One billable hour on `day` for the person, submitted and approved through the API. */
async function approvedHour(adminApi: AdminApi, membershipId: string, projectId: string, day: string) {
  await ok(await adminApi.api.post(adminApi.orgApi('/manual-time'), { data: { membership_id: membershipId, project_id: projectId, local_date: day, duration_seconds: 3600, reason: 'E2E: navigation and wording' } }), 'manual time');
  const ts = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/timesheets/submit'), { data: { membership_id: membershipId, date: day } }), 'submit');
  await ok(await adminApi.api.post(adminApi.orgApi(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve');
}

/** A client with one billable project ($100/h) that the person is on. */
async function billableClient(adminApi: AdminApi, membershipId: string) {
  const name = `Wording Co ${uid()}`;
  const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
  const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Wording ${uid()}`, client_id: client.id, member_ids: [membershipId], billable_default: true } }), 'project');
  await ok(await adminApi.api.post(adminApi.orgApi('/rates'), { data: { kind: 'BILL', scope: 'PROJECT', scope_id: project.id, amount_minor: 10000, currency: 'USD', effective_from: '2026-01-01' } }), 'rate');
  return { id: client.id, name, projectId: project.id };
}

test.describe('signing in when already signed in (BUG-06)', () => {
  test('opening the sign-in page goes to the workspace instead of showing the form', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toHaveCount(0);
  });

  test('a sign-in link with a destination goes there', async ({ page, data }) => {
    await page.goto(`/login?next=${encodeURIComponent(`/o/${data.orgId}/teams`)}`);
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/teams$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
  });

  test('a destination on another site is ignored', async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent('/\\evil.example/phish')}`);
    await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}/);
  });

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('the form is shown and stays', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
      await expect(page.getByLabel('Work email')).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});

test.describe('an unknown organization (BUG-07)', () => {
  test('shows the normal Page not found, with a way back and no pointless retry', async ({ page }) => {
    await page.goto(`/o/${NO_ORG}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveTitle(/Page not found/);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Go to your workspace' }).click();
    await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}/);
    await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
  });

  test.describe('as a team manager', () => {
    test.use({ storageState: MANAGER_STATE });

    test('a page inside it is not found either', async ({ page }) => {
      await page.goto(`/o/${NO_ORG}/timesheets`);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    });
  });
});

test('the team panel counts one manager in the singular (BUG-11)', async ({ page, data, adminApi }) => {
  const name = `Solo team ${uid()}`;
  const team = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/teams'), { data: { name } }), 'team');
  await ok(await adminApi.api.put(adminApi.orgApi(`/teams/${team.id}/members/${data.manager.membershipId}`), { data: { role: 'MANAGER' } }), 'manager');
  await page.goto(`/o/${data.orgId}/teams`);
  await page.getByRole('row', { name: new RegExp(name) }).click();
  const panel = page.getByRole('dialog', { name });
  await expect(panel.getByText('1 member · 1 manager', { exact: true })).toBeVisible();
  await expect(panel.getByText(/1 managers|1 members/)).toHaveCount(0);
});

test('a timesheet submitted for someone names who submitted it (BUG-12)', async ({ data, adminApi }) => {
  const client = await billableClient(adminApi, data.manager.membershipId);
  await approvedHour(adminApi, data.manager.membershipId, client.projectId, '2026-04-01');
  // The admin submitted it (approvedHour), so the notification names the admin, and Mona as the
  // person whose timesheet it is. Before, it said "Mona Lead submitted a timesheet".
  const titles = async () => (await ok<{ data: Array<{ title: string }> }>(await adminApi.api.get(adminApi.orgApi('/notifications')), 'notifications')).data.map((n) => n.title);
  await expect.poll(titles).toContain(`${data.admin.name} submitted ${data.manager.name}'s timesheet`);
});

test.describe('a new invoice (BUG-13, C-10)', () => {
  test('starts on the month of the approved time, and a second invoice names the one that holds it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const client = await billableClient(adminApi, data.manager.membershipId);
    await approvedHour(adminApi, data.manager.membershipId, client.projectId, '2026-04-15');

    await test.step('the period starts on April, where the approved time is', async () => {
      await page.goto(`/o/${data.orgId}/finance/invoices/new?client=${client.id}`);
      await expect(page.getByLabel('Period start')).toHaveValue('2026-04-01');
      await expect(page.getByLabel('Period end')).toHaveValue('2026-04-30');
      await page.getByRole('button', { name: 'Preview lines' }).click();
      await expect(page.getByRole('cell', { name: /Wording/ }).first()).toBeVisible();
      await expect(page.getByText('Nothing to invoice in this period')).toHaveCount(0);
    });

    const invoice = await ok<{ id: string; number: string }>(
      await adminApi.api.post(adminApi.orgApi('/invoices'), { data: { client_id: client.id, period_start: '2026-04-01', period_end: '2026-04-30', issue_date: '2026-04-30', due_date: '2026-05-30', tax_rate_bps: 0 } }),
      'invoice',
    );

    await test.step('with everything invoiced, a second invoice for April says which invoice holds the time', async () => {
      await page.goto(`/o/${data.orgId}/finance/invoices/new?client=${client.id}`);
      await page.getByLabel('Period start').fill('2026-04-01');
      await page.getByLabel('Period end').fill('2026-04-30');
      await page.getByRole('button', { name: 'Preview lines' }).click();
      await expect(page.getByText('Nothing to invoice in this period')).toBeVisible();
      await expect(page.getByText(`The approved time in this period is already on ${invoice.number}.`)).toBeVisible();
      // The regression: it said to approve timesheets first.
      await expect(page.getByText(/Approve timesheets first/)).toHaveCount(0);
      // Leaving a started invoice asks first (unsaved-changes guard); going is the choice here.
      const asked: string[] = [];
      page.once('dialog', (d) => (asked.push(d.type()), void d.accept()));
      await page.getByRole('link', { name: `Open ${invoice.number}` }).click();
      await expect(page).toHaveURL(new RegExp(`/finance/invoices/${invoice.id}$`));
      expect(asked).toHaveLength(1);
    });
  });

  test('approved time outside the chosen period is pointed out, and one click covers it', async ({ page, data, adminApi }) => {
    const client = await billableClient(adminApi, data.manager.membershipId);
    await approvedHour(adminApi, data.manager.membershipId, client.projectId, '2026-04-22');
    await approvedHour(adminApi, data.manager.membershipId, client.projectId, '2026-04-29');
    await page.goto(`/o/${data.orgId}/finance/invoices/new?client=${client.id}`);
    await expect(page.getByLabel('Period start')).toHaveValue('2026-04-01');
    await page.getByLabel('Period start').fill('2026-04-26');
    const hint = page.getByRole('status').filter({ hasText: 'has approved time not yet invoiced' });
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Use this period' }).click();
    await expect(page.getByLabel('Period start')).toHaveValue('2026-04-22');
    await expect(page.getByLabel('Period end')).toHaveValue('2026-04-29');
    await expect(hint).toHaveCount(0);
  });

  test.describe('as a team manager', () => {
    test.use({ storageState: MANAGER_STATE });

    test('cannot read a client’s unbilled time', async ({ page, data }) => {
      await page.goto(`/o/${data.orgId}`);
      const clients = await page.request.get(`/api/v1/orgs/${data.orgId}/clients`);
      const id = clients.ok() ? ((await clients.json()) as Array<{ id: string }>)[0]?.id : undefined;
      const r = await page.request.get(`/api/v1/orgs/${data.orgId}/invoices/unbilled?client_id=${id ?? NO_ORG}`);
      expect(r.status()).toBe(403);
    });
  });
});

test.describe('re-inviting a pending address (C-8)', () => {
  test('the form warns first, and the result says the earlier link no longer works', async ({ page, data, adminApi }) => {
    const email = `p6-${uid()}@e2e.test`;
    const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const first = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email, role_id: roles.find((r) => r.key === 'WORKER')!.id } }), 'invite');

    await page.goto(`/o/${data.orgId}/workers`);
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite member' });
    const field = dialog.getByLabel('Email');
    await field.fill(`p6-other-${uid()}@e2e.test`);
    await expect(dialog.getByText(/An invitation to this address is pending/)).toHaveCount(0);
    await field.fill(email.toUpperCase());
    await expect(field).toHaveAccessibleDescription(/An invitation to this address is pending .*Sending a new one replaces it, and the earlier link stops working\./);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();

    const ready = page.getByRole('dialog', { name: 'Invitation ready' });
    await expect(ready.getByText('This replaces the earlier invitation to this address. Its link no longer works.')).toBeVisible();
    // Only one invitation to the address is left pending.
    const pending = await ok<Array<{ id: string; email: string }>>(await adminApi.api.get(adminApi.orgApi('/invitations')), 'invitations');
    expect(pending.filter((i) => i.email === email).map((i) => i.id)).not.toContain(first.id);
    expect(pending.filter((i) => i.email === email)).toHaveLength(1);
    for (const i of pending.filter((p) => p.email === email)) await adminApi.api.delete(adminApi.orgApi(`/invitations/${i.id}`));
  });

  test('a first invitation to an address says nothing about replacing', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/workers`);
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite member' });
    await dialog.getByLabel('Email').fill(`p6-new-${uid()}@e2e.test`);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const ready = page.getByRole('dialog', { name: 'Invitation ready' });
    await expect(ready).toBeVisible();
    await expect(ready.getByText(/replaces the earlier invitation/)).toHaveCount(0);
  });
});
