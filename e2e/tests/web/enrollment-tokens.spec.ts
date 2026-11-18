import { request } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * Enrollment tokens (managed installs): an admin creates a token on the Devices page and sees it once,
 * with setup lines for each system; a computer signing in with it joins the organization (marked
 * Managed); revoking refuses new sign-ins. Device approval stays off here: the shared organization's
 * other specs sign devices in. The approval-required case is covered by the API tests.
 */
test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const tokenName = `Head office ${run}`;
const deviceName = `Managed-PC-${run}`;
let token = '';

test('an admin creates a token, sees it once, and a computer joins with it', { tag: '@smoke' }, async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/devices`);
  await expect(page.getByRole('heading', { name: 'Enrollment tokens' })).toBeVisible();

  // Create: the name is required.
  await page.getByRole('button', { name: 'New token' }).first().click();
  const create = page.getByRole('dialog', { name: 'New enrollment token' });
  await expect(create.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await create.getByLabel(/^Name/).fill(tokenName);
  await create.getByRole('button', { name: 'Create token' }).click();

  // Shown once, with setup lines for Windows by default and the other systems on request.
  const shown = page.getByRole('dialog', { name: `Token created: ${tokenName}` });
  await expect(shown.getByText('it is shown only once', { exact: false })).toBeVisible();
  token = ((await shown.getByLabel('Enrollment token', { exact: true }).textContent()) ?? '').trim();
  expect(token).toMatch(/^wpe_[A-Za-z0-9_-]{43}$/);
  await expect(shown.getByText(`/v EnrollmentToken /t REG_SZ /d ${token}`, { exact: false })).toBeVisible();
  await shown.getByRole('radio', { name: 'Linux' }).click();
  await expect(shown.getByText('"enrollmentToken"', { exact: false })).toBeVisible();
  await shown.getByRole('button', { name: 'Done' }).click();

  // Listed by name and prefix, never the secret.
  const row = page.getByRole('row', { name: new RegExp(tokenName) });
  await expect(row).toContainText(`wpe_${token.slice(4, 12)}…`);
  await expect(row).toContainText('Active');
  await expect(page.getByText(token.slice(12))).toHaveCount(0);

  // A computer signs in with its own account and the token: joined, marked Managed, counted.
  const agent = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const r = await agent.post('/api/v1/agent/login', { data: { email: data.newcomer.email, password: PASSWORD, enrollment_token: token, device: { name: deviceName, platform: 'windows', agent_version: '0.3.0' } } });
  expect(r.status()).toBe(201);
  const body = await r.json();
  expect(body).toMatchObject({ organization_id: data.orgId, status: 'ACTIVE' });
  await agent.dispose();

  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(tokenName) })).toContainText('1');
  const search = page.getByLabel('Search devices');
  if (await search.isVisible()) await search.fill(deviceName);
  await expect(page.getByRole('row', { name: new RegExp(deviceName) })).toContainText('Managed');
});

test('a wrong password with the token still signs no one in', async () => {
  const agent = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const r = await agent.post('/api/v1/agent/login', { data: { email: `nobody-${run}@e2e.test`, password: 'wrong-password-1', enrollment_token: token, device: { name: 'x', platform: 'windows', agent_version: '0.3.0' } } });
  expect(r.status()).toBe(401);
  await agent.dispose();
});

test('revoking asks first, then refuses new sign-ins with the IT message', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/devices`);
  await page.getByRole('button', { name: `Revoke ${tokenName}` }).click();
  const confirm = page.getByRole('dialog', { name: `Revoke ${tokenName}?` });
  await expect(confirm).toContainText('Computers already set up with it keep working');
  await confirm.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText(`${tokenName} revoked`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(tokenName) })).toContainText('Revoked');
  await expect(page.getByRole('button', { name: `Revoke ${tokenName}` })).toHaveCount(0);

  const agent = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const r = await agent.post('/api/v1/agent/login', { data: { email: data.newcomer.email, password: PASSWORD, enrollment_token: token, device: { name: deviceName, platform: 'windows', agent_version: '0.3.0' } } });
  expect(r.status()).toBe(401);
  expect((await r.json()).title).toBe('This computer’s enrollment token is no longer valid. Ask your IT team.');
  await agent.dispose();
});

test.describe('who must not manage tokens', () => {
  test.use({ storageState: MANAGER_STATE });

  test('a manager sees devices but no enrollment tokens, and the API refuses them', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/devices`);
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enrollment tokens' })).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await api.get(`/api/v1/orgs/${data.orgId}/enrollment-tokens`)).status()).toBe(403);
    expect((await api.post(`/api/v1/orgs/${data.orgId}/enrollment-tokens`, { data: { name: 'x' } })).status()).toBe(403);
    await api.dispose();
  });
});
