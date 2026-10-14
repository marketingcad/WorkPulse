import { expect, test } from '../../support/fixtures';

/**
 * The simplified worker navigation: primary groups (Home, Track, Timesheet, Time off, Schedule,
 * Pay stubs, Settings), some with secondary sub-tabs, so the daily job is obvious and every screen is still reachable. Covers the
 * UX simplification: grouped nav, the "What is monitored" screen removed, de-technicalized settings,
 * the lighter timer card, and billable hours hidden from workers.
 */
test.describe('Worker app navigation', () => {
  const primary = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Primary' });

  test('has exactly the primary groups and no stray top-level items', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    const nav = primary(page);
    await expect(nav.getByRole('button')).toHaveText(['Home', 'Track', 'Timesheet', 'Time off', 'Schedule', 'Pay stubs', 'Settings']);
    // Screens grouped under Track and Timesheet are sub-tabs, not separate nav items; "Me" is gone.
    for (const gone of ['Projects', 'Tasks', 'Time Tracking', 'Reports', 'Activity', 'Me']) {
      await expect(nav.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
    }
  });

  test('Track groups Projects, Tasks and Sessions', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Track' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    await page.getByRole('tab', { name: 'Sessions' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Time Tracking' })).toBeVisible();
  });

  test('Timesheet groups Timesheet, Activity and Reports', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Timesheet' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  });

  test('Schedule, Pay stubs and Settings open straight from the sidebar, with no sub-tabs', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    for (const [button, heading] of [['Schedule', 'Schedule'], ['Pay stubs', 'Pay Stubs'], ['Settings', 'Settings']] as const) {
      await primary(page).getByRole('button', { name: button, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(primary(page).getByRole('button', { name: button, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('tab')).toHaveCount(0);
    }
  });

  test('no longer offers a "What is monitored" screen', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await expect(primary(page).getByRole('button', { name: /what is monitored/i })).toHaveCount(0);
    await primary(page).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: /what is monitored/i })).toHaveCount(0);
  });

  test('the profile menu offers only Sign out: Settings lives in the sidebar', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveText(['Sign out']);
  });

  test('Settings shows worker details and no technical values', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Settings', exact: true }).click();
    for (const label of ['Signed in as', 'Organization', 'This device', 'Version']) await expect(page.getByText(label, { exact: true })).toBeVisible();
    for (const technical of ['Technical details', 'Device ID', 'Capabilities']) await expect(page.getByText(technical)).toHaveCount(0);
  });

  test('Home leads with the timer and shows no false alarms when nothing is due', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await expect(page.getByLabel('Timer')).toBeVisible();
    await expect(page.getByText('Working on')).toBeVisible();
    // The fixture has no timesheet due and no queued manual time, so the attention strip must not appear.
    await expect(page.getByRole('region', { name: 'Needs attention' })).toHaveCount(0);
  });

  test('does not show billable hours to the worker on the timesheet', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Timesheet' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();
    await expect(page.getByText('Billable', { exact: true })).toHaveCount(0);
  });
});
