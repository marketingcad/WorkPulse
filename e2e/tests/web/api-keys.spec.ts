import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Developer › API keys: a key is shown once, works only within its scopes, and stops working the
 * moment it is revoked. Only people who manage API keys see the page or reach its API.
 */

/** A client of the public API, as an integration would call it: the key only, no browser session. */
const keyClient = (key: string) => request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { Authorization: `Bearer ${key}` } });

test.describe('API keys (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('creates a key, shows it once, it works only within its scopes, and revoking it stops it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const name = `Sync ${uid()}`;
    await page.goto(`/o/${data.orgId}/developer/api-keys`);
    await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
    await page.getByRole('button', { name: 'Create API key' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create API key' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('checkbox', { name: /^read:projects/ }).check();
    await expect(dialog.getByLabel('Expires')).toHaveValue('90');
    await dialog.getByRole('button', { name: 'Create key' }).click();

    const shown = page.getByRole('dialog', { name: 'API key created' });
    await expect(shown).toContainText('it will not be shown again');
    const secret = (await shown.locator('code').first().innerText()).trim();
    expect(secret).toMatch(/^tw_live_/);
    await shown.getByRole('button', { name: 'I have stored the key' }).click();
    await expect(shown).toBeHidden();

    // The list shows the name and prefix, never the secret.
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('read:projects');
    await expect(row).toContainText('Active');
    await expect(page.getByText(secret)).toHaveCount(0);
    const listed = await ok<Array<Record<string, unknown>>>(await adminApi.api.get(adminApi.orgApi('/api-keys')), 'keys');
    expect(JSON.stringify(listed)).not.toContain(secret);

    // Within its scope it works; outside it, it is refused.
    const client = await keyClient(secret);
    expect((await client.get(`/api/v1/orgs/${data.orgId}/projects`)).status()).toBe(200);
    for (const res of [await client.get(`/api/v1/orgs/${data.orgId}/workers`), await client.post(`/api/v1/orgs/${data.orgId}/projects`, { data: { name: `By key ${uid()}` } })]) {
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain('does not have a scope for this endpoint');
    }

    // Revoke asks first; afterwards the key is refused at once.
    await row.getByRole('button', { name: `Revoke ${name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Revoke API key?' }).or(page.getByRole('dialog', { name: 'Revoke API key?' }));
    await expect(confirm).toContainText(`Integrations using “${name}”`);
    await confirm.getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.getByText('API key revoked')).toBeVisible();
    await expect(row).toContainText('Revoked');
    await expect(row.getByRole('button', { name: `Revoke ${name}` })).toHaveCount(0);
    expect((await client.get(`/api/v1/orgs/${data.orgId}/projects`)).status()).toBe(401);
    await client.dispose();
  });

  test('a key needs a name, at least one scope, and a date when expiry is "On a date"', async ({ page, data, adminApi }) => {
    const name = `Never created ${uid()}`;
    await page.goto(`/o/${data.orgId}/developer/api-keys`);
    await page.getByRole('button', { name: 'Create API key' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create API key' });
    const create = dialog.getByRole('button', { name: 'Create key' });
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    await expect(create).toBeDisabled(); // no scope yet
    await dialog.getByRole('checkbox', { name: /^read:clients/ }).check();
    await expect(create).toBeEnabled();
    await dialog.getByLabel('Expires').selectOption('custom');
    await expect(create).toBeDisabled(); // no date yet
    await dialog.getByLabel('Expires').selectOption('never');
    await expect(dialog.getByText('Keys without an expiry should be rotated manually at least once a year.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const keys = await ok<Array<{ name: string }>>(await adminApi.api.get(adminApi.orgApi('/api-keys')), 'keys');
    expect(keys.some((k) => k.name === name)).toBe(false);
  });

  test('the server refuses a key without scopes or with an unknown scope', async ({ adminApi }) => {
    expect((await adminApi.api.post(adminApi.orgApi('/api-keys'), { data: { name: `Empty ${uid()}`, scopes: [], expires_at: null } })).status()).toBe(400);
    expect((await adminApi.api.post(adminApi.orgApi('/api-keys'), { data: { name: `Odd ${uid()}`, scopes: ['admin:everything'], expires_at: null } })).status()).toBe(400);
  });

  test('shows an error with a retry when the keys cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/api-keys`, (route) =>
      fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) }) : route.continue(),
    );
    await page.goto(`/o/${data.orgId}/developer/api-keys`);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toHaveCount(0);
  });
});

test.describe('API keys are only for people who manage them', () => {
  for (const [who, state] of [['a team manager', MANAGER_STATE], ['a custom role without API key access', VIEWER_STATE]] as const) {
    test(`${who} is told they cannot see the page, and the API refuses them`, async ({ browser, data }) => {
      const ctx = await browser.newContext({ storageState: state });
      const page = await ctx.newPage();
      await page.goto(`/o/${data.orgId}/developer/api-keys`);
      await expect(page.getByText('Restricted')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create API key' })).toHaveCount(0);
      const api = await request.newContext({ baseURL: WEB_URL, storageState: state, extraHTTPHeaders: { Origin: WEB_URL } });
      expect((await api.get(`/api/v1/orgs/${data.orgId}/api-keys`)).status()).toBe(403);
      expect((await api.post(`/api/v1/orgs/${data.orgId}/api-keys`, { data: { name: `Sneaky ${uid()}`, scopes: ['read:projects'], expires_at: null } })).status()).toBe(403);
      await Promise.all([api.dispose(), ctx.close()]);
    });
  }
});
