import { request } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * A member's profile as an admin sees it. Live, 28 Oct 2026: a member paid through a project rate showed
 * "Pay rate: Not set", and their computer as "windows Windows_NT 10.0.19045".
 */
test.use({ storageState: ADMIN_STATE });

test("a member's profile explains a missing personal rate and names their computer's system", async ({ page, data }) => {
  // Nina signs in to the desktop app on a Windows PC, as the app does.
  const app = await request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] } });
  await ok(await app.post('/api/v1/agent/login', { data: { email: data.newcomer.email, password: PASSWORD, device: { name: `Profile PC ${data.run}`, platform: 'windows', os_version: 'Windows_NT 10.0.19045', agent_version: '0.1.8' } } }), 'desktop sign-in');
  await app.dispose();

  await page.goto(`/o/${data.orgId}/workers/${data.newcomer.membershipId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(data.newcomer.name);
  await expect(page.getByText('Not set (project or client rates apply)').first()).toBeVisible();

  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(`Profile PC ${data.run}`) });
  await expect(row).toContainText('Windows 10.0.19045');
  await expect(row).not.toContainText('Windows_NT');
});

test('the invite form says the roles are still loading instead of showing an empty role', async ({ page, data }) => {
  // Live, 28 Oct 2026: on a slow connection the Role box was empty and Send stayed disabled with no reason.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/v1\/orgs\/[^/]+\/roles$/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(`/o/${data.orgId}/workers`);
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite member' });
  const role = dialog.getByLabel('Role');
  await expect(role).toBeDisabled();
  await expect(role.locator('option:checked')).toHaveText('Loading roles…');

  release();
  await expect(role).toBeEnabled();
  await expect(role.locator('option:checked')).toHaveText('Worker');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
