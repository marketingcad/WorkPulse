import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * Client portal: an admin turns the portal on for a client and invites a viewer; the viewer accepts
 * and sees the client's dashboard (brand header, totals, projects). Also: signed-out visitors are sent
 * to sign in, and the admin's "Preview as client" shows the same dashboard.
 */
test.describe('Client portal', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an invited client viewer opens their dashboard', { tag: '@smoke' }, async ({ browser, data, adminApi }) => {
    const client = `Portal Client ${uid()}`;
    const project = `Portal Project ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');
    await ok(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: project, client_id: c.id, member_ids: [data.worker.membershipId] } }), 'project');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true, sections: { hours: true, tasks: true, activity: false, screenshots: false } } }), 'portal settings');
    const email = `viewer+${uid()}@e2e.test`;
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi(`/clients/${c.id}/portal/invitations`), { data: { email, name: 'Vic Viewer' } }), 'portal invite');

    // A brand-new browser for the viewer: the invitation link, a name and a password.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const link = new URL(invite.invite_url);
    await page.goto(link.pathname + link.search);
    await page.getByLabel('Your name').fill('Vic Viewer');
    await page.getByLabel('Choose a password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open dashboard' }).click();

    await expect(page.getByRole('heading', { level: 1, name: client })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Client dashboard')).toBeVisible();
    await expect(page.getByText('Hours this period')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByText(project)).toBeVisible();
    await expect(page.getByLabel('From')).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toBeVisible();
    await context.close();
  });

  test('a signed-out visitor is sent to sign in', async () => {
    const ctx = await request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] } });
    const r = await ctx.get('/api/v1/portal');
    expect(r.status()).toBe(401);
    await ctx.dispose();
  });

  test('the admin preview shows the client dashboard', async ({ page, data, adminApi }) => {
    const client = `Preview Client ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true } }), 'portal settings');
    await page.goto(`/o/${data.orgId}/clients/${c.id}/portal`);
    await page.getByRole('button', { name: 'Preview as client' }).click();
    // Inside the admin page the dashboard title is a second-level heading: one h1 per page.
    await expect(page.getByRole('heading', { level: 2, name: client })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: client })).toHaveCount(1);
    await expect(page.getByText('Hours this period')).toBeVisible();
  });
});
