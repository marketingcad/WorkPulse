import { randomUUID } from 'node:crypto';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * The admin simplification: a smaller sidebar (36 → 20 items), related pages as tabs
 * (Members · Teams, Schedules · Attendance, the Settings area), personal pages in the user menu,
 * Sessions reached from Live, Force stop wherever a session is opened, and one note under rates.
 * Every page keeps its URL and its own permission check.
 */
const sidebar = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Primary' });

test.describe('Admin navigation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the sidebar has the new groups; personal pages, Sessions and Developer are not in it', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const nav = sidebar(page);
    // The collapsible group headings (the organization switcher above them is not one).
    await expect(nav.getByRole('navigation').getByRole('button')).toHaveText(['Time Tracking', 'Workforce', 'Project Management', 'Finance', 'Reports']);
    for (const gone of ['My timesheet', 'Pay stubs', 'Sessions', 'API keys', 'Webhooks', 'Teams', 'Attendance', 'Tracking policies', 'What is monitored', 'Session history', 'Manual time', 'Team timesheets', 'Billing & rates']) {
      await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    }
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', `/o/${data.orgId}/settings`);
  });

  test('Settings is one item whose tabs reach every settings page, including Devices and the API pages', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await sidebar(page).getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Settings' });
    await expect(tabs.getByRole('link')).toHaveText(['Organization', 'Time & pay', 'Tracking policies', 'Devices', 'Roles & permissions', 'Access review', 'Security & retention', 'Screenshot retention', 'API keys', 'Webhooks', 'Audit log']);
    await expect(tabs.getByRole('link', { name: 'Organization' })).toHaveAttribute('aria-current', 'page');

    await tabs.getByRole('link', { name: 'Webhooks' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/developer/webhooks$`));
    await expect(tabs.getByRole('link', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');

    await tabs.getByRole('link', { name: 'Devices' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
  });

  test('Schedules & attendance shows both pages as tabs; a member’s profile has no tab bar', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/attendance`);
    const tabs = page.getByRole('navigation', { name: 'Schedules & attendance' });
    await expect(tabs.getByRole('link')).toHaveText(['Schedules', 'Attendance']);
    await expect(tabs.getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page');

    await page.goto(`/o/${data.orgId}/workers/${data.worker.membershipId}`);
    await expect(page.getByRole('navigation', { name: 'Members' })).toHaveCount(0);
    await expect(sidebar(page).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });

  test('personal pages are in the account menu', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'My timesheet' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'What is monitored' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'My pay stubs' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/pay-stubs$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Pay stubs' })).toBeVisible();
  });

  // Audit 28 Oct 2026 (R4): Session history is a tab of Live, with the same access.
  test('Session history is a tab of Live, which stays highlighted', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/tracking/live`);
    await page.getByRole('navigation', { name: 'Live' }).getByRole('link', { name: 'Session history' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/sessions$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Session history' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Live' })).toHaveAttribute('aria-current', 'page');
  });

  test('a running session can be force-stopped from its drawer on Session history', async ({ page, data, adminApi, newcomerDevice }) => {
    const { api, orgApi } = adminApi;
    // The newcomer clocks in from the desktop app (its event, as the app sends it).
    const sessionId = randomUUID();
    const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent_at: new Date().toISOString(), events: [{ event_id: randomUUID(), type: 'session.start', session_id: sessionId, seq: 1, occurred_at: new Date().toISOString(), project_id: data.projects.website.id }] }),
    });
    expect(res.status).toBe(200);
    try {
      await page.goto(`/o/${data.orgId}/sessions`);
      await page.getByRole('row', { name: new RegExp(`${data.newcomer.name}.*Running`) }).first().click();
      const drawer = page.getByRole('dialog', { name: new RegExp(data.projects.website.name) });
      await drawer.getByRole('button', { name: 'Force stop' }).click();
      await page.getByRole('button', { name: 'Stop timer' }).click();
      await expect(page.getByText(`Stopped ${data.newcomer.name}'s timer`)).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Force stop' })).toHaveCount(0);
      const s = await ok<{ state: string; end_reason: string }>(await api.get(orgApi(`/sessions/${sessionId}`)), 'session');
      expect(s).toMatchObject({ state: 'STOPPED', end_reason: 'ADMIN' });
    } finally {
      await api.post(orgApi(`/sessions/${sessionId}/force-stop`), { data: {} });
    }
  });

  test('rate fields on a project explain priority the same way and link to all rates', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/projects`);
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog.getByText(/Rates set here start today\. Pay rate overrides client and organization rates; member-on-project and member rates still win\./)).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'See all rates, or set a future date →' })).toHaveAttribute('href', `/o/${data.orgId}/finance/billing`);
  });
});

test.describe('A restricted role', () => {
  test.use({ storageState: VIEWER_STATE });

  test('sees only what it can open: no Settings, and no personal timesheet in the menu', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const nav = sidebar(page);
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Members' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'What is monitored' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'My timesheet' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'My pay stubs' })).toHaveCount(0);
  });
});
