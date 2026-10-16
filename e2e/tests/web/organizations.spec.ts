import { readFile } from 'node:fs/promises';
import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Organizations and the audit log: creating another organization from the switcher, signing in
 * back to the last workspace used, and paging and exporting the audit log.
 */

const unique = (prefix: string, run: string) => `${prefix} ${run} ${uid()}`;

test.describe('New organization (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin creates another organization from the switcher and lands in it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const name = unique('Second Studio', data.run);
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Switch organization' }).click();
    await page.getByRole('menuitem', { name: 'New organization' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create another organization' });
    const create = dialog.getByRole('button', { name: 'Create organization' });
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Organization name').fill(name);
    await dialog.getByLabel('Time zone').selectOption('Europe/Lisbon');
    await dialog.getByLabel('Currency').selectOption('EUR');
    await create.click();

    // The page starts in the shared organization, so wait until it has moved to the new one.
    await expect(page).not.toHaveURL(new RegExp(data.orgId));
    await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}$/);
    const newId = page.url().split('/o/')[1]!;
    await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(name);

    const ctx = await ok<{ organization: { timezone: string; currency: string }; membership: { role_name: string } }>(await adminApi.api.get(`/api/v1/orgs/${newId}`), 'new org');
    expect(ctx.organization).toMatchObject({ timezone: 'Europe/Lisbon', currency: 'EUR' });

    // Both organizations are in the switcher; going back works.
    await page.getByRole('button', { name: 'Switch organization' }).click();
    await page.getByRole('menuitem', { name: data.orgName }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}`));
  });
});

test.describe('Getting started (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a new organization shows a setup checklist that ticks steps off from real data and can be hidden', async ({ page, data, adminApi }) => {
    const org = await ok<{ organization_id: string }>(await adminApi.api.post('/api/v1/me/organizations', { data: { name: unique('Fresh Org', data.run) } }), 'new org');
    const orgId = org.organization_id;
    await page.goto(`/o/${orgId}`);
    const checklist = page.getByRole('list', { name: 'Getting started' });
    await expect(page.getByText('Get started: 0 of 5 done')).toBeVisible();
    for (const step of ['Invite your team', 'Create a project', 'Set pay and bill rates', 'Connect the desktop app', 'Review what is tracked']) await expect(checklist.getByRole('link', { name: `${step} (to do)` })).toBeVisible();

    // Creating a project ticks that step off.
    await ok(await adminApi.api.post(`/api/v1/orgs/${orgId}/projects`, { data: { name: 'First project' } }), 'project');
    await page.reload();
    await expect(page.getByText('Get started: 1 of 5 done')).toBeVisible();
    await expect(checklist.getByRole('link', { name: 'Create a project (done)' })).toBeVisible();

    // Each step links to where it is done.
    await checklist.getByRole('link', { name: /Invite your team/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

    // Hidden for good once dismissed.
    await page.goto(`/o/${orgId}`);
    await page.getByRole('button', { name: 'Hide getting started' }).click();
    await expect(checklist).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByText(/Get started:/)).toHaveCount(0);
  });
});

test.describe('Getting started (no admin access)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone who cannot change the organization never sees the setup checklist', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Get started:/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hide getting started' })).toHaveCount(0);
  });
});

test.describe('Signing in to the last workspace', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('someone in two organizations signs in to the one they used last, or the first if it is gone', async ({ browser, data, adminApi }) => {
    // A manager of the shared organization who also owns a second one.
    const email = `mona+${data.run}-${uid()}@e2e.test`;
    const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email, name: 'Mona Manager', role_id: roles.find((r) => r.key === 'TEAM_MANAGER')!.id } }), 'invite');
    const mona = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL }, storageState: { cookies: [], origins: [] } });
    await ok(await mona.post('/api/v1/auth/invitations/accept', { data: { token: new URL(invite.invite_url).searchParams.get('token'), name: 'Mona Manager', password: PASSWORD } }), 'accept');
    const second = await ok<{ organization_id: string }>(await mona.post('/api/v1/me/organizations', { data: { name: unique('Mona Co', data.run) } }), 'second org');
    await mona.dispose();

    // Each sign-in starts in a fresh, signed-out browser that remembers `lastOrg` as the last
    // organization used. A fresh context means no redirect left over from a previous session can
    // interrupt the navigation to /login.
    const signInRemembering = async (lastOrg: string) => {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: WEB_URL, localStorage: [{ name: 'tw.lastOrg', value: lastOrg }] }] } });
      const page = await ctx.newPage();
      await page.goto('/login');
      await page.getByLabel('Work email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      return { ctx, page };
    };

    // The browser remembers the second organization as the last one used.
    const first = await signInRemembering(second.organization_id);
    await expect(first.page).toHaveURL(new RegExp(`/o/${second.organization_id}`));
    await first.ctx.close();

    // A remembered organization they no longer belong to falls back to their first one.
    const stale = await signInRemembering('00000000-0000-7000-8000-000000000000');
    await expect(stale.page).toHaveURL(/\/o\/[0-9a-f-]{36}/);
    expect(stale.page.url()).not.toContain('00000000-0000-7000-8000-000000000000');
    await stale.ctx.close();
  });
});

test.describe('Audit log', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the audit log pages through every entry, sorts both ways and exports them all', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    // A fresh organization with exactly 60 "team.created" entries.
    const org = await ok<{ organization_id: string }>(await adminApi.api.post('/api/v1/me/organizations', { data: { name: unique('Audit Org', data.run) } }), 'audit org');
    const orgId = org.organization_id;
    for (let i = 1; i <= 60; i++) await ok(await adminApi.api.post(`/api/v1/orgs/${orgId}/teams`, { data: { name: `Team ${String(i).padStart(2, '0')}` } }), `team ${i}`);

    await page.goto(`/o/${orgId}/settings/audit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await page.getByLabel('Action starts with').fill('team.');
    await expect(page.getByText('Showing 1–50 of 60 results')).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Showing 51–60 of 60 results')).toBeVisible();

    // Oldest first: the first team ever created leads.
    await page.getByLabel('Order').selectOption('asc');
    await expect(page.getByText('Showing 1–50 of 60 results')).toBeVisible();
    // While a page loads, the previous rows stay on screen (dimmed): wait for the new ones.
    await expect(page.locator('[aria-busy]').filter({ has: page.getByRole('table', { name: 'Audit log' }) })).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('table', { name: 'Audit log' }).getByRole('row').nth(1).click();
    await expect(page.getByRole('dialog')).toContainText('Team 01');
    await page.keyboard.press('Escape');

    // The export has every matching entry, not just the page on screen.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    const csv = (await readFile((await download.path())!)).toString('utf8').replace(/^﻿/, '');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines).toHaveLength(61);
    expect(lines.slice(1).every((l) => l.includes('team.created'))).toBe(true);
  });
});
