import { request } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * A system admin shows or hides the desktop app's "What WorkPulse records" card for the whole
 * organization, from Settings › Tracking policies. Hidden by default; saved as soon as it is switched.
 */
test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const setting = async (api: import('@playwright/test').APIRequestContext, orgId: string) =>
  (await ok<{ organization: { settings: { showMonitoringCard?: boolean } } }>(await api.get(`/api/v1/orgs/${orgId}`), 'org')).organization.settings.showMonitoringCard === true;

test.afterAll(async ({ data }) => {
  // Back to the default (hidden), as the other desktop specs expect.
  const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  await api.patch(`/api/v1/orgs/${data.orgId}`, { data: { settings: { showMonitoringCard: false } } });
  await api.dispose();
});

test('an admin turns the card on and off, and the desktop app is told', { tag: '@smoke' }, async ({ page, data, adminApi, workerDevice }) => {
  await adminApi.api.patch(adminApi.orgApi(''), { data: { settings: { showMonitoringCard: false } } });
  await page.goto(`/o/${data.orgId}/settings/policies`);
  const toggle = page.getByRole('switch', { name: /What WorkPulse records/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Hidden: workers do not see this card.')).toBeVisible();

  const device = async () => {
    const headers = { Authorization: `Bearer ${workerDevice.token}` };
    const boot = (await (await fetch(`${WEB_URL}/api/v1/agent/bootstrap`, { headers })).json()) as { organization: { show_monitoring_card: boolean } };
    const beat = (await (await fetch(`${WEB_URL}/api/v1/agent/heartbeat`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sent_at: new Date().toISOString(), session_id: null }) })).json()) as { show_monitoring_card: boolean };
    return [boot.organization.show_monitoring_card, beat.show_monitoring_card];
  };
  expect(await device()).toEqual([false, false]);

  await toggle.click();
  await expect(page.getByText(/Workers now see “What WorkPulse records” in the desktop app/)).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await setting(adminApi.api, data.orgId)).toBe(true);
  expect(await device()).toEqual([true, true]);
  // Still on after a reload.
  await page.reload();
  await expect(page.getByRole('switch', { name: /What WorkPulse records/ })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('switch', { name: /What WorkPulse records/ }).click();
  await expect(page.getByText(/is now hidden in the desktop app/)).toBeVisible();
  expect(await setting(adminApi.api, data.orgId)).toBe(false);
  expect(await device()).toEqual([false, false]);
});

test('a worker cannot change it', async ({ data, adminApi }) => {
  const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  expect((await worker.patch(`/api/v1/orgs/${data.orgId}`, { data: { settings: { showMonitoringCard: true } } })).status()).toBe(403);
  await worker.dispose();
  expect(await setting(adminApi.api, data.orgId)).toBe(false);
});
