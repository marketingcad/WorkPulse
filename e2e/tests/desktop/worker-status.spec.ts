import AxeBuilder from '@axe-core/playwright';
import type { AgentState } from '../../../apps/desktop/src/shared/ipc';
import { expect, test } from '../../support/fixtures';

/**
 * UX remediation, phase 2 (desktop): the worker never has to guess whether time is being recorded,
 * whether this computer is approved, or whether work has synced; and nothing starts or ends by accident.
 */
const OTHER = '0190a000-0000-7000-8000-0000000000aa';
const withSecondProject = (r: AgentState): AgentState => ({ ...r, assignments: [...r.assignments, { project_id: OTHER, project_name: 'Second project', color: '#888', client_name: null, tasks: [], breaks: [] }] });
const tracking = (r: AgentState): AgentState => ({
  ...r,
  tracking: { ...r.tracking, state: 'active', sessionId: '0190a000-0000-7000-8000-0000000000bb', projectId: r.assignments[0]!.project_id, taskId: null, startedAt: new Date().toISOString(), segmentStartedAt: new Date().toISOString() },
});
const ops = (calls: Array<{ op: string }>) => calls.map((c) => c.op);

test.describe('choosing a project does not start tracking', () => {
  test('picking with the keyboard selects only; Clock in starts', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: withSecondProject, record: ['start', 'switchTask'] });
    const timer = page.getByLabel('Timer');
    const select = timer.getByLabel('Project');
    // Arrow keys on a focused select change it on every press: that used to start (and stop) sessions.
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await select.selectOption({ label: 'Second project' });
    expect(ops(handle.calls)).toEqual([]);
    await timer.getByRole('button', { name: 'Clock in to Second project' }).click();
    await expect.poll(() => handle.calls).toEqual([{ op: 'start', args: [OTHER, null] }]);
  });

  test('while clocked in, Change then Switch moves to another project; Cancel does nothing', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: (r) => tracking(withSecondProject(r)), record: ['switchTask'] });
    const timer = page.getByLabel('Timer');
    await timer.getByRole('button', { name: 'Change' }).click();
    await expect(timer.getByRole('button', { name: 'Choose another project or task' })).toBeDisabled();
    await timer.getByLabel('Project').selectOption({ label: 'Second project' });
    expect(ops(handle.calls)).toEqual([]);
    await timer.getByRole('button', { name: 'Cancel' }).click();
    expect(ops(handle.calls)).toEqual([]);

    await timer.getByRole('button', { name: 'Change' }).click();
    await timer.getByLabel('Project').selectOption({ label: 'Second project' });
    await timer.getByRole('button', { name: 'Switch to Second project' }).click();
    await expect.poll(() => handle.calls).toEqual([{ op: 'switchTask', args: [OTHER, null] }]);
  });

  test('a worker on no project is told why there is nothing to clock in to', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: (r) => ({ ...r, assignments: [], lastProject: null }) });
    const timer = page.getByLabel('Timer');
    await expect(timer.getByRole('status')).toContainText('You are not on any project yet');
    await expect(timer.getByRole('button', { name: 'No project to clock in to' })).toBeDisabled();
  });
});

test.describe('signing out or quitting while clocked in', () => {
  test('asks for the end-of-day report first; Keep working cancels', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: tracking, record: ['stop', 'logout', 'quit'] });
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clock out before signing out' });
    await expect(dialog).toContainText('You are still clocked in');
    await dialog.getByRole('button', { name: 'Keep working' }).click();
    await expect(dialog).toBeHidden();
    expect(ops(handle.calls)).toEqual([]);

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog').getByLabel('End-of-day report').fill('Finished the landing page.');
    await page.getByRole('button', { name: 'Clock out and sign out' }).click();
    await expect.poll(() => ops(handle.calls)).toEqual(['stop', 'logout']);
  });

  test('Quit while clocked in (also from the tray) asks the same, then quits', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: tracking, record: ['stop', 'quit'] });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Quit WorkPulse' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clock out before quitting' });
    await dialog.getByLabel('End-of-day report').fill('Done for today.');
    await dialog.getByRole('button', { name: 'Clock out and quit' }).click();
    await expect.poll(() => ops(handle.calls)).toEqual(['stop', 'quit']);
  });

  test('not clocked in: Sign out signs out straight away', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { record: ['logout'] });
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect.poll(() => ops(handle.calls)).toEqual(['logout']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('device, connection and sync status', () => {
  test('a computer waiting for approval says so, and that the time is kept', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: (r) => ({ ...r, device: { ...r.device!, status: 'PENDING' }, sync: { ...r.sync, queued: 3 } }) });
    const banner = page.getByRole('region', { name: 'Waiting for approval' });
    await expect(banner).toContainText('Waiting for your administrator to approve this computer');
    await expect(banner).toContainText('Nothing is lost while you wait');
    await expect(page.getByRole('banner')).toContainText('3 saved · waiting for approval');
    await expect(page.getByText('Syncing…')).toHaveCount(0);
  });

  test('offline: which saved settings are used and until when', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, {
      state: (r) => ({ ...r, sync: { ...r.sync, online: false, queued: 4 }, offline: { mode: 'offline', settingsSavedAt: '2026-11-04T09:00:00.000Z', allowedUntil: '2026-11-05T09:00:00.000Z', totalsPartial: true } }),
    });
    const banner = page.getByRole('region', { name: 'Offline' });
    await expect(banner).toContainText('You are offline: your time is saved on this computer');
    await expect(banner).toContainText('Using your projects and tracking settings saved on');
    await expect(banner).toContainText('You can keep tracking offline until');
    await expect(banner).toContainText('totals may be missing some time');
    await expect(page.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  });

  test('offline for too long: says it is over and to connect', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: (r) => ({ ...r, sync: { ...r.sync, online: false }, offline: { mode: 'expired', settingsSavedAt: null, allowedUntil: '2026-11-04T09:00:00.000Z', totalsPartial: false } }) });
    await expect(page.getByRole('region', { name: 'Offline' })).toContainText('Offline for too long: connect to clock in');
    await expect(page.getByRole('banner')).toContainText('Offline too long');
  });
});

test.describe('time the server did not add', () => {
  const item = { id: '0190a000-0000-7000-8000-0000000000cc', kind: 'time' as const, projectId: null, taskId: null, from: '2026-11-03T13:00:00.000Z', to: '2026-11-03T15:30:00.000Z', reason: 'You are no longer on this project.', count: 3 };

  test('is shown with why, can be asked for as manual time, or removed after confirming', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, {
      state: (r) => ({ ...r, notAdded: [{ ...item, projectId: r.assignments[0]!.project_id }], policy: { ...r.policy!, manualTime: { ...r.policy!.manualTime, allowed: true } } }),
      record: ['dismissNotAdded'],
    });
    const card = page.getByRole('region', { name: 'Not added to your time' });
    await expect(card).toContainText('You are no longer on this project.');
    await expect(card).toContainText('kept here until you deal with them');

    await card.getByRole('button', { name: 'Remove' }).click();
    await expect(card).toContainText('The time will not be added');
    await card.getByRole('button', { name: 'Keep' }).click();
    expect(ops(handle.calls)).toEqual([]);

    await card.getByRole('button', { name: 'Ask for this time' }).click();
    await expect(page.getByRole('heading', { name: 'Add manual time' })).toBeVisible();
    // Started from the refused time (shown in the window's local time zone, UTC in this run).
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('13:00');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('15:30');
  });

  test('refused monitoring data is a note, not lost time', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: (r) => ({ ...r, notAdded: [{ ...item, kind: 'data', reason: 'Your organization turned this off, so screenshots recorded meanwhile were not kept.' }] }), record: ['dismissNotAdded'] });
    const card = page.getByRole('region', { name: 'Not added to your time' });
    await expect(card).toContainText('Monitoring data');
    await expect(card.getByRole('button', { name: 'Ask for this time' })).toHaveCount(0);
    await card.getByRole('button', { name: 'OK, remove' }).click();
    await card.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => handle.calls).toEqual([{ op: 'dismissNotAdded', args: [item.id] }]);
  });
});

test.describe('macOS permissions', () => {
  test('a missing permission is explained with a button to the right setting', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, {
      state: (r) => ({ ...r, permissions: { screenRecording: false, accessibility: true }, policy: { ...r.policy!, screenshots: { ...r.policy!.screenshots, enabled: true, perTenMinutes: 1 } } }),
      record: ['openPermissionSettings'],
    });
    const banner = page.getByRole('region', { name: 'Screen Recording permission' });
    await expect(banner).toContainText('Allow Screen Recording for Tallywork');
    await expect(banner).toContainText('nothing is recorded');
    await banner.getByRole('button', { name: 'Open Screen Recording settings' }).click();
    await expect.poll(() => handle.calls).toEqual([{ op: 'openPermissionSettings', args: ['screen'] }]);
  });
});

test.describe('offline tracking ran out while clocked in', () => {
  test('says tracking was paused, when, and that it does not restart on its own', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, {
      state: (r) => ({
        ...tracking(r),
        tracking: { ...tracking(r).tracking, state: 'paused', segmentStartedAt: null },
        sync: { ...r.sync, online: false },
        offline: { mode: 'expired', settingsSavedAt: null, allowedUntil: '2026-11-04T17:00:00.000Z', totalsPartial: false, pausedAt: '2026-11-04T17:00:00.000Z' },
      }),
    });
    const banner = page.getByRole('region', { name: 'Offline' });
    await expect(banner).toContainText('Tracking paused at');
    await expect(banner).toContainText('No time is being recorded');
    await expect(banner).toContainText('tracking does not restart on its own');
  });

  test('once back online it still waits for the worker to clock back in', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, {
      state: (r) => ({ ...tracking(r), tracking: { ...tracking(r).tracking, state: 'paused', segmentStartedAt: null }, offline: { mode: 'online', settingsSavedAt: null, allowedUntil: null, totalsPartial: false, pausedAt: '2026-11-04T17:00:00.000Z' } }),
    });
    const banner = page.getByRole('region', { name: 'Tracking paused' });
    await expect(banner).toContainText('you were offline for too long');
    await expect(banner).toContainText('Clock back in when you want to continue');
    await expect(page.getByLabel('Timer').getByRole('button', { name: 'Clock back in' })).toBeVisible();
  });
});
