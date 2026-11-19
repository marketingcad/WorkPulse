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
    // BUG-27: the dashboard is the page's one main landmark, and "Skip to content" lands on it.
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('main')).toContainText(client);
    // On a fresh load (after signing in the app navigates in place, so focus is not at the top).
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: client })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await context.close();
  });

  // QA audit 13 Nov 2026 (BUG-22): a cleared, reversed or too-long period replaced the whole dashboard
  // with an error whose "Try again" sent the same period again, so the client was stuck.
  test('a wrong period is explained beside the dates, and the dashboard stays', async ({ browser, data, adminApi }) => {
    const client = `Portal Range ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');
    await ok(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Range Project ${uid()}`, client_id: c.id, member_ids: [data.worker.membershipId] } }), 'project');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true } }), 'portal settings');
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi(`/clients/${c.id}/portal/invitations`), { data: { email: `viewer+${uid()}@e2e.test` } }), 'portal invite');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const link = new URL(invite.invite_url);
    await page.goto(link.pathname + link.search);
    await page.getByLabel('Your name').fill('Rae Range');
    await page.getByLabel('Choose a password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open dashboard' }).click();
    const heading = page.getByRole('heading', { level: 1, name: client });
    await expect(heading).toBeVisible({ timeout: 20_000 });

    const from = page.getByLabel('From');
    const to = page.getByLabel('To', { exact: true });
    const problem = page.getByRole('alert').filter({ hasText: 'The dashboard still shows the last period.' });
    const stuck = page.getByRole('button', { name: /try again/i });
    // The server must never be asked for a period it refuses.
    const refused: string[] = [];
    page.on('response', (r) => r.url().includes('/summary') && r.status() === 400 && refused.push(r.url()));

    await from.fill('');
    await expect(problem).toHaveText('Enter both dates. The dashboard still shows the last period.');
    await expect(heading).toBeVisible();
    await from.fill('2030-01-31');
    await to.fill('2030-01-01');
    await expect(problem).toHaveText('The start date is after the end date. The dashboard still shows the last period.');
    await from.fill('2029-09-01');
    await expect(problem).toHaveText('Choose a period of up to 93 days. The dashboard still shows the last period.');
    await expect(heading).toBeVisible();
    await expect(stuck).toHaveCount(0);
    await expect(from).toHaveAttribute('aria-invalid', 'true');

    // A valid period applies at once and the message goes away.
    const loaded = page.waitForResponse((r) => r.url().includes('/summary?from=2029-12-01&to=2030-01-01') && r.status() === 200);
    await from.fill('2029-12-01');
    await loaded;
    await expect(problem).toHaveCount(0);
    await expect(heading).toBeVisible();
    expect(refused).toEqual([]);
    await context.close();
  });

  // QA audit 13 Nov 2026 (BUG-19): a client invited while the portal was off landed on
  // "dashboard not found · Request … · Try again", and the owner was not warned.
  test('inviting to a portal that is off warns the owner, and the client is told it is not on yet', async ({ page, browser, data, adminApi }) => {
    const client = `Portal Off ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');

    // The owner's page says the portal is off, before and after inviting.
    await page.goto(`/o/${data.orgId}/clients/${c.id}/portal`);
    await expect(page.getByRole('note').filter({ hasText: 'The portal is off. People you invite can sign in, but they see nothing until you turn it on.' })).toBeVisible();
    const email = `viewer+${uid()}@e2e.test`;
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByText('Invitation sent. Turn the portal on so they can see it.')).toBeVisible();
    const access = await ok<{ access: Array<{ email: string; invite_url?: string }> }>(await adminApi.api.get(adminApi.orgApi(`/clients/${c.id}/portal`)), 'portal');
    expect(access.access.map((a) => a.email)).toContain(email);

    // The page does not show invitation links, so the viewer who joins is invited through the API.
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi(`/clients/${c.id}/portal/invitations`), { data: { email: `viewer+${uid()}@e2e.test` } }), 'portal invite');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const viewer = await context.newPage();
    const link = new URL(invite.invite_url);
    await viewer.goto(link.pathname + link.search);
    await viewer.getByLabel('Your name').fill('Otto Offline');
    await viewer.getByLabel('Choose a password').fill(PASSWORD);
    await viewer.getByRole('button', { name: 'Open dashboard' }).click();
    await expect(viewer.getByRole('heading', { level: 1, name: 'This dashboard is not switched on yet' })).toBeVisible({ timeout: 20_000 });
    await expect(viewer.getByText(/Keep this link: it opens the dashboard as soon as they do\./)).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(viewer.getByText(/not found|Request /)).toHaveCount(0);

    // Switched on: the same page opens the dashboard.
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true } }), 'portal on');
    await viewer.reload();
    await expect(viewer.getByRole('heading', { level: 1, name: client })).toBeVisible({ timeout: 20_000 });
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
