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

  test('a project whose client is archived still shows that client, in the edit dialog and the filter', async ({ page, data, adminApi }) => {
    const clientName = `Gone ${uid()}`;
    const client = (await (await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: clientName } })).json()) as { id: string };
    const project = (await (await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Of ${clientName}`, client_id: client.id } })).json()) as { id: string; name: string };
    expect((await adminApi.api.post(adminApi.orgApi(`/clients/${client.id}/archive`))).status()).toBe(204);

    // "View projects" on the archived client: the filter names it (it used to say "All clients").
    await page.goto(`/o/${data.orgId}/projects?client=${client.id}`);
    await expect(page.getByLabel('Filter by client').locator('option:checked')).toHaveText(`${clientName} (archived)`);
    // Edit from the list: the client stays (it used to show "No client").
    await page.getByRole('button', { name: `Actions for ${project.name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit project' });
    await expect(dialog.getByLabel('Client').locator('option:checked')).toHaveText(`${clientName} (archived)`);
  });

  test('unsaved project settings survive a background refresh', async ({ page, data, adminApi }) => {
    test.setTimeout(60_000);
    const project = (await (await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Settings ${uid()}`, member_ids: [data.newcomer.membershipId] } })).json()) as { id: string };
    await page.goto(`/o/${data.orgId}/projects/${project.id}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const short = page.getByLabel('Short name');
    await short.fill('TYPED');
    // Someone's time lands on the project (its totals change), and later the window gets focus back.
    // The newcomer: no timesheets (the shared worker's weeks are approved, so time can't be added there).
    // An hour 100–300 days back, so it never overlaps time other specs give the newcomer.
    const start = new Date(Math.floor((Date.now() - (100 + Math.random() * 200) * 86_400_000) / 3_600_000) * 3_600_000);
    const added = await adminApi.api.post(adminApi.orgApi('/manual-time'), { data: { membership_id: data.newcomer.membershipId, project_id: project.id, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 3600_000).toISOString(), reason: 'e2e' } });
    expect(added.status(), await added.text()).toBe(201);
    await page.waitForTimeout(16_000); // past the 15 s freshness window, so focus refetches
    const refetched = page.waitForResponse((r) => r.url().includes(`/projects/${project.id}`) && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    // The refresh brought a changed project (its time went up), which used to reset the whole form.
    expect(((await (await refetched).json()) as { tracked_seconds: number }).tracked_seconds).toBe(3600);
    await expect(short).toHaveValue('TYPED'); // before the fix: reset to empty
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
