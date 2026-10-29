import { expect, test, uid } from '../../../support/fixtures';
import { PASSWORD } from '../../../support/env';

/**
 * QA: the signed-out pages (sign-up, invitation, email confirmation, password reset). Sign-up is
 * rate-limited per address as in production, so this file signs up at most twice.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Validator wording that must never reach a person (zod's default messages). */
const RAW_VALIDATOR = /Too small|Too big|expected string|Invalid input|>=\s?\d/;

test.describe('QA · Sign-up', () => {
  test('a new owner creates an organization and lands in it', { tag: '@smoke' }, async ({ page }) => {
    const email = `qa-owner-${uid()}@example.test`;
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: 'Create your organization' })).toBeVisible();
    await page.getByLabel('Your name').fill('Quinn Owner');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Organization name').fill(`QA Studio ${uid()}`);
    await page.getByRole('button', { name: 'Create organization' }).click();

    // Without a mail provider the account opens straight away; with one, it asks to confirm the email.
    await expect(page.getByRole('heading', { level: 1, name: /Overview|Check your email/ })).toBeVisible();
    if (/\/o\//.test(page.url())) await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
    else await expect(page.getByText(email)).toBeVisible();
  });

  // Every submission counts towards the sign-up rate limit (as in production), so the validation
  // checks share as few submissions as possible.
  test('an empty form, then a short password, are refused field by field and nothing is created', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create organization' }).click();
    const alerts = page.getByRole('alert').filter({ hasText: /./ });
    await expect(alerts).toHaveCount(3);
    await expect(alerts.nth(1)).toHaveText('This field is required');
    await expect(alerts.nth(2)).toHaveText('Use at least 10 characters');

    await page.getByLabel('Your name').fill('Short Pass');
    await page.getByLabel('Work email').fill(`qa-short-${uid()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(alerts).toHaveText(['Use at least 10 characters']);
    await expect(page).toHaveURL(/\/signup/);
  });

  test('errors are written for people and tied to their field', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText('Enter a valid email address, like name@example.com')).toBeVisible();
    // Both rules are checked even if the first one fails.
    await expect.soft(page.getByRole('main'), 'raw validator text').not.toContainText(RAW_VALIDATOR);
    const email = page.getByLabel('Work email');
    await expect.soft(email, 'aria-invalid').toHaveAttribute('aria-invalid', 'true');
    await expect.soft(email, 'error linked to the field').toHaveAccessibleDescription(/Enter a valid email address/);
  });

  test('signing up with an address that already has an account does not open that account', async ({ page, data }) => {
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Someone Else');
    await page.getByLabel('Work email').fill(data.admin.email);
    await page.getByLabel('Password', { exact: true }).fill(`${PASSWORD}-other`);
    await page.getByRole('button', { name: 'Create organization' }).click();
    // Either a clear refusal or the neutral "check your email" screen; never the existing workspace.
    await expect(page.getByRole('alert').filter({ hasText: /./ }).or(page.getByRole('heading', { name: 'Check your email' })).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(data.orgId));
    await page.goto(`/o/${data.orgId}`);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('QA · Links from emails', () => {
  const badToken = 'x'.repeat(43);

  test('an invalid or expired confirmation link says so', async ({ page }) => {
    await page.goto(`/verify-email?token=${badToken}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
    await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
    await expect(page.getByText('Your email is confirmed.')).toHaveCount(0);
  });

  test('an invalid invitation link does not create an account', async ({ page }) => {
    await page.goto(`/invite?token=${badToken}`);
    await expect(page.getByRole('heading', { level: 1, name: 'You have been invited' })).toBeVisible();
    await page.getByLabel('Your name').fill('Ivy Intruder');
    await page.getByLabel('Choose a password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Join organization' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveText('This invitation is invalid or has expired');
    await expect(page).toHaveURL(/\/invite/);
  });

  test('a malformed password reset link shows a readable message', async ({ page }) => {
    await page.goto('/reset-password?token=not-a-real-token');
    await page.getByLabel('New password').fill(`${PASSWORD}-new`);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText(/invalid|expired/i).first()).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(RAW_VALIDATOR);
  });

  test('a well-formed but unknown reset link is refused', async ({ page }) => {
    await page.goto(`/reset-password?token=${badToken}`);
    await page.getByLabel('New password').fill(`${PASSWORD}-new`);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
    await expect(page.getByText('Password updated.')).toHaveCount(0);
  });
});
