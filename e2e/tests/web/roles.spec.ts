import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Settings › Roles & permissions: the permission matrix, and custom roles (create, edit, delete).
 * Built-in roles are read-only, a role someone holds cannot be deleted, and only people who may
 * manage roles see the page or reach the API. Every test works on its own uniquely named role.
 */

const matrix = (page: Page) => page.getByRole('region', { name: 'Permissions by role' });
const column = (page: Page, name: string) => matrix(page).getByRole('columnheader', { name: new RegExp(name) });

test.describe('Roles & permissions (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('creates a custom role, edits it and deletes it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const name = `QA role ${uid()}`;
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await expect(page.getByRole('heading', { level: 1, name: 'Roles & permissions' })).toBeVisible();
    // Built-in roles are fixed: no edit or delete, only the lock.
    await expect(matrix(page).getByLabel('Built-in, read-only').first()).toBeVisible();
    expect(await matrix(page).getByLabel('Built-in, read-only').count()).toBeGreaterThanOrEqual(3);

    await page.getByRole('button', { name: 'Create custom role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create custom role' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Description').fill('Sees projects and their own time');
    await dialog.getByLabel('See projects', { exact: true }).selectOption('org');
    await dialog.getByLabel('See time entries', { exact: true }).selectOption('own');
    await expect(dialog.getByText('2 permissions granted')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create role' }).click();
    await expect(page.getByText('Role created')).toBeVisible();
    await expect(dialog).toBeHidden();

    // The matrix shows the new column: custom, nobody holds it yet.
    await expect(column(page, name)).toContainText('Custom · 0 members');
    const roles = await ok<Array<{ id: string; name: string; grants: Record<string, string> }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const created = roles.find((r) => r.name === name)!;
    expect(created.grants).toEqual({ 'projects:read': 'org', 'time:read': 'own' });

    // Edit: rename and narrow a grant. The dialog opens with what was saved.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await expect(edit.getByLabel('See projects', { exact: true })).toHaveValue('org');
    await edit.getByLabel('Name').fill(`${name} v2`);
    await edit.getByLabel('See projects', { exact: true }).selectOption('assigned');
    await edit.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Role updated')).toBeVisible();
    await expect(column(page, `${name} v2`)).toBeVisible();
    const after = await ok<Array<{ id: string; grants: Record<string, string> }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    expect(after.find((r) => r.id === created.id)!.grants['projects:read']).toBe('assigned');

    // Delete: asks first, then the column is gone.
    await page.getByRole('button', { name: `Delete ${name} v2` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete role?' }).or(page.getByRole('dialog', { name: 'Delete role?' }));
    await expect(confirm).toContainText(`“${name} v2” will be deleted`);
    await confirm.getByRole('button', { name: 'Delete role' }).click();
    await expect(page.getByText('Role deleted')).toBeVisible();
    await expect(column(page, `${name} v2`)).toHaveCount(0);
  });

  test('a role needs a name, and cancelling creates nothing', async ({ page, data, adminApi }) => {
    const name = `Unsaved ${uid()}`;
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await page.getByRole('button', { name: 'Create custom role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create custom role' });
    const create = dialog.getByRole('button', { name: 'Create role' });
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill('   ');
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    await expect(create).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const roles = await ok<Array<{ name: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    expect(roles.some((r) => r.name === name)).toBe(false);
  });

  test('"Start from" copies another role’s grants', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await page.getByRole('button', { name: 'Create custom role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create custom role' });
    await expect(dialog.getByText('0 permissions granted')).toBeVisible();
    const viewerRole = (await dialog.getByLabel('Start from').locator('option').allTextContents()).find((o) => o.startsWith('Budget viewer'))!;
    await dialog.getByLabel('Start from').selectOption({ label: viewerRole });
    // The e2e viewer role grants budgets (org), time (own), members (own) and org:read (org).
    await expect(dialog.getByText(/^[1-9]\d* permissions granted$/)).toBeVisible();
    await expect(dialog.getByLabel('See time entries', { exact: true })).toHaveValue('own');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a role that someone holds cannot be deleted', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    // The run's viewer holds the "Budget viewer" custom role (support/global-setup.ts).
    const held = matrix(page).getByRole('button', { name: /^Budget viewer .* cannot be deleted while members \(current or former\) hold it$/ });
    await expect(held).toBeVisible();
    await expect(held).toBeDisabled();
  });

  test('the API refuses to delete a role in use, or to change a built-in role', async ({ data, adminApi }) => {
    const roles = await ok<Array<{ id: string; key: string; name: string; builtin: boolean }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const inUse = roles.find((r) => r.name.startsWith('Budget viewer'))!;
    expect((await adminApi.api.delete(adminApi.orgApi(`/roles/${inUse.id}`))).status()).toBe(409);
    const builtin = roles.find((r) => r.builtin)!;
    const put = await adminApi.api.put(adminApi.orgApi(`/roles/${builtin.id}`), { data: { name: builtin.name, grants: {} } });
    expect(put.status()).toBe(422);
    expect((await adminApi.api.delete(adminApi.orgApi(`/roles/${builtin.id}`))).status()).toBe(422);
    void data;
  });

  test('shows a loading state, then an error with a retry when the roles cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/roles`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await new Promise((r) => setTimeout(r, 300));
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) });
      return route.continue();
    });
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await expect(page.getByRole('alert').filter({ hasText: /could not|couldn’t|went wrong|error/i }).first()).toBeVisible({ timeout: 15_000 });
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(matrix(page)).toBeVisible();
  });
});

test.describe('Roles & permissions are only for people who manage roles', () => {
  for (const [who, state] of [['a team manager', MANAGER_STATE], ['a custom role without role management', VIEWER_STATE]] as const) {
    test(`${who} is told they cannot see the page, and the API refuses them`, async ({ browser, data }) => {
      const ctx = await browser.newContext({ storageState: state });
      const page = await ctx.newPage();
      await page.goto(`/o/${data.orgId}/settings/roles`);
      await expect(page.getByText('Restricted')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create custom role' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Permissions by role' })).toHaveCount(0);
      // Listing roles is open to members (pickers need it); creating, changing and deleting are not.
      const api = await request.newContext({ baseURL: WEB_URL, storageState: state, extraHTTPHeaders: { Origin: WEB_URL } });
      const roles = await ok<Array<{ id: string; builtin: boolean }>>(await api.get(`/api/v1/orgs/${data.orgId}/roles`), 'roles');
      const custom = roles.find((r) => !r.builtin)!;
      expect((await api.put(`/api/v1/orgs/${data.orgId}/roles/${custom.id}`, { data: { name: 'Taken over', grants: { 'roles:manage': 'org' } } })).status()).toBe(403);
      expect((await api.delete(`/api/v1/orgs/${data.orgId}/roles/${custom.id}`)).status()).toBe(403);
      expect((await api.post(`/api/v1/orgs/${data.orgId}/roles`, { data: { name: `Sneaky ${uid()}`, grants: { 'roles:manage': 'org' } } })).status()).toBe(403);
      await Promise.all([api.dispose(), ctx.close()]);
    });
  }
});
