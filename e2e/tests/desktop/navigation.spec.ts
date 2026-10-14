import { expect, test } from '../../support/fixtures';

/**
 * The simplified worker navigation: five primary groups (Home, Track, Timesheet, Time off, Me) with
 * secondary sub-tabs, so the daily job is obvious and every screen is still reachable. Covers the
 * UX simplification: grouped nav, the monitoring disclosure staying reachable, de-technicalized
 * settings, the lighter timer card, and billable hours hidden from workers.
 */
test.describe('Worker app navigation', () => {
  const primary = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Primary' });

  test('has exactly five primary groups and no stray top-level items', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    const nav = primary(page);
    for (const label of ['Home', 'Track', 'Timesheet', 'Time off']) await expect(nav.getByRole('button', { name: label })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Me', exact: true })).toBeVisible();
    // Screens that used to be top-level are now grouped, not separate nav items.
    for (const gone of ['Projects', 'Tasks', 'Time Tracking', 'Reports', 'Activity', 'Schedule', 'Pay Stubs', 'Settings']) {
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

  test('Me groups Schedule, Pay stubs, What is monitored and Settings', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Me', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible();
    await page.getByRole('tab', { name: 'Pay stubs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pay Stubs' })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  test('keeps the monitoring disclosure reachable and leads with a plain summary', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Me', exact: true }).click();
    await page.getByRole('tab', { name: 'What is monitored' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'What is monitored' })).toBeVisible();
    // The disclosure stays complete: the plain summary plus every monitored signal is listed.
    await expect(page.getByText('In short:')).toBeVisible();
    for (const row of ['Activity level', 'Screenshots', 'Applications', 'Websites', 'Location', 'Idle detection']) {
      await expect(page.getByText(row, { exact: true })).toBeVisible();
    }
  });

  test('Settings shows worker details and tucks technical values behind a disclosure', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await primary(page).getByRole('button', { name: 'Me', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Signed in as')).toBeVisible();
    // Technical values are present but hidden inside the collapsed disclosure until the worker opens it.
    await expect(page.getByText('Capabilities')).not.toBeVisible();
    await page.getByText('Technical details').click();
    await expect(page.getByText('Capabilities')).toBeVisible();
    await expect(page.getByText('Device ID')).toBeVisible();
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
