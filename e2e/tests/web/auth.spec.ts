import { expect, test } from '../../support/fixtures';
import { PASSWORD, WORKER_STATE } from '../../support/env';

/** Sign-in, protected pages and sign-out. Starts signed out unless a spec says otherwise. */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('signing in', () => {
  test('an admin signs in and lands in their workspace', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Work email').fill(data.admin.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
  });

  test('a wrong password is refused with a clear message', async ({ page, data }) => {
    await page.goto('/login');
    // Not the admin: failed attempts count towards a lockout.
    await page.getByLabel('Work email').fill(data.newcomer.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // (Next.js also renders an empty role=alert route announcer.)
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveText('Email or password is incorrect');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a signed-out visitor is sent to sign in, then back to the page they asked for', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/teams`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Work email').fill(data.admin.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/teams`));
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
  });
});

test.describe('signing out', () => {
  test('signing out ends the session', async ({ page, data }) => {
    // Its own session: signing out the shared admin session would sign out tests running alongside.
    await page.goto('/login');
    await page.getByLabel('Work email').fill(data.admin.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    // The old session no longer opens the workspace.
    await page.goto(`/o/${data.orgId}`);
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});

test.describe('workers use the desktop app', () => {
  test.use({ storageState: WORKER_STATE });

  test('a worker opening the web workspace is sent to the desktop download page', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page).toHaveURL(/\/download/);
    await expect(page.getByRole('heading', { level: 1, name: 'Get the WorkPulse desktop app' })).toBeVisible();
  });
});
