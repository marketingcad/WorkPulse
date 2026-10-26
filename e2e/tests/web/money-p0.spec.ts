import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Money audit P0 fixes that a person can see:
 * M7 — an amount typed with a decimal comma ("12,50") is refused instead of saved 100 times larger.
 * M6 — payroll permissions can only be granted for the whole organization.
 * Nothing here saves data: the shared organization's rates and roles stay as they are.
 */
test.describe('Money P0 (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the rate form refuses a decimal comma instead of saving 1,250.00', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const before = await ok<unknown[]>(await adminApi.api.get(adminApi.orgApi('/rates')), 'rates');
    await page.goto(`/o/${data.orgId}/finance/billing`);
    await page.getByRole('button', { name: 'Set pay rate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set rate' });
    await dialog.getByLabel('Rate per hour').fill('12,50');
    await dialog.getByRole('button', { name: 'Save rate' }).click();
    await expect(dialog.getByText('Enter an amount like 75 or 75.50')).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const after = await ok<unknown[]>(await adminApi.api.get(adminApi.orgApi('/rates')), 'rates');
    expect(after).toHaveLength(before.length);
  });

  test('the role editor only offers organization scope for payroll, and the API refuses a narrower one', async ({ page, data, adminApi }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await page.getByRole('button', { name: /Create custom role/ }).first().click();
    const dialog = page.getByRole('dialog');
    for (const p of ['payroll:read', 'payroll:manage']) {
      const options = await dialog.locator(`[id="g-${p}"] option`).allTextContents();
      expect(options, p).toEqual(['—', 'Org']);
    }
    // Another permission still offers every scope.
    expect(await dialog.locator('[id="g-expenses:read"] option').allTextContents()).toEqual(['—', 'Own', 'Assigned', 'Team', 'Org']);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const r = await adminApi.api.post(adminApi.orgApi('/roles'), { data: { name: 'Team payroll (refused)', grants: { 'payroll:read': 'team' } } });
    expect(r.status()).toBe(400);
  });
});
