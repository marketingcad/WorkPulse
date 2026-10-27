import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { LIVE_DATA, LIVE_STATE, type LiveData } from './env';

/**
 * Signs the dedicated live test account in once per run (rate limits are on in production) and
 * saves the session for the signed-in specs. This sign-in is the only write the live suite makes.
 */
setup('sign in the live test account', async ({ page }) => {
  const email = process.env.LIVE_EMAIL;
  const password = process.env.LIVE_PASSWORD;
  if (!email || !password) throw new Error('Set LIVE_EMAIL and LIVE_PASSWORD to a dedicated test account (see e2e/README.md, "Live smoke").');

  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page, 'the test account must not require two-factor sign-in').toHaveURL(/\/o\/[^/?#]+/);
  const orgId = process.env.LIVE_ORG_ID ?? new URL(page.url()).pathname.split('/')[2]!;
  const data: LiveData = { orgId };
  mkdirSync(path.dirname(LIVE_DATA), { recursive: true });
  writeFileSync(LIVE_DATA, JSON.stringify(data));
  await page.context().storageState({ path: LIVE_STATE });
});
