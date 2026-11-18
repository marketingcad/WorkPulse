import { request, type APIRequestContext } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Client folders (optional): a System Admin turns them on in Settings, creates a folder for a client,
 * fills it with new and existing projects, inspects each project in its accordion and reads its
 * revision history. Organizations without folders keep the plain project list. Only this spec's own
 * clients and projects are used; the shared projects are never moved to a client.
 */
test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const clientName = `Folder Client ${run}`;
const otherClientName = `Other Client ${run}`;
let clientId: string;
let otherClientId: string;
let looseProject: { id: string; name: string };
let foreignProject: { id: string; name: string };

async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
}

test.beforeAll(async ({ data }) => {
  const api = await adminApi();
  const o = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
  await api.patch(o(''), { data: { settings: { clientFolders: false } } });
  clientId = (await ok<{ id: string }>(await api.post(o('/clients'), { data: { name: clientName } }), 'client')).id;
  otherClientId = (await ok<{ id: string }>(await api.post(o('/clients'), { data: { name: otherClientName } }), 'other client')).id;
  looseProject = await ok(await api.post(o('/projects'), { data: { name: `Loose ${run}` } }), 'loose project');
  foreignProject = await ok(await api.post(o('/projects'), { data: { name: `Foreign ${run}`, client_id: otherClientId } }), 'foreign project');
  await api.dispose();
});

test.afterAll(async ({ data }) => {
  // Back to the default (off), so other specs see the plain Projects page.
  const api = await adminApi();
  await api.patch(`/api/v1/orgs/${data.orgId}`, { data: { settings: { clientFolders: false } } });
  await api.dispose();
});

test('without folders, Projects is the plain list', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/projects?view=folders`);
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Client folders' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible();
});

test('an admin organizes a client’s projects in a folder and reads a project’s history', { tag: '@smoke' }, async ({ page, data }) => {
  // Turn folders on in Settings.
  await page.goto(`/o/${data.orgId}/settings`);
  const toggle = page.getByRole('switch', { name: /Organize projects in client folders/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.getByText('Client folders turned on. Find them on the Projects page.')).toBeVisible();

  // The folder view on Projects.
  await page.goto(`/o/${data.orgId}/projects`);
  await page.getByRole('radio', { name: 'Client folders' }).click();
  await expect(page).toHaveURL(/view=folders/);

  // Create a folder for the client, named after it.
  await page.getByRole('button', { name: 'New folder' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New client folder' });
  await expect(dialog.getByRole('button', { name: 'Create folder' })).toBeDisabled();
  await dialog.getByLabel('Client').selectOption({ label: clientName });
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByText(`Folder ${clientName} created`)).toBeVisible();
  const card = page.getByRole('list', { name: 'Client folders' }).getByRole('link', { name: new RegExp(clientName) });
  await expect(card).toContainText('0 projects');

  // Open it: empty, with both ways to add projects.
  await card.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(clientName);
  await expect(page.getByText('No projects in this folder yet')).toBeVisible();

  // A new project made here belongs to the client.
  await page.getByRole('button', { name: 'New project' }).first().click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByLabel(/^Name/).fill(`In Folder ${run}`);
  await projectDialog.getByRole('button', { name: 'Create project' }).click();
  const list = page.getByRole('list', { name: 'Projects in this folder' });
  await expect(list.getByRole('button', { name: new RegExp(`In Folder ${run}`) })).toBeVisible();

  // An existing project without a client can be added; one of another client is not offered.
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Add existing projects' }).click();
  const add = page.getByRole('dialog', { name: 'Add existing projects' });
  await expect(add.getByRole('checkbox', { name: foreignProject.name })).toHaveCount(0);
  await add.getByRole('checkbox', { name: looseProject.name }).check();
  await add.getByRole('button', { name: 'Add 1 project' }).click();
  await expect(page.getByText('1 project added')).toBeVisible();
  const loose = list.getByRole('button', { name: new RegExp(looseProject.name) });
  await expect(loose).toBeVisible();

  // Expand the project: details, then its revision history.
  await expect(loose).toHaveAttribute('aria-expanded', 'false');
  await loose.click();
  await expect(loose).toHaveAttribute('aria-expanded', 'true');
  const details = page.getByRole('region', { name: `${looseProject.name} details` });
  await expect(details.getByText('No tasks yet')).toBeVisible();
  await expect(details.getByText('Revisions')).toBeVisible();
  await details.getByRole('button', { name: 'Revision history' }).click();
  const drawer = page.getByRole('dialog', { name: 'Revision history' });
  const revisions = drawer.getByRole('list', { name: 'Revisions' });
  await expect(revisions.getByRole('listitem')).toHaveCount(2);
  await expect(revisions.getByRole('listitem').first()).toContainText(`Added to the folder ${clientName}`);
  await expect(revisions.getByRole('listitem').first()).toContainText(clientName);
  await drawer.getByRole('radio', { name: 'Oldest first' }).click();
  await expect(revisions.getByRole('listitem').first()).toContainText('Created');
  await page.keyboard.press('Escape');

  // Rename the folder; the client keeps its name.
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename folder' });
  await rename.getByLabel('Folder name').fill(`Retainers ${run}`);
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Retainers ${run}`);
  await expect(page.getByText(`Client: ${clientName}`)).toBeVisible();

  // Search and status filter inside the folder.
  await page.getByPlaceholder('Search projects…').fill('no such project');
  await expect(page.getByText('No projects match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('a project change with a reason shows up in its History tab', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/projects/${looseProject.id}`);
  // The project's own tabs (not the sidebar's Settings).
  const tab = (name: string) => page.getByRole('main').getByRole('button', { name, exact: true }).or(page.getByRole('main').getByRole('tab', { name, exact: true })).first();
  await tab('Settings').click();
  await page.getByLabel(/^Name/).fill(`${looseProject.name} v2`);
  await page.getByLabel('Reason for this change').fill('Renamed for the new contract');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Project saved')).toBeVisible();
  await tab('History').click();
  const latest = page.getByRole('list', { name: 'Revisions' }).getByRole('listitem').first();
  await expect(latest).toContainText('Edited');
  await expect(latest).toContainText('Renamed for the new contract');
  await expect(latest).toContainText(looseProject.name);
  await expect(latest).toContainText(`${looseProject.name} v2`);
});

test('archiving a folder hides it but leaves the client and its projects working', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/projects?view=folders`);
  await page.getByRole('list', { name: 'Client folders' }).getByRole('link', { name: new RegExp(`Retainers ${run}`) }).click();
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive folder' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive folder' }).click();
  await expect(page.getByText(`Retainers ${run} archived`)).toBeVisible();

  await page.goto(`/o/${data.orgId}/projects?view=folders`);
  await expect(page.getByRole('link', { name: new RegExp(`Retainers ${run}`) })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show archived' }).check();
  await expect(page.getByRole('link', { name: new RegExp(`Retainers ${run}`) })).toContainText('Archived');

  // The plain list still has the projects, active, with their client.
  await page.getByRole('radio', { name: 'All projects' }).click();
  const row = page.getByRole('row', { name: new RegExp(`In Folder ${run}`) });
  await expect(row).toContainText(clientName);
  await expect(row).toContainText('Active');

  // Restore it again.
  await page.goto(`/o/${data.orgId}/projects?view=folders`);
  await page.getByRole('checkbox', { name: 'Show archived' }).check();
  await page.getByRole('link', { name: new RegExp(`Retainers ${run}`) }).click();
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore folder' }).click();
  await expect(page.getByText(`Retainers ${run} restored`)).toBeVisible();
});

test('the API refuses to put another client’s project in the folder', async ({ data }) => {
  const api = await adminApi();
  const o = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
  const folders = await ok<{ folders: Array<{ id: string; client_id: string }> }>(await api.get(o('/client-folders')), 'folders');
  const folder = folders.folders.find((f) => f.client_id === clientId)!;
  const r = await api.post(o(`/client-folders/${folder.id}/projects`), { data: { project_ids: [foreignProject.id] } });
  expect(r.status()).toBe(409);
  const p = await ok<{ client_id: string }>(await api.get(o(`/projects/${foreignProject.id}`)), 'foreign project');
  expect(p.client_id).toBe(otherClientId);
  await api.dispose();
});

test.describe('who must not manage folders', () => {
  test.use({ storageState: MANAGER_STATE });

  test('a manager sees no folder actions and no folders of clients they do not work for', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/projects?view=folders`);
    await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0);
    await expect(page.getByText('No client folders yet')).toBeVisible();
    await expect(page.getByText('Folders for the clients you work with will appear here.')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(clientName) })).toHaveCount(0);
  });
});

test.describe('workers', () => {
  test.use({ storageState: WORKER_STATE });

  test('cannot create folders or read revision history', async ({ data }) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const o = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
    expect((await api.post(o('/client-folders'), { data: { client_id: otherClientId } })).status()).toBe(403);
    expect((await api.patch(o(''), { data: { settings: { clientFolders: false } } })).status()).toBe(403);
    const list = await ok<{ folders: Array<{ client_id: string }> }>(await api.get(o('/client-folders')), 'worker folders');
    expect(list.folders.find((f) => f.client_id === clientId)).toBeUndefined();
    expect((await api.get(o(`/projects/${looseProject.id}/revisions`))).status()).toBe(404);
    await api.dispose();
  });
});
