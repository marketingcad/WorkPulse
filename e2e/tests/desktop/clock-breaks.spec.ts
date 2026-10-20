import type { AgentState } from '../../../apps/desktop/src/shared/ipc';
import { expect, test } from '../../support/fixtures';

/**
 * The timer as a clock: Clock in / Clock out, the project's planned breaks as buttons, the break
 * countdown, and the end-of-day report asked for when clocking out. The window starts from a chosen
 * state; the main-process actions it calls are recorded (the real app is covered in tests/electron).
 */
const COFFEE = '0190a000-0000-7000-8000-0000000000c0';
const LUNCH = '0190a000-0000-7000-8000-0000000000a0';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Clocked in on the worker's first project, which plans Coffee 10:30 (15m) and Lunch 12:00 (60m). */
const clockedIn = (s: AgentState): AgentState => {
  const p = s.assignments[0]!;
  return {
    ...s,
    assignments: [{ ...p, breaks: [
      { break_type_id: COFFEE, name: 'Coffee', paid: true, start_time: '10:30', duration_minutes: 15 },
      { break_type_id: LUNCH, name: 'Lunch', paid: false, start_time: '12:00', duration_minutes: 60 },
    ] }, ...s.assignments.slice(1)],
    breakTypes: [
      { id: COFFEE, name: 'Coffee', paid: true, maxMinutes: 15 },
      { id: LUNCH, name: 'Lunch', paid: false, maxMinutes: 60 },
    ],
    tracking: { state: 'active', sessionId: '0190a000-0000-7000-8000-0000000000f1', projectId: p.project_id, taskId: null, startedAt: minutesAgo(125), baseSeconds: 0, segmentStartedAt: minutesAgo(125), note: '' },
  };
};

/** On the Lunch break, started `minutes` ago. */
const onLunch = (minutes: number) => (s: AgentState): AgentState => {
  const c = clockedIn(s);
  return { ...c, tracking: { ...c.tracking, state: 'paused', baseSeconds: 2 * 3600, segmentStartedAt: null }, breakTypeId: LUNCH, breakStartedAt: minutesAgo(minutes), breakMinutes: 60 };
};

test.describe('Clock in, breaks and clock out', () => {
  test('clocked in: the project’s breaks are one-tap buttons that start that break with its length', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const desktop = await openDesktop(workerDevice, { state: clockedIn, record: ['takeBreak'] });
    const timer = page.getByLabel('Timer');
    await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();
    const breaks = timer.getByRole('group', { name: 'Breaks' });
    await expect(breaks.getByRole('button')).toHaveText([/Coffee.*15m/, /Lunch.*60m/]);
    await breaks.getByRole('button', { name: /Start Lunch break/ }).click();
    await expect.poll(() => desktop.calls).toEqual([{ op: 'takeBreak', args: [LUNCH, 60] }]);
  });

  test('on a break: a countdown, then how far over it is, and Clock back in', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: onLunch(20) });
    const timer = page.getByLabel('Timer');
    await expect(timer.getByText('On break · Lunch', { exact: true })).toBeVisible();
    await expect(timer.getByLabel('Break time')).toContainText(/Lunch break · 3\d:\d\d left of 60m/);
    await expect(timer.getByRole('button', { name: 'Clock back in' })).toBeVisible();
    await expect(timer.getByRole('group', { name: 'Breaks' })).toHaveCount(0);
  });

  test('a break past its length says how far over it is', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: onLunch(75) });
    await expect(page.getByLabel('Timer').getByLabel('Break time')).toHaveText('Lunch break · 15m over · clock back in');
  });

  test('clocking out sends the end-of-day report and the “finished” tick', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const desktop = await openDesktop(workerDevice, { state: clockedIn, record: ['stop'] });
    await page.getByLabel('Timer').getByRole('button', { name: 'Clock out' }).click();
    const sheet = page.getByRole('dialog', { name: 'Clock out' });
    await expect(sheet).toContainText(workerDevice.boot.assignments[0]!.project_name);
    await expect(sheet).toContainText('2h 05m this session');
    const send = sheet.getByRole('button', { name: 'Submit and clock out' });
    await expect(send).toBeDisabled();
    await sheet.getByLabel('End-of-day report').fill('  Finished the onboarding checklist.  ');
    await sheet.getByLabel(/This work is finished/).check();
    await send.click();
    await expect(sheet).toBeHidden();
    expect(desktop.calls).toEqual([{ op: 'stop', args: [{ text: 'Finished the onboarding checklist.', finished: true }] }]);
  });

  test('Escape or Keep working closes the report without clocking out', async ({ page, openDesktop, workerDevice }) => {
    const desktop = await openDesktop(workerDevice, { state: clockedIn, record: ['stop'] });
    const sheet = page.getByRole('dialog', { name: 'Clock out' });
    await page.getByLabel('Timer').getByRole('button', { name: 'Clock out' }).click();
    await sheet.getByLabel('End-of-day report').fill('half written');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.getByLabel('Timer').getByRole('button', { name: 'Clock out' }).click();
    await sheet.getByRole('button', { name: 'Keep working' }).click();
    await expect(sheet).toBeHidden();
    expect(desktop.calls).toEqual([]);
    await expect(page.getByLabel('Timer').getByText('Clocked in', { exact: true })).toBeVisible();
  });

  test('not clocked in: Clock in, and no breaks or report', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    const timer = page.getByLabel('Timer');
    await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible();
    await expect(timer.getByRole('button', { name: /clock in/i })).toBeVisible();
    await expect(timer.getByRole('group', { name: 'Breaks' })).toHaveCount(0);
    await expect(timer.getByRole('button', { name: 'Clock out' })).toHaveCount(0);
  });
});
