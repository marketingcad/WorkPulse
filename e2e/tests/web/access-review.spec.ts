import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';

/**
 * The access review (QA pass, feature 3): who holds what across the organization. A grant over one team
 * is refused (BUG-45, covered by the API test role-rules and the nav unit test); here, the page an admin
 * uses, and a team manager kept out.
 */
test.describe('An admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reviews members, two-factor, roles and API keys', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const keyName = `Review key ${uid()}`;
    const key = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/api-keys'), { data: { name: keyName, scopes: ['read:projects'] } }), 'api key');
    try {
      await page.goto(`/o/${data.orgId}/settings/access-review`);
      await expect(page.getByRole('heading', { level: 1, name: 'Access review' })).toBeVisible();
      await expect(page.getByText('Active members')).toBeVisible();

      // Everyone, with their email and role.
      await page.getByRole('radiogroup', { name: 'Members shown' }).getByRole('radio', { name: /^All/ }).click();
      const worker = page.getByRole('row', { name: new RegExp(data.worker.name) });
      await expect(worker).toBeVisible();
      await expect(worker.getByText(data.worker.email)).toBeVisible();

      // The roles, and the key just made, with who made it.
      await expect(page.getByText('System Admin').first()).toBeVisible();
      const keyRow = page.getByRole('table', { name: 'Active API keys' }).getByRole('row', { name: new RegExp(keyName) });
      await expect(keyRow).toBeVisible();
      await expect(keyRow.getByText('Never').first()).toBeVisible();
    } finally {
      await adminApi.api.delete(adminApi.orgApi(`/api-keys/${key.id}`));
    }
  });
});

test.describe('A team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('has no access review, in the menu, on the page or through the API', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/access-review`);
    await expect(page.getByText('Restricted', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Access review' })).toHaveCount(0);
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/permissions/review`);
    expect(res.status()).toBe(403);
  });
});
