import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { AgentState } from '../../../apps/desktop/src/shared/ipc';
import { expect, ok, test, uid } from '../../support/fixtures';
import { WEB_URL } from '../../support/env';

/**
 * Accessibility acceptance for the desktop app (UX remediation, phase 4): every screen passes axe
 * (WCAG 2.1 A/AA, serious and critical), and the app's own sheets and drawer behave like dialogs on
 * the keyboard: focus moves in, Tab cannot leave, Escape closes when that is safe, and focus returns.
 */
const SCREENS: Array<{ nav: string; tab?: string; heading: string | RegExp }> = [
  { nav: 'Home', heading: /^Good (morning|afternoon|evening)/ },
  { nav: 'Track', tab: 'Projects', heading: 'Projects' },
  { nav: 'Track', tab: 'Tasks', heading: 'Tasks' },
  { nav: 'Track', tab: 'Sessions', heading: 'Time Tracking' },
  { nav: 'Timesheet', tab: 'Timesheet', heading: 'Timesheet' },
  { nav: 'Timesheet', tab: 'Activity', heading: 'Activity' },
  { nav: 'Timesheet', tab: 'Reports', heading: 'Reports' },
  { nav: 'Time off', heading: 'Time Off' },
  { nav: 'Schedule', heading: 'Schedule' },
  { nav: 'Pay stubs', heading: 'Pay Stubs' },
  { nav: 'Settings', heading: 'Settings' },
];

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
}

const tracking = (r: AgentState): AgentState => ({
  ...r,
  tracking: { ...r.tracking, state: 'active', sessionId: '0190a000-0000-7000-8000-0000000000bb', projectId: r.assignments[0]!.project_id, taskId: null, startedAt: new Date().toISOString(), segmentStartedAt: new Date().toISOString() },
});

test.describe('desktop screens pass axe', () => {
  for (const s of SCREENS) {
    test(`${s.nav}${s.tab ? ` › ${s.tab}` : ''}`, async ({ page, openDesktop, workerDevice }) => {
      await openDesktop(workerDevice);
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: s.nav, exact: true }).click();
      if (s.tab) await page.getByRole('tab', { name: s.tab, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: s.heading, exact: typeof s.heading === 'string' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await serious(page)).toEqual([]);
    });
  }
});

test.describe('desktop dialogs on the keyboard', () => {
  test('navigation drawer: focus moves in, Tab stays in, Escape closes and returns focus', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await page.setViewportSize({ width: 800, height: 760 });
    await openDesktop(workerDevice);
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    expect(await serious(page)).toEqual([]);
    const close = drawer.getByRole('button', { name: 'Close navigation' });
    await expect(close).toBeFocused();
    // Shift+Tab from the first control wraps to the last, and Tab from the last wraps back.
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Settings' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    // Many Tabs never reach the page behind the drawer.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();

    // Picking a screen with the keyboard closes the drawer and opens it.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  });

  test('idle time: focus is on the choice, Tab stays in, Escape does not decide for the worker', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, {
      state: (r) => ({ ...tracking(r), idlePrompt: { idleId: '0190a000-0000-7000-8000-0000000000cc', startedAt: new Date(Date.now() - 12 * 60_000).toISOString(), endedAt: new Date().toISOString() } }),
      record: ['resolveIdle'],
    });
    const sheet = page.getByRole('dialog', { name: 'Idle time' });
    await expect(sheet).toBeVisible();
    expect(await serious(page)).toEqual([]);
    const keep = sheet.getByRole('button', { name: 'Keep — I was working' });
    const discard = sheet.getByRole('button', { name: 'Discard idle time' });
    await expect(keep).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(discard).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();
    expect(handle.calls).toEqual([]);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect.poll(() => handle.calls).toEqual([{ op: 'resolveIdle', args: ['DISCARDED'] }]);
  });

  test('clock-out sheet: the report field has focus, Tab stays in, Escape keeps working', async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, { state: tracking, record: ['stop', 'logout'] });
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const sheet = page.getByRole('dialog', { name: 'Clock out before signing out' });
    await expect(sheet).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await expect(sheet.getByLabel('End-of-day report')).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(handle.calls).toEqual([]);
  });
});

test.describe('cancelling time off from the desktop app', () => {
  test('a pending request can be withdrawn after confirming; Keep it does nothing', async ({ page, openDesktop, workerDevice, adminApi }) => {
    const name = `Leave ${uid()}`;
    const policy = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [workerDevice.boot.worker.membership_id] } }), 'create policy');
    // A Monday far ahead, different on every run so requests never overlap.
    const day = new Date(Date.UTC(2028, 0, 3 + 7 * Math.floor(Math.random() * 500))).toISOString().slice(0, 10);
    const res = await fetch(`${WEB_URL}/api/v1/agent/me/time-off`, { method: 'POST', headers: { Authorization: `Bearer ${workerDevice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ policy_id: policy.id, start_date: day, end_date: day, half_day: false }) });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await openDesktop(workerDevice);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Time off' }).click();
    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row).toContainText('Pending');
    await row.getByRole('button', { name: 'Cancel request' }).click();
    await expect(row.getByRole('group', { name: 'Cancel this request?' })).toContainText('Withdraw this request?');
    await row.getByRole('button', { name: 'Keep it' }).click();
    await expect(row).toContainText('Pending');

    await row.getByRole('button', { name: 'Cancel request' }).click();
    await row.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(row).toContainText('Cancelled');
    await expect(row.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
    // The server has it cancelled (not only the screen).
    const mine = (await (await fetch(`${WEB_URL}/api/v1/agent/me/time-off`, { headers: { Authorization: `Bearer ${workerDevice.token}` } })).json()) as { requests: Array<{ id: string; status: string }> };
    expect(mine.requests.find((r) => r.id === id)?.status).toBe('CANCELLED');
  });
});
