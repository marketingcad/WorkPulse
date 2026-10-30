import type { Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, WORKER_STATE } from '../../support/env';

/**
 * Deleting a client (30 Oct 2026). Only a client that was never used can be deleted; one with
 * invoices, payments, expenses or tracked time is refused with a reason, and stays.
 */

async function openDelete(page: Page, orgId: string, name: string) {
  await page.goto(`/o/${orgId}/clients`);
  await page.getByPlaceholder('Search clients…').fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toHaveCount(1);
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This cannot be undone');
  return { row, dialog };
}

test.describe('deleting a client (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an unused client, with its empty project, is deleted after confirming', async ({ page, data, adminApi }) => {
    const name = `Unused ${uid()}`;
    const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    const project = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Empty ${uid()}`, client_id: client.id } }), 'project');
    const { row, dialog } = await openDelete(page, data.orgId, name);
    await dialog.getByRole('button', { name: 'Delete client' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await expect(row).toHaveCount(0);
    // Gone from the server too, with its project.
    const clients = await ok<Array<{ id: string }>>(await adminApi.api.get(adminApi.orgApi('/clients?include_archived=true')), 'clients');
    expect(clients.map((c) => c.id)).not.toContain(client.id);
    expect((await adminApi.api.get(adminApi.orgApi(`/projects/${project.id}`))).status()).toBe(404);
  });

  test('cancelling keeps the client', async ({ page, data, adminApi }) => {
    const name = `Kept ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    const { row, dialog } = await openDelete(page, data.orgId, name);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(1);
  });

  test('a client with history is refused with a reason and stays', async ({ page, data, adminApi }) => {
    const name = `Used ${uid()}`;
    const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    await ok(await adminApi.api.post(adminApi.orgApi('/expenses'), { data: { client_id: client.id, category: 'Travel', amount_minor: 1500, currency: 'USD', spent_on: '2026-10-01' } }), 'expense');
    const { row, dialog } = await openDelete(page, data.orgId, name);
    await dialog.getByRole('button', { name: 'Delete client' }).click();
    await expect(page.getByText(`${name} has expenses, so it can't be deleted. Archive it instead`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row).toHaveCount(1);
    const clients = await ok<Array<{ id: string }>>(await adminApi.api.get(adminApi.orgApi('/clients')), 'clients');
    expect(clients.map((c) => c.id)).toContain(client.id);
  });
});

test.describe('deleting a client (worker)', () => {
  test.use({ storageState: WORKER_STATE });

  test('a worker has no client actions and the API refuses the delete', async ({ page, data, adminApi }) => {
    const name = `Protected ${uid()}`;
    const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    // Workers are sent to the desktop app page rather than the client list; either way, no client actions.
    await page.goto(`/o/${data.orgId}/clients`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    const res = await page.request.delete(`/api/v1/orgs/${data.orgId}/clients/${client.id}`, { headers: { Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });
});
