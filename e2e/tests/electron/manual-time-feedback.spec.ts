import { request } from '@playwright/test';
import { closeApp, expect, launch, signIn, test, type DesktopApp } from '../../support/electron';
import { ok, uid } from '../../support/fixtures';
import { PASSWORD, WEB_URL } from '../../support/env';

/**
 * QA round 6 (BUG-23): in the real desktop app, asking for manual time showed "Request sent." as soon as
 * it was saved on the computer, even when the server then refused it; the refusal told the worker to
 * reopen the timesheet, which only a manager can do. Now the form says "Sending…" until the server
 * answers, and shows the refusal there, with who to ask. A worker of their own: their last week is
 * approved, so time asked for in it is refused.
 */
let worker: { email: string; membershipId: string };
let lastWeek: string;
let current: DesktopApp | null = null;

test.beforeAll(async ({ adminApi }) => {
  const { api, orgApi } = adminApi;
  const run = uid();
  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `Manual feedback ${run}` } }), 'project');
  const email = `mara+${run}@e2e.test`;
  const name = `Mara Manual ${run}`;
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email, name, role_id: roles.find((r) => r.key === 'WORKER')!.id, project_ids: [project.id] } }), 'invite');
  const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const accepted = await ok<{ membership_id: string }>(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name, password: PASSWORD } }), 'accept');
  await ctx.dispose();
  worker = { email, membershipId: accepted.membership_id };
  // A day last week, on this computer's calendar (the form's dates are local); its week is approved.
  const d = new Date(Date.now() - 7 * 86_400_000);
  lastWeek = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: worker.membershipId, project_id: project.id, local_date: lastWeek, duration_seconds: 3600, reason: 'BUG-23 regression' } }), 'manual time');
  const ts = await ok<{ id: string }>(await api.post(orgApi('/timesheets/submit'), { data: { membership_id: worker.membershipId, date: lastWeek } }), 'submit');
  await ok(await api.post(orgApi(`/timesheets/${ts.id}/approve`), { data: {} }), 'approve');
});

test.afterAll(async () => {
  if (current) await closeApp(current.app);
});

test('time asked for in an approved week is refused in the form, with who to ask, never "Request sent."', async () => {
  current = await launch();
  const { window } = current;
  await signIn(window, worker.email);
  await expect(window.getByLabel('Timer')).toBeVisible();
  await window.getByRole('button', { name: 'Manual time' }).click();
  await expect(window.getByRole('heading', { name: 'Add manual time' })).toBeVisible();

  await window.getByLabel('Date').fill(lastWeek);
  await window.getByLabel('From').fill('07:00');
  await window.getByLabel('To').fill('08:00');
  await window.getByLabel(/^Reason/).fill('Forgot the timer');
  await window.getByRole('button', { name: /^(Request time|Add time)$/ }).click();

  const refused = window.getByRole('alert').filter({ hasText: 'Not added:' });
  await expect(refused).toContainText('approved', { timeout: 20_000 });
  await expect(refused).toContainText('ask your manager to reopen it');
  await expect(window.getByText('Request sent', { exact: false })).toHaveCount(0);
});
