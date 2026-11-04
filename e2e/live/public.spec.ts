import { expect, test } from './fixtures';

/** What a signed-out visitor and an uptime check see. Needs no account. */
test.use({ storageState: { cookies: [], origins: [] } });

test('the API answers its health and readiness checks', { tag: '@smoke' }, async ({ request }) => {
  const health = await request.get('/api/v1/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true });

  // Readiness also checks the database.
  const ready = await request.get('/api/v1/health/ready');
  expect(ready.status()).toBe(200);
});

test('the sign-in page renders', { tag: '@smoke' }, async ({ page, crashes }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
  await expect(page.getByLabel('Work email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await expect(page.getByText('demo-password-123')).toHaveCount(0);
  expect(crashes).toEqual([]);
});

test('a signed-out visitor asking for a workspace page is sent to sign in', async ({ page }) => {
  await page.goto('/o/not-an-org/teams');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
});

test('the signed-out API refuses workspace data', async ({ request }) => {
  const res = await request.get('/api/v1/me');
  expect(res.status()).toBe(401);
});
