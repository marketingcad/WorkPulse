import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Developer › Webhooks: endpoints receive signed events. The signing secret is shown once, rotating
 * it asks first, and only https addresses that are not private are accepted.
 *
 * Endpoints use example.com (it resolves, as saving requires). No test sends an event: a delivery
 * would be a real request to an outside server, and E2E stays on the isolated test server.
 */
const endpointUrl = () => `https://example.com/workpulse-${uid()}`;
const actions = (page: Page, url: string) => page.getByRole('button', { name: `Actions for ${url}` });

test.describe('Webhooks (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('adds an endpoint, shows its secret once, edits, rotates the secret and deletes it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const url = endpointUrl();
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
    await page.getByRole('button', { name: 'Add endpoint' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    await dialog.getByLabel('Endpoint URL').fill(url);
    await dialog.getByLabel('Description').fill('Payroll sync');
    await dialog.getByRole('checkbox', { name: 'timesheet.approved' }).check();
    await dialog.getByRole('button', { name: 'Add endpoint' }).click();

    const created = page.getByRole('dialog', { name: 'Endpoint created' });
    await expect(created).toContainText('it will not be shown again');
    const secret = (await created.locator('code').first().innerText()).trim();
    expect(secret.length).toBeGreaterThan(20);
    await created.getByRole('button', { name: 'I have stored the secret' }).click();

    const row = page.getByRole('row').filter({ hasText: url });
    await expect(row).toContainText('Payroll sync');
    await expect(row).toContainText('1 event');
    await expect(row).toContainText('Enabled');
    await expect(page.getByText(secret)).toHaveCount(0);
    const listed = await ok<{ endpoints: Array<{ url: string; events: string[] }> }>(await adminApi.api.get(adminApi.orgApi('/webhooks')), 'webhooks');
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed.endpoints.find((e) => e.url === url)!.events).toEqual(['timesheet.approved']);

    // Edit: all events, and paused.
    await actions(page, url).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit endpoint' });
    await expect(edit.getByLabel('Endpoint URL')).toHaveValue(url);
    await edit.getByRole('checkbox', { name: 'All events, including future ones' }).check();
    await expect(edit.getByRole('checkbox', { name: 'timesheet.approved' })).toBeDisabled();
    await edit.getByRole('switch', { name: 'Enabled' }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Endpoint saved')).toBeVisible();
    await expect(row).toContainText('All events');
    await expect(row).toContainText('Disabled');
    // A paused endpoint cannot be sent a test event.
    await actions(page, url).click();
    await expect(page.getByRole('menuitem', { name: 'Send test event' })).toBeDisabled();

    // Rotating asks first, then shows a new secret once.
    await page.getByRole('menuitem', { name: 'Rotate signing secret' }).click();
    const rotate = page.getByRole('alertdialog', { name: 'Rotate signing secret?' }).or(page.getByRole('dialog', { name: 'Rotate signing secret?' }));
    await expect(rotate).toContainText(`The current secret for ${url} stops working straight away.`);
    await rotate.getByRole('button', { name: 'Rotate secret' }).click();
    const fresh = page.getByRole('dialog', { name: 'New signing secret' });
    const next = (await fresh.locator('code').first().innerText()).trim();
    expect(next).not.toBe(secret);
    await fresh.getByRole('button', { name: 'I have stored the secret' }).click();

    // Delete asks first, then the endpoint is gone.
    await actions(page, url).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const del = page.getByRole('alertdialog', { name: 'Delete endpoint?' }).or(page.getByRole('dialog', { name: 'Delete endpoint?' }));
    await expect(del).toContainText(`WorkPulse will stop sending events to ${url}.`);
    await del.getByRole('button', { name: 'Delete endpoint' }).click();
    await expect(page.getByText('Endpoint deleted')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: url })).toHaveCount(0);
  });

  test('an endpoint needs an https address and at least one event', async ({ page, data, adminApi }) => {
    const url = endpointUrl();
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    await page.getByRole('button', { name: 'Add endpoint' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    const add = dialog.getByRole('button', { name: 'Add endpoint' });
    await dialog.getByLabel('Endpoint URL').fill(url.replace('https://', 'http://'));
    await expect(dialog.getByText('Use a full https:// URL')).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'timesheet.approved' }).check();
    await expect(add).toBeDisabled();
    await dialog.getByLabel('Endpoint URL').fill(url);
    await expect(dialog.getByText('Use a full https:// URL')).toHaveCount(0);
    await expect(add).toBeEnabled();
    await dialog.getByRole('checkbox', { name: 'timesheet.approved' }).uncheck();
    await expect(add).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const listed = await ok<{ endpoints: Array<{ url: string }> }>(await adminApi.api.get(adminApi.orgApi('/webhooks')), 'webhooks');
    expect(listed.endpoints.some((e) => e.url === url)).toBe(false);
  });

  test('the server refuses plain http and private addresses', async ({ adminApi }) => {
    for (const url of ['http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest/meta-data']) {
      const res = await adminApi.api.post(adminApi.orgApi('/webhooks'), { data: { url, description: null, events: ['timesheet.approved'], enabled: true } });
      expect(res.status(), url).toBe(400);
    }
  });

  test('an endpoint with no deliveries says so, and suggests a test event', async ({ page, data, adminApi }) => {
    const url = endpointUrl();
    await ok(await adminApi.api.post(adminApi.orgApi('/webhooks'), { data: { url, description: null, events: ['*'], enabled: true } }), 'endpoint');
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    await page.getByRole('row').filter({ hasText: url }).click();
    const drawer = page.getByRole('dialog', { name: 'Deliveries' });
    await expect(drawer).toContainText(url);
    await expect(drawer.getByText('No deliveries yet')).toBeVisible();
    await expect(drawer.getByText('Send a test event from the endpoint menu to check your integration.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('shows an error with a retry when the endpoints cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/webhooks`, (route) =>
      fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) }) : route.continue(),
    );
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toHaveCount(0);
  });
});

test.describe('Webhooks are only for people who manage them', () => {
  for (const [who, state] of [['a team manager', MANAGER_STATE], ['a custom role without webhook access', VIEWER_STATE]] as const) {
    test(`${who} is told they cannot see the page, and the API refuses them`, async ({ browser, data }) => {
      const ctx = await browser.newContext({ storageState: state });
      const page = await ctx.newPage();
      await page.goto(`/o/${data.orgId}/developer/webhooks`);
      await expect(page.getByText('Restricted')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add endpoint' })).toHaveCount(0);
      const api = await request.newContext({ baseURL: WEB_URL, storageState: state, extraHTTPHeaders: { Origin: WEB_URL } });
      expect((await api.get(`/api/v1/orgs/${data.orgId}/webhooks`)).status()).toBe(403);
      expect((await api.post(`/api/v1/orgs/${data.orgId}/webhooks`, { data: { url: endpointUrl(), description: null, events: ['*'], enabled: true } })).status()).toBe(403);
      await Promise.all([api.dispose(), ctx.close()]);
    });
  }
});
