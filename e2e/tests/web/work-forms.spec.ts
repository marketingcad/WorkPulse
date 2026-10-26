import { expect, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Clients, Projects and Tasks audit (W3): pressing Enter twice in a dialog used to save twice and
 * create duplicates, because the form's Enter key skipped the "saving" state of the button.
 */
test.describe('saving a client or a task once', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Enter pressed twice creates one client, not two', async ({ page, data, adminApi }) => {
    const name = `Double ${data.run} ${uid()}`;
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    const field = dialog.getByLabel('Company / client name');
    await field.fill(name);
    await field.press('Enter');
    await field.press('Enter').catch(() => undefined); // the dialog may already be closing
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(1);
    const clients = (await (await adminApi.api.get(adminApi.orgApi('/clients'))).json()) as Array<{ name: string }>;
    expect(clients.filter((c) => c.name === name)).toHaveLength(1);
  });

  test('an archived task is found under "Archived" and restored', async ({ page, data, adminApi }) => {
    const project = (await (await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Restore ${data.run} ${uid()}` } })).json()) as { id: string; name: string };
    const title = `Bring back ${uid()}`;
    const task = (await (await adminApi.api.post(adminApi.orgApi(`/projects/${project.id}/tasks`), { data: { title } })).json()) as { id: string };
    expect((await adminApi.api.delete(adminApi.orgApi(`/tasks/${task.id}`))).status()).toBe(204);

    await page.goto(`/o/${data.orgId}/tasks`);
    await page.getByLabel('Search tasks').fill(title);
    await expect(page.getByText('No tasks match your search')).toBeVisible(); // archived: not in the normal list
    await page.getByRole('switch', { name: 'Archived' }).click();
    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: `Actions for ${title}` }).click();
    await page.getByRole('menuitem', { name: 'Restore' }).click();
    await expect(page.getByText('Task restored')).toBeVisible();
    await page.getByRole('switch', { name: 'Archived' }).click();
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(1);
  });

  test('Enter pressed twice creates one task, not two', async ({ page, data, adminApi }) => {
    const title = `Double task ${uid()}`;
    // Its own project: tasks on the shared projects would change what other specs (and the desktop app) see.
    const project = (await (await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Forms ${data.run} ${uid()}` } })).json()) as { id: string; name: string };
    await page.goto(`/o/${data.orgId}/tasks`);
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel('Project').selectOption({ label: project.name });
    const field = dialog.getByLabel('Title');
    await field.fill(title);
    await field.press('Enter');
    await field.press('Enter').catch(() => undefined);
    await expect(dialog).toBeHidden();
    const tasks = (await (await adminApi.api.get(adminApi.orgApi(`/projects/${project.id}/tasks`))).json()) as Array<{ title: string }>;
    expect(tasks.filter((t) => t.title === title)).toHaveLength(1);
  });
});
