import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';
import { inviteeAddress } from '../../support/invitee';

/**
 * Finance figures as an owner sees them (QA audit 16 Nov 2026), for a worker of their own:
 * 4 h 14 m last Monday at a $33 pay rate and a $175 bill rate, plus an 8-hour paid vacation day.
 * - BUG-29: the invoice showed “4.23 h × $175.00 = $740.83”; the hours are now shown as priced (4.2333 h).
 * - BUG-30: Reports › Payroll export listed the 8 vacation hours but no money, so it came to less than
 *   the payroll. It now shows the time off pay ($264.00) and the total to pay ($139.70 + $264.00 = $403.70).
 */
test.use({ storageState: ADMIN_STATE });

let worker: { name: string; id: string };
let client: string;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

test.beforeAll(async ({ adminApi }) => {
  const { api, orgApi } = adminApi;
  const run = uid();
  const org = await ok<{ timezone: string }>(await api.get(orgApi('')), 'org');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // Monday of last week (weeks start on Monday in the test organization).
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow - 7);

  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  client = `Figures Client ${run}`;
  const c = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: client, currency: 'USD' } }), 'client');
  const p = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `Figures Project ${run}`, client_id: c.id, billable_default: true } }), 'project');
  worker = { name: `Fran Figures ${run}`, id: '' };
  const email = `fran+${run}@e2e.test`;
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email, name: worker.name, role_id: roles.find((r) => r.key === 'WORKER')!.id, project_ids: [p.id] } }), 'invite');
  // Signed out: this file's admin session must not come along, or the invitation is “sent to someone else”.
  const anon = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL, ...inviteeAddress() }, storageState: { cookies: [], origins: [] } });
  worker.id = (await ok<{ membership_id: string }>(await anon.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name: worker.name, password: PASSWORD } }), 'accept')).membership_id;

  await ok(await api.post(orgApi('/rates'), { data: { kind: 'PAY', scope: 'WORKER', scope_id: worker.id, amount_minor: 3300, currency: 'USD', effective_from: '2026-01-01' } }), 'pay rate');
  await ok(await api.post(orgApi('/rates'), { data: { kind: 'BILL', scope: 'PROJECT_WORKER', scope_id: `${p.id}:${worker.id}`, amount_minor: 17500, currency: 'USD', effective_from: '2026-01-01' } }), 'bill rate');
  // 4 h 14 m = 15240 s = 4.2333 h: pay 15240 × $33 / 3600 = $139.70; bill $740.83.
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: worker.id, project_id: p.id, local_date: monday, duration_seconds: 15240, reason: 'figures fixture' } }), 'time');
  for (const r of await ok<Array<{ id: string; membership_id: string }>>(await api.get(orgApi('/manual-time?status=PENDING')), 'pending')) {
    if (r.membership_id === worker.id) await api.post(orgApi(`/manual-time/${r.id}/approve`), { data: {} });
  }

  // An 8-hour paid vacation day on Tuesday, asked for by the worker and approved.
  const policy = await ok<{ id: string }>(await api.post(orgApi('/time-off/policies'), { data: { name: `Figures leave ${run}`, paid: true, hours_per_day: 8, applies_to_all: false, member_ids: [worker.id], accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } } }), 'policy');
  await ok(await api.post(orgApi('/time-off/balances/adjust'), { data: { policy_id: policy.id, membership_id: worker.id, hours: 40 } }), 'balance');
  await ok(await anon.post('/api/v1/auth/login', { data: { email, password: PASSWORD } }), 'worker login');
  const tor = await ok<{ id: string }>(await anon.post(orgApi('/time-off/requests'), { data: { policy_id: policy.id, start_date: addDays(monday, 1), end_date: addDays(monday, 1) } }), 'time off');
  await anon.dispose();
  await ok(await api.post(orgApi(`/time-off/requests/${tor.id}/approve`), { data: {} }), 'approve time off');

  const ts = await ok<{ id: string }>(await api.post(orgApi('/timesheets/submit'), { data: { membership_id: worker.id, date: monday } }), 'submit');
  await ok(await api.post(orgApi(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve');
});

test('Payroll export prices paid time off and adds up to what payroll pays (BUG-30)', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/reports/payroll`);
  await expect(page.getByRole('heading', { level: 1, name: 'Payroll export' })).toBeVisible();
  await page.locator('main select:has(option[value="last_week"])').first().selectOption('last_week');
  await expect(page.getByRole('columnheader', { name: 'Time off pay' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total to pay' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: worker.name });
  await expect(row).toContainText('$139.70');
  await expect(row).toContainText('$264.00');
  await expect(row).toContainText('$403.70');
});

test('the invoice shows hours as priced, so hours × rate gives the amount (BUG-29)', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/finance/invoices/new`);
  const main = page.locator('main');
  const select = main.getByLabel('Client', { exact: true });
  // The client list loads after the page: wait for this client before choosing it.
  await expect(select.locator('option', { hasText: client })).toHaveCount(1);
  const option = (await select.locator('option').allTextContents()).find((x) => x.startsWith(client))!;
  await select.selectOption({ label: option });
  await expect(main.getByLabel('Period start', { exact: true })).not.toHaveValue('');
  await main.getByRole('button', { name: 'Preview lines' }).click();
  const line = main.getByRole('row').filter({ hasText: '$175.00' });
  await expect(line).toContainText('4.2333 h');
  await expect(line).toContainText('$740.83');
  await expect(line).not.toContainText('4.23 h');
});
