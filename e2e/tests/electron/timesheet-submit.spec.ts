import { request } from '@playwright/test';
import { closeApp, expect, launch, openPage, signIn, test, type DesktopApp } from '../../support/electron';
import { ok, uid } from '../../support/fixtures';
import { PASSWORD, WEB_URL } from '../../support/env';
import { inviteeAddress } from '../../support/invitee';

/**
 * QA audit 14 Nov 2026 (BUG-25): in the real desktop app, Timesheet › Submit failed with
 * “Invalid payload for me:submitTimesheet” for any week that had never been saved, because that week
 * is version 0 and both the IPC check and the API refused 0. Workers cannot submit on the website, so
 * nobody could submit a new week. A worker of their own, so no other spec's timesheet is touched.
 */
let worker: { email: string; membershipId: string };
let current: DesktopApp | null = null;

test.beforeAll(async ({ adminApi }) => {
  const { api, orgApi } = adminApi;
  const run = uid();
  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `Submit project ${run}` } }), 'project');
  const email = `sam+${run}@e2e.test`;
  const name = `Sam Submit ${run}`;
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email, name, role_id: roles.find((r) => r.key === 'WORKER')!.id, project_ids: [project.id] } }), 'invite');
  const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL, ...inviteeAddress() } });
  const accepted = await ok<{ membership_id: string }>(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name, password: PASSWORD } }), 'accept');
  await ctx.dispose();
  worker = { email, membershipId: accepted.membership_id };
  // One hour today, in the organization's time zone, added by the admin: the week now has time but no saved timesheet.
  // The time zone is under `organization` (reading `org.timezone` gave undefined, so Intl used this
  // computer's zone: ahead of UTC, "today" was tomorrow for the server from 16:00 UTC, and the test failed).
  const org = await ok<{ organization: { timezone: string } }>(await api.get(orgApi('')), 'org');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: org.organization.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: worker.membershipId, project_id: project.id, local_date: today, duration_seconds: 3600, reason: 'BUG-25 regression' } }), 'manual time');
});

test.afterAll(async () => {
  if (current) await closeApp(current.app);
});

test('a worker submits a brand-new week from the desktop app', { tag: '@smoke' }, async ({ adminApi }) => {
  const { api, orgApi } = adminApi;
  const before = await ok<{ status: string; version: number }>(await api.get(orgApi(`/timesheets?membership_id=${worker.membershipId}`)), 'timesheet before');
  expect(before.status).toBe('DRAFT');
  expect(before.version).toBe(0);

  current = await launch();
  const { window } = current;
  await signIn(window, worker.email);
  await expect(window.getByLabel('Timer')).toBeVisible();
  await openPage(window, 'Timesheet');
  const main = window.locator('main');
  await expect(main.getByText('1h 00m').first()).toBeVisible();
  await main.getByRole('button', { name: 'Submit', exact: true }).click();
  const confirm = window.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /^Submit/ }).last().click();

  await expect(main.getByText(/Timesheet submitted/)).toBeVisible();
  await expect(main.getByText(/Invalid payload/)).toHaveCount(0);
  await expect.poll(async () => (await ok<{ status: string }>(await api.get(orgApi(`/timesheets?membership_id=${worker.membershipId}`)), 'timesheet after')).status).toBe('SUBMITTED');
});
