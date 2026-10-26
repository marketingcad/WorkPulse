import type { Page } from '@playwright/test';
import { expect, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL } from '../../support/env';
import { totpNow } from '../../support/totp';

/**
 * Two-factor sign-in: setup with a QR code, recovery codes, sign-in with the second step, and the
 * owner's reset. Uses a brand-new organization owner, so the shared test accounts never get 2FA.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function newOwner(page: Page) {
  const email = `tfa+${uid()}@e2e.test`;
  const su = await page.request.post('/api/v1/auth/signup', { headers: { Origin: WEB_URL }, data: { name: 'Tess Owner', email, password: PASSWORD, organization_name: `2FA ${uid()}`, timezone: 'UTC' } });
  expect(su.status()).toBe(201);
  await page.request.patch('/api/v1/me', { headers: { Origin: WEB_URL }, data: { tour: 'done' } });
  return { email, orgId: (await su.json()).organization_id as string };
}

test.describe('two-factor sign-in', () => {
  test('an owner sets it up with the QR code, saves the recovery codes and signs in with the second step', { tag: '@smoke' }, async ({ page }) => {
    const { email, orgId } = await newOwner(page);
    await page.goto(`/o/${orgId}/me/profile#two-factor`);
    const panel = page.locator('#two-factor');
    await expect(panel.getByText('Off', { exact: true })).toBeVisible();

    // Setup asks for the password; a wrong one is refused next to the field.
    await panel.getByRole('button', { name: 'Set up' }).click();
    await panel.getByLabel('Password').fill('not-my-password');
    await panel.getByRole('button', { name: 'Continue' }).click();
    await expect(panel.getByText('Incorrect password')).toBeVisible();
    await panel.getByLabel('Password').fill(PASSWORD);
    await panel.getByRole('button', { name: 'Continue' }).click();

    // The QR code (drawn by our server) and the key to type by hand.
    await expect(panel.getByRole('img', { name: 'QR code to add WorkPulse to your authenticator app' })).toBeVisible();
    const key = (await panel.locator('code').first().textContent())!.replace(/\s/g, '');
    expect(key).toMatch(/^[A-Z2-7]{32}$/);
    await test.info().attach('two-factor-setup', { body: await page.screenshot(), contentType: 'image/png' });

    // A wrong code, then the right one.
    await panel.getByLabel('Code', { exact: true }).fill('000000');
    await panel.getByRole('button', { name: 'Turn on' }).click();
    await expect(panel.getByText(/That code is not valid/)).toBeVisible();
    await panel.getByLabel('Code', { exact: true }).fill(totpNow(key));
    await panel.getByRole('button', { name: 'Turn on' }).click();

    // Recovery codes, shown once; "Done" waits for the person to confirm they saved them.
    const codes = (await panel.locator('pre, code').filter({ hasText: /[a-z2-9]{5}-[a-z2-9]{5}/ }).first().textContent())!.match(/[a-z2-9]{5}-[a-z2-9]{5}/g)!;
    expect(codes).toHaveLength(10);
    await expect(panel.getByRole('button', { name: 'Done' })).toBeDisabled();
    await panel.getByLabel('I have saved these codes somewhere safe').check();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel.getByText('On', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Replace authenticator app' })).toBeVisible();

    // Signing in now needs the second step. A wrong code is refused; a recovery code works.
    await page.request.post('/api/v1/auth/logout', { headers: { Origin: WEB_URL } });
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Open your authenticator app and enter the 6-digit code for WorkPulse.')).toBeVisible();
    await page.getByLabel('Authentication code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('That code is not valid')).toBeVisible();
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill(codes[0]!);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });

  test('turning it off asks for the password and a code', async ({ page }) => {
    const { orgId } = await newOwner(page);
    await page.goto(`/o/${orgId}/me/profile#two-factor`);
    const panel = page.locator('#two-factor');
    await panel.getByRole('button', { name: 'Set up' }).click();
    await panel.getByLabel('Password').fill(PASSWORD);
    await panel.getByRole('button', { name: 'Continue' }).click();
    const key = (await panel.locator('code').first().textContent())!.replace(/\s/g, '');
    await panel.getByLabel('Code', { exact: true }).fill(totpNow(key));
    await panel.getByRole('button', { name: 'Turn on' }).click();
    const codes = (await panel.locator('pre, code').filter({ hasText: /[a-z2-9]{5}-[a-z2-9]{5}/ }).first().textContent())!.match(/[a-z2-9]{5}-[a-z2-9]{5}/g)!;
    await panel.getByLabel('I have saved these codes somewhere safe').check();
    await panel.getByRole('button', { name: 'Done' }).click();

    await panel.getByRole('button', { name: 'Turn off' }).click();
    const submit = panel.getByRole('button', { name: 'Turn off' });
    await expect(submit).toBeDisabled(); // password and code both needed
    await panel.getByLabel('Password').fill(PASSWORD);
    await panel.getByLabel('Code from your authenticator app, or a recovery code').fill(codes[1]!);
    await submit.click();
    await expect(page.getByText('Two-factor authentication is off. Your other sessions were signed out.')).toBeVisible();
    await expect(panel.getByText('Off', { exact: true })).toBeVisible();
  });
});

test.describe('owner reset', () => {
  test.use({ storageState: ADMIN_STATE });

  test('only the owner sees "Reset two-factor" on a member, and it asks for their password', async ({ page, browser, data }) => {
    // The shared admin is the organization's owner.
    await page.goto(`/o/${data.orgId}/workers/${data.newcomer.membershipId}`);
    await page.getByRole('button', { name: 'Reset two-factor' }).click();
    const dialog = page.getByRole('dialog', { name: `Reset two-factor for ${data.newcomer.name}?` });
    await expect(dialog.getByRole('button', { name: 'Reset two-factor' })).toBeDisabled();
    await dialog.getByLabel('Your password').fill('not-the-owner-password');
    await dialog.getByRole('button', { name: 'Reset two-factor' }).click();
    await expect(dialog.getByText('Incorrect password')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // A member who is not the owner (the budget viewer can open their own profile) never sees it.
    const viewer = await browser.newContext({ storageState: VIEWER_STATE });
    const vp = await viewer.newPage();
    await vp.goto(`/o/${data.orgId}/workers/${data.viewer.membershipId}`);
    await expect(vp.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(vp.getByRole('button', { name: 'Reset two-factor' })).toHaveCount(0);
    await viewer.close();
  });
});
