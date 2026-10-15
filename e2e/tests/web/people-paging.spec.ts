import { request } from '@playwright/test';
import { expect, ok, search, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * Members, tasks and attendance are paged and searched by the server. Each test makes its own
 * records under a unique name, and searches for them, so it never depends on other tests' data.
 */
test.use({ storageState: ADMIN_STATE });

const unique = (prefix: string, run: string) => `${prefix}${run}${uid()}`;

test('Members search and filter on the server', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const tag = unique('Paged', data.run);
  const roles = await ok<Array<{ id: string; key: string; name: string }>>(await api.get(orgApi('/roles')), 'roles');
  const worker = roles.find((r) => r.key === 'WORKER')!;
  // Three people join through invitations, as in production.
  for (const n of [1, 2, 3]) {
    const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email: `${tag.toLowerCase()}${n}@e2e.test`, name: `${tag} Person ${n}`, role_id: worker.id } }), `invite ${n}`);
    const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL }, storageState: { cookies: [], origins: [] } });
    await ok(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name: `${tag} Person ${n}`, password: PASSWORD } }), `accept ${n}`);
    await ctx.dispose();
  }

  await page.goto(`/o/${data.orgId}/workers`);
  await search(page, 'Search members', tag, '/workers');
  const table = page.getByRole('table', { name: 'Members' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(page.getByText('3 members')).toBeVisible();

  // Filters combine with the search on the server.
  await page.getByLabel('Filter by role').selectOption({ label: roles.find((r) => r.key === 'SYSTEM_ADMIN')!.name });
  await expect(page.getByText('No members match these filters')).toBeVisible();
  await page.getByLabel('Filter by role').selectOption({ label: worker.name });
  await page.getByLabel('Search members').fill(`${tag} Person 2`);
  await expect(table.getByRole('row')).toHaveCount(2);
  await table.getByRole('row', { name: new RegExp(`${tag} Person 2`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${tag} Person 2`);
});

test('Tasks page through and search on the server', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const tag = unique('Paged task ', data.run);
  for (let i = 0; i < 55; i++) await ok(await api.post(orgApi(`/projects/${data.projects.app.id}/tasks`), { data: { title: `${tag} #${String(i).padStart(2, '0')}` } }), `task ${i}`);

  await page.goto(`/o/${data.orgId}/tasks`);
  // Admins see every task, not just their own.
  const mine = page.getByRole('switch', { name: 'Assigned to me' });
  if (await mine.isChecked()) await mine.click();
  await search(page, 'Search tasks', tag, '/tasks');
  await expect(page.getByText('Showing 1–50 of 55 results')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 51–55 of 55 results')).toBeVisible();
  await page.getByLabel('Search tasks').fill(`${tag} #42`);
  await expect(page.getByText('Showing 1–1 of 1 result')).toBeVisible();
});

test('Attendance searches members on the server and keeps the counts', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  // Wade tracked an hour on Thursday 2025-11-20 (a day no other spec writes to).
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: data.worker.membershipId, project_id: data.projects.website.id, started_at: '2025-11-20T09:00:00.000Z', ended_at: '2025-11-20T10:00:00.000Z', reason: 'E2E attendance' } }), 'time');

  await page.goto(`/o/${data.orgId}/attendance`);
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();
  await page.getByLabel('Date', { exact: true }).fill('2025-11-20');
  const roster = page.getByRole('table', { name: 'Attendance roster' });
  await expect(roster.getByRole('row', { name: new RegExp(data.worker.name) })).toBeVisible();

  await page.getByLabel('Search members').fill(data.worker.name);
  await expect(roster.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Search members').fill('no-such-member-xyz');
  await expect(page.getByText('No members match your search')).toBeVisible();
});
