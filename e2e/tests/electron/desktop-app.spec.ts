import { readFileSync, existsSync } from 'node:fs';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, openPage, signIn, test } from '../../support/electron';
import { ok, uid, usd } from '../../support/fixtures';

/**
 * The real desktop app: Electron main process, preload bridge and window, against the test server.
 * Covers what the browser-served window cannot: sign-in and secure storage, IPC validation, and the
 * main process fetching a pay stub PDF and writing it where the person chose.
 */

/** Replace the native Save dialog (and "open the file") in the main process; returns what was asked. */
async function stubSaveDialog(app: ElectronApplication, answer: { canceled: boolean; filePath?: string }) {
  await app.evaluate(({ dialog, shell }, a) => {
    const g = globalThis as unknown as { __save: unknown[]; __opened: string[] };
    g.__save = [];
    g.__opened = [];
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      g.__save.push(args.length === 2 ? args[1] : args[0]);
      return { canceled: a.canceled, filePath: a.filePath ?? '' };
    }) as typeof dialog.showSaveDialog;
    shell.openPath = async (p: string) => {
      g.__opened.push(p);
      return '';
    };
  }, answer);
  return {
    asked: () => app.evaluate(() => (globalThis as unknown as { __save: Array<{ defaultPath: string; filters: Array<{ extensions: string[] }> }> }).__save),
    opened: () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened),
  };
}

test('a worker signs in with email and password and reaches Home', { tag: '@smoke' }, async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  await expect(window.getByLabel('Timer')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Profile' })).toContainText(data.worker.name);
  await test.info().attach('home', { body: await window.screenshot(), contentType: 'image/png' });
});

test('downloads a pay stub through the main process to where the worker chose', { tag: '@smoke' }, async ({ desktopApp, data }) => {
  const { app, window } = desktopApp;
  await signIn(window, data.worker.email);
  await openPage(window, 'Pay stubs');
  await expect(window.getByRole('listitem').filter({ hasText: usd(data.payStub.netMinor) })).toBeVisible();

  const target = test.info().outputPath('my-pay-stub.pdf');
  const save = await stubSaveDialog(app, { canceled: false, filePath: target });
  await window.getByRole('button', { name: 'PDF' }).click();

  // The file appears before writeFile finishes, and the main process opens it only afterwards: wait for both.
  await expect.poll(() => (existsSync(target) ? readFileSync(target).subarray(0, 5).toString() : '')).toBe('%PDF-');
  const [asked] = await save.asked();
  // Suggested name comes from the server's file name, checked against the expected pattern.
  expect(asked!.defaultPath).toMatch(new RegExp(`pay-stub-${data.payStub.periodStart}\\.pdf$`));
  expect(asked!.filters[0]!.extensions).toEqual(['pdf']);
  await expect.poll(() => save.opened()).toEqual([target]);
  await expect(window.getByText('Could not download the pay stub')).toHaveCount(0);
  await test.info().attach('pay-stubs', { body: await window.screenshot(), contentType: 'image/png' });
});

test('cancelling the Save dialog writes nothing and shows no error', async ({ desktopApp, data }) => {
  const { app, window } = desktopApp;
  await signIn(window, data.worker.email);
  await openPage(window, 'Pay stubs');
  const save = await stubSaveDialog(app, { canceled: true });
  await window.getByRole('button', { name: 'PDF' }).click();
  await expect.poll(async () => (await save.asked()).length).toBe(1);
  expect(await save.opened()).toEqual([]);
  await expect(window.getByRole('button', { name: 'PDF' })).toBeEnabled();
  await expect(window.getByText('Could not download the pay stub')).toHaveCount(0);
});

test('the window has no Node access and the main process rejects invalid requests', async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  const result = await window.evaluate(async () => {
    const w = window as unknown as { require?: unknown; process?: unknown; ipcRenderer?: unknown; tallywork: { me(r: string): Promise<unknown>; savePayStub(id: string): Promise<unknown> } };
    const fails = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => e.message);
    return {
      node: [typeof w.require, typeof w.process, typeof w.ipcRenderer],
      bridge: Object.keys(w.tallywork).includes('invoke'),
      badResource: await fails(w.tallywork.me('../orgs/x/workers')),
      badStubId: await fails(w.tallywork.savePayStub('../../orgs/x/payroll/runs')),
    };
  });
  expect(result.node).toEqual(['undefined', 'undefined', 'undefined']);
  expect(result.bridge).toBe(false);
  expect(result.badResource).toContain('Invalid payload for me:get');
  expect(result.badStubId).toContain('Invalid payload for me:savePayStub');
});

test('signing out returns to the sign-in screen', async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  await window.getByRole('button', { name: 'Profile' }).click();
  await window.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(window.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
});

test('the sign-in screen can show and hide the password', async ({ desktopApp }) => {
  const { window } = desktopApp;
  await expect(window.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
  const password = window.getByLabel('Password', { exact: true });
  await password.fill('not-a-real-password');
  await expect(password).toHaveAttribute('type', 'password');
  await window.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await window.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('a running timer stops on the desktop when an admin force-stops it', { tag: '@smoke' }, async ({ desktopApp, data, adminApi }) => {
  // The desktop learns of it on its next heartbeat or sync: within about a minute.
  test.setTimeout(180_000);
  const { window } = desktopApp;
  const { api, orgApi } = adminApi;
  await signIn(window, data.worker.email);
  const timer = window.getByLabel('Timer');
  await timer.getByLabel('Project').selectOption(data.projects.website.id);
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();

  // The admin sees the session once the app has synced it (every 10 s), and force-stops it.
  let sessionId = '';
  await expect
    .poll(
      async () => {
        const live = await ok<Array<{ membership_id: string; session_id: string | null }>>(await api.get(orgApi('/tracking/live')), 'live');
        sessionId = live.find((w) => w.membership_id === data.worker.membershipId)?.session_id ?? '';
        return sessionId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  expect((await ok<{ state: string }>(await api.post(orgApi(`/sessions/${sessionId}/force-stop`), { data: {} }), 'force stop')).state).toBe('STOPPED');

  await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(timer.getByRole('button', { name: 'Clock in' })).toBeVisible();
  await test.info().attach('force-stopped', { body: await window.screenshot(), contentType: 'image/png' });
  // The app does not restart it: the server still has no session for the worker.
  const after = await ok<Array<{ membership_id: string; session_id: string | null }>>(await api.get(orgApi('/tracking/live')), 'live');
  expect(after.find((w) => w.membership_id === data.worker.membershipId)?.session_id ?? null).toBeNull();
});

test('clicking the running project in Track › Projects keeps the Home timer running', { tag: '@smoke' }, async ({ desktopApp, data, adminApi }) => {
  test.setTimeout(120_000);
  const { window } = desktopApp;
  const { api, orgApi } = adminApi;
  const liveSession = async () => (await ok<Array<{ membership_id: string; session_id: string | null }>>(await api.get(orgApi('/tracking/live')), 'live')).find((w) => w.membership_id === data.worker.membershipId)?.session_id ?? '';
  const seconds = async () => {
    const [h, m, s] = (await window.getByLabel('Timer').locator('.font-mono').innerText()).trim().split(':').map(Number);
    return h! * 3600 + m! * 60 + s!;
  };
  await signIn(window, data.worker.email);
  await window.getByLabel('Timer').getByLabel('Project').selectOption(data.projects.website.id);
  await expect(window.getByLabel('Timer').getByText('Clocked in', { exact: true })).toBeVisible();
  await expect.poll(liveSession, { timeout: 30_000 }).not.toBe('');
  const sessionId = await liveSession();
  await expect.poll(seconds).toBeGreaterThanOrEqual(3);
  const before = await seconds();

  await openPage(window, 'Track'); // opens its first tab, Projects
  await expect(window.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  const row = window.getByRole('region', { name: 'Projects' }).getByRole('button', { name: new RegExp(data.projects.website.name) });
  await expect(row).toContainText('Tracking');
  await row.click();
  await expect(row).toContainText('Tracking');

  await openPage(window, 'Home');
  await expect(window.getByLabel('Timer').getByText('Clocked in', { exact: true })).toBeVisible();
  expect(await seconds()).toBeGreaterThanOrEqual(before);
  // Still the same session on the server: nothing was stopped and restarted.
  await window.waitForTimeout(11_000); // one sync
  expect(await liveSession()).toBe(sessionId);

  await clockOut(window, 'Checked the project list.');
});

/** Clock out from Home with an end-of-day report. */
async function clockOut(window: Page, report: string, opts: { finished?: boolean } = {}) {
  await window.getByLabel('Timer').getByRole('button', { name: 'Clock out' }).click();
  const sheet = window.getByRole('dialog', { name: 'Clock out' });
  await sheet.getByLabel('End-of-day report').fill(report);
  if (opts.finished) await sheet.getByLabel(/This work is finished/).check();
  await sheet.getByRole('button', { name: 'Submit and clock out' }).click();
  await expect(sheet).toBeHidden();
  await expect(window.getByLabel('Timer').getByText('Not clocked in', { exact: true })).toBeVisible();
}

test('a worker clocks in, takes the project’s planned breaks and clocks out with an end-of-day report', { tag: '@smoke' }, async ({ desktopApp, data, adminApi }) => {
  test.setTimeout(120_000);
  const { window } = desktopApp;
  const { api, orgApi } = adminApi;
  // The admin plans Coffee and Lunch on a project the worker is on (before the app signs in and loads it).
  const run = uid();
  const coffee = await ok<{ id: string }>(await api.post(orgApi('/break-types'), { data: { name: `Coffee ${run}`, paid: true, max_minutes: 15 } }), 'coffee');
  const lunch = await ok<{ id: string }>(await api.post(orgApi('/break-types'), { data: { name: `Lunch ${run}`, paid: false, max_minutes: 60 } }), 'lunch');
  const project = await ok<{ id: string; name: string }>(
    await api.post(orgApi('/projects'), {
      data: {
        name: `Front desk ${run}`,
        member_ids: [data.worker.membershipId],
        breaks: [
          { break_type_id: coffee.id, start_time: '10:30', duration_minutes: 10 },
          { break_type_id: lunch.id, start_time: '12:00' },
        ],
      },
    }),
    'project',
  );

  await signIn(window, data.worker.email);
  const timer = window.getByLabel('Timer');
  await expect(timer.getByRole('button', { name: 'Pick a project to clock in' })).toBeDisabled();
  await timer.getByLabel('Project').selectOption(project.id);
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();

  // The project's breaks are one-tap buttons, with their time and length.
  const breaks = timer.getByRole('group', { name: 'Breaks' });
  await expect(breaks.getByRole('button')).toHaveCount(2);
  await expect(breaks.getByRole('button', { name: /Coffee .* break/ })).toContainText('10m');
  await expect(breaks.getByRole('button', { name: /Lunch .* break/ })).toContainText('60m');

  await breaks.getByRole('button', { name: /Lunch .* break/ }).click();
  await expect(timer.getByText(`On break · Lunch ${run}`, { exact: true })).toBeVisible();
  await expect(timer.getByLabel('Break time')).toContainText('left of 60m');
  await expect(breaks).toBeHidden();
  await test.info().attach('on-lunch', { body: await window.screenshot(), contentType: 'image/png' });
  await timer.getByRole('button', { name: 'Clock back in' }).click();
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();

  // Clocking out asks for the report; it can be cancelled, and it cannot be sent empty.
  await timer.getByRole('button', { name: 'Clock out' }).click();
  const sheet = window.getByRole('dialog', { name: 'Clock out' });
  await expect(sheet).toContainText(project.name);
  await expect(sheet.getByRole('button', { name: 'Submit and clock out' })).toBeDisabled();
  await sheet.getByLabel('End-of-day report').fill('   ');
  await expect(sheet.getByRole('button', { name: 'Submit and clock out' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Keep working' }).click();
  await expect(sheet).toBeHidden();
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();

  await clockOut(window, 'Checked in 12 guests.\nSorted the lost-and-found.', { finished: true });

  // The manager reads it with the session's time once the app has synced (every 10 s). The range
  // spans a day either side, since the report's date is the worker's local date.
  const from = new Date(Date.now() - 86400_000).toLocaleDateString('en-CA');
  const to = new Date(Date.now() + 86400_000).toLocaleDateString('en-CA');
  await expect
    .poll(async () => (await ok<Array<{ project_id: string; body: string; finished: boolean }>>(await api.get(orgApi(`/eod-reports?from=${from}&to=${to}`)), 'reports')).find((r) => r.project_id === project.id), { timeout: 30_000 })
    .toMatchObject({ body: 'Checked in 12 guests.\nSorted the lost-and-found.', finished: true });
});
