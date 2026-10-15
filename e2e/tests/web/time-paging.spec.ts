import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Time lists are paged by the server: All time entries shows one page at a time with day and range
 * totals over every entry, the team timesheet adds up hours on the server, and manual time
 * searches and counts on the server. Each test uses its own past dates or search term.
 */
test.use({ storageState: ADMIN_STATE });

test('All time entries pages through a busy day with totals over every entry', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const day = '2025-11-12';
  const note = `Paged work ${data.run}-${Date.now() % 100000}`;
  // 110 five-minute entries for the admin on one day (more than one 100-entry page).
  for (let i = 0; i < 110; i++) {
    const start = new Date(Date.UTC(2025, 10, 12, 6, 0, 0) + i * 6 * 60_000);
    await ok(await api.post(orgApi('/manual-time'), { data: { project_id: data.projects.website.id, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 5 * 60_000).toISOString(), note: `${note} #${i}`, reason: 'E2E paging' } }), `entry ${i}`);
  }

  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await page.getByLabel('From', { exact: true }).fill(day);
  await page.getByLabel('To', { exact: true }).fill(day);
  await page.getByLabel('Search time entries').fill(note);
  await expect(page.getByText('Showing 1–100 of 110 results')).toBeVisible();
  await expect(page.getByText('110 entries')).toBeVisible();
  // The day header and the footer cover all 110 entries (110 × 5 min = 9h 10m), not just this page.
  await expect(page.getByRole('region').filter({ hasText: 'Logged' }).first()).toContainText('9h 10m');
  await expect(page.getByText(/Time logged\s*9h 10m/)).toBeVisible();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 101–110 of 110 results')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(10);

  await page.getByLabel('Search time entries').fill(`${note} #107`);
  await expect(page.getByText('Showing 1–1 of 1 result')).toBeVisible();
  await page.getByLabel('Search time entries').fill('no-such-work-xyz');
  await expect(page.getByText('No time entries match your search')).toBeVisible();
});

test('the team timesheet adds up each member’s week on the server', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  // Two hours for Wade on Wednesday 2025-11-19 (a week no other spec writes to).
  await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: data.worker.membershipId, project_id: data.projects.website.id, started_at: '2025-11-19T09:00:00.000Z', ended_at: '2025-11-19T11:00:00.000Z', reason: 'E2E team week' } }), 'time');

  await page.goto(`/o/${data.orgId}/timesheets/team?date=2025-11-19`);
  const wade = page.getByRole('row', { name: new RegExp(data.worker.name) });
  await expect(wade).toContainText('2h 00m');
});

test('manual time searches every request on the server', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const reason = `Offsite ${data.run}-${Date.now() % 100000}`;
  await ok(await api.post(orgApi('/manual-time'), { data: { project_id: data.projects.website.id, started_at: '2025-10-01T09:00:00.000Z', ended_at: '2025-10-01T10:00:00.000Z', reason } }), 'manual time');

  await page.goto(`/o/${data.orgId}/timesheets/manual`);
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Search manual time').fill(reason);
  await expect(page.getByRole('table', { name: 'Manual time requests' }).getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('table', { name: 'Manual time requests' })).toContainText(reason);
  await page.getByLabel('Search manual time').fill('no-such-reason-xyz');
  await expect(page.getByText('No requests match your search')).toBeVisible();
});
