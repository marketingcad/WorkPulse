import { rmSync } from 'node:fs';
import { request, type Page } from '@playwright/test';
import { closeApp, expect, launch, signIn, test, type DesktopApp } from '../../support/electron';
import { ok, uid } from '../../support/fixtures';
import { PASSWORD, WEB_URL } from '../../support/env';
import { startProxy, type Proxy } from '../../support/proxy';

/**
 * The REAL desktop app with poor connectivity (UX remediation, phase 2). Between the app and the
 * test server sits a proxy that can go offline, come back, or cut a sync off before its answer.
 * One worker of its own, so the time it tracks never meets another spec's data.
 */
test.describe.configure({ mode: 'serial' });

let proxy: Proxy;
let worker: { email: string; membershipId: string; projectId: string; projectName: string };
let userData: string | null = null;
let current: DesktopApp | null = null;

test.beforeAll(async ({ data, adminApi }) => {
  proxy = await startProxy();
  const { api, orgApi } = adminApi;
  const run = uid();
  const projectName = `Offline project ${run}`;
  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: projectName } }), 'project');
  const email = `olive+${run}@e2e.test`;
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email, name: `Olive Offline ${run}`, role_id: roles.find((r) => r.key === 'WORKER')!.id, project_ids: [project.id] } }), 'invite');
  const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const accepted = await ok<{ membership_id: string }>(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name: `Olive Offline ${run}`, password: PASSWORD } }), 'accept');
  await ctx.dispose();
  worker = { email, membershipId: accepted.membership_id, projectId: project.id, projectName };
  void data;
});

test.afterAll(async () => {
  if (current) await closeApp(current.app);
  await proxy?.close();
  if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Start (or restart) the same installation, talking to the server through the proxy. */
async function open(): Promise<Page> {
  if (current) await closeApp(current.app);
  current = await launch({ server: proxy.url, userData: userData ?? undefined });
  userData = current.userData;
  return current.window;
}

const today = () => new Date().toISOString().slice(0, 10);
async function serverSessions(adminApi: { api: import('@playwright/test').APIRequestContext; orgApi: (p: string) => string }) {
  const all = await ok<Array<{ id: string; membership_id: string; state: string }>>(await adminApi.api.get(adminApi.orgApi(`/sessions?from=${today()}&to=${today()}`)), 'sessions');
  return all.filter((s) => s.membership_id === worker.membershipId);
}

async function clockInAndOut(window: Page, report: string) {
  const timer = window.getByLabel('Timer');
  await timer.getByLabel('Project').selectOption({ label: worker.projectName });
  await timer.getByRole('button', { name: `Clock in to ${worker.projectName}` }).click();
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();
  // Let the session record a few seconds before clocking out.
  await expect(timer.getByText(/^00:00:0[2-9]$/)).toBeVisible({ timeout: 15_000 });
  await timer.getByRole('button', { name: 'Clock out' }).click();
  const dialog = window.getByRole('dialog', { name: 'Clock out' });
  await dialog.getByLabel('End-of-day report').fill(report);
  await dialog.getByRole('button', { name: 'Submit and clock out' }).click();
  await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible();
}

test('restarted offline, it tracks from the saved settings, says so, and syncs once back', { tag: '@smoke' }, async ({ adminApi }) => {
  test.setTimeout(180_000);
  let window = await open();
  await signIn(window, worker.email);
  await expect(window.getByRole('banner').getByText('Online', { exact: true })).toBeVisible();

  // Offline, then the computer restarts: the account comes from the encrypted saved copy.
  await proxy.down();
  window = await open();
  const banner = window.getByRole('region', { name: 'Offline' });
  await expect(banner).toContainText('You are offline: your time is saved on this computer', { timeout: 30_000 });
  await expect(banner).toContainText('Using your projects and tracking settings saved on');
  await expect(banner).toContainText('You can keep tracking offline until');
  await expect(window.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible();

  await clockInAndOut(window, 'Offline work, sent later.');
  expect(await serverSessions(adminApi)).toHaveLength(0);

  // Back online, but the first sync is cut off after the server stored it: the app sends it again.
  proxy.dropNextAnswer('/api/v1/agent/ingest/batch');
  await proxy.up();
  await expect(window.getByRole('banner').getByText(/Synced (just now|\d+m ago)/)).toBeVisible({ timeout: 60_000 });
  await expect(window.getByRole('region', { name: 'Offline' })).toHaveCount(0);
  expect(proxy.seen.filter((r) => r === 'POST /api/v1/agent/ingest/batch').length).toBeGreaterThanOrEqual(2);
  // Sent twice, added once.
  const sessions = await serverSessions(adminApi);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.state).toBe('STOPPED');
  const reports = await ok<Array<{ membership_id: string }>>(await adminApi.api.get(adminApi.orgApi(`/eod-reports?from=${today()}&to=${today()}`)), 'reports');
  expect(reports.filter((r) => r.membership_id === worker.membershipId)).toHaveLength(1);
});

test('past max offline hours it refuses to clock in, and explains why', async () => {
  test.setTimeout(120_000);
  await proxy.down();
  const window = await open();
  await expect(window.getByRole('region', { name: 'Offline' })).toBeVisible({ timeout: 30_000 });
  // 25 hours later on this computer's clock (the organization allows 24 offline).
  await current!.app.evaluate(() => {
    const real = Date.now.bind(Date);
    (globalThis as unknown as { __realNow: () => number }).__realNow = real;
    Date.now = () => real() + 25 * 3600_000;
  });
  await expect(window.getByRole('region', { name: 'Offline' })).toContainText('Offline for too long: connect to clock in', { timeout: 15_000 });
  const timer = window.getByLabel('Timer');
  await timer.getByLabel('Project').selectOption({ label: worker.projectName });
  await timer.getByRole('button', { name: `Clock in to ${worker.projectName}` }).click();
  await expect(timer).toContainText('You have been offline for more than 24 hours');
  await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible();
  await current!.app.evaluate(() => {
    Date.now = (globalThis as unknown as { __realNow: () => number }).__realNow;
  });
});

test('clocked in when offline tracking runs out: paused at that moment, and not resumed on its own', async () => {
  test.setTimeout(120_000);
  await proxy.down();
  const window = await open();
  await expect(window.getByRole('region', { name: 'Offline' })).toBeVisible({ timeout: 30_000 });
  const timer = window.getByLabel('Timer');
  await timer.getByLabel('Project').selectOption({ label: worker.projectName });
  await timer.getByRole('button', { name: `Clock in to ${worker.projectName}` }).click();
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();
  await current!.app.evaluate(() => {
    const real = Date.now.bind(Date);
    (globalThis as unknown as { __realNow: () => number }).__realNow = real;
    Date.now = () => real() + 25 * 3600_000;
  });
  // The app pauses by itself (checked every few seconds) and says when offline tracking ran out.
  await expect(timer.getByText('Paused', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(window.getByRole('region', { name: 'Offline' })).toContainText('Tracking paused at');
  await expect(window.getByRole('region', { name: 'Offline' })).toContainText('No time is being recorded');
  // It cannot be resumed until the app is back online.
  await timer.getByRole('button', { name: 'Clock back in' }).click();
  await expect(timer).toContainText('You have been offline for more than 24 hours');
  await expect(timer.getByText('Paused', { exact: true })).toBeVisible();
  await current!.app.evaluate(() => {
    Date.now = (globalThis as unknown as { __realNow: () => number }).__realNow;
  });
  // Clocking out still works (the recorded time is kept and sent later).
  await timer.getByRole('button', { name: 'Clock out' }).click();
  await window.getByRole('dialog', { name: 'Clock out' }).getByLabel('End-of-day report').fill('Offline too long.');
  await window.getByRole('dialog', { name: 'Clock out' }).getByRole('button', { name: 'Submit and clock out' }).click();
  await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible();
});

test('time the server refuses after an offline stretch is kept and explained, not lost', async ({ adminApi }) => {
  test.setTimeout(180_000);
  // Sessions this worker already has (earlier tests): the refused one must not add to them.
  const before = (await serverSessions(adminApi)).length;
  await proxy.down();
  const window = await open();
  await expect(window.getByRole('region', { name: 'Offline' })).toBeVisible({ timeout: 30_000 });
  await clockInAndOut(window, 'Worked on it while tracking was turned off.');
  // Meanwhile, the manager turns tracking off for the worker: the one reason offline time is still
  // refused (time whose project changed meanwhile is kept and flagged for review instead).
  await ok(await adminApi.api.patch(adminApi.orgApi(`/workers/${worker.membershipId}`), { data: { tracking_enabled: false } }), 'tracking off');
  try {
    await proxy.up();
    const card = window.getByRole('region', { name: 'Not added to your time' });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Your organization turned off time tracking from the desktop app for you.');
    await expect(card).toContainText('kept here until you deal with them');
    // Nothing was added for it on the server, and the app does not pretend otherwise.
    await expect.poll(async () => (await serverSessions(adminApi)).length).toBe(before);
  } finally {
    await ok(await adminApi.api.patch(adminApi.orgApi(`/workers/${worker.membershipId}`), { data: { tracking_enabled: true } }), 'tracking on');
  }

  // Still there after a restart, until the worker removes it.
  const again = await open();
  await expect(again.getByRole('region', { name: 'Not added to your time' })).toContainText('Your organization turned off time tracking from the desktop app for you.', { timeout: 30_000 });
});

test('a device revoked by an administrator is signed out, and the saved account is removed', async ({ adminApi }) => {
  test.setTimeout(120_000);
  await proxy.up();
  const window = current!.window;
  const devices = await ok<{ data: Array<{ id: string; membership_id: string; status: string }> }>(await adminApi.api.get(adminApi.orgApi('/devices?page=1&page_size=200')), 'devices');
  const device = devices.data.find((d) => d.membership_id === worker.membershipId && d.status !== 'REVOKED')!;
  await ok(await adminApi.api.post(adminApi.orgApi(`/devices/${device.id}/revoke`)), 'revoke');
  // The next request is refused: back to sign-in, with the reason.
  await expect(window.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible({ timeout: 90_000 });
  await expect(window.getByRole('alert')).toContainText('revoked');

  // Offline after that, a restart cannot bring the old account back from the saved copy.
  await proxy.down();
  const after = await open();
  await expect(after.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible({ timeout: 30_000 });
});
