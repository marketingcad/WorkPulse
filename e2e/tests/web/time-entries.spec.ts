import { expect, ok, search, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Time entered as a duration ("2:30 on that day"), part of it billable, and the "Time entries"
 * page that managers use to find it. Uses a fixed past date no other spec writes to.
 */
test.use({ storageState: ADMIN_STATE });

const DAY = '2026-01-14';

test('an admin logs a part-billable duration and finds it on Time entries', { tag: '@smoke' }, async ({ page, data }) => {
  const note = `Workshop prep ${data.run}`;
  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await expect(page.getByRole('heading', { level: 1, name: 'Time entries' })).toBeVisible();

  await page.getByRole('button', { name: 'Add time' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add time' });
  await dialog.getByLabel('Date').fill(DAY);
  // Duration is the default way to enter time.
  await dialog.getByLabel('Time logged').fill('2:30');
  await dialog.getByLabel('Billable time').fill('1:00');
  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  await page.getByRole('option', { name: new RegExp(data.projects.website.name) }).first().click();
  await dialog.getByLabel('Work performed').fill(note);
  // The organization's policy asks for a reason on manual time.
  await dialog.getByLabel('Reason').fill('Workshop away from the computer');
  await dialog.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByText('Time added to the timesheet')).toBeVisible();

  await page.getByLabel('From', { exact: true }).fill(DAY);
  await page.getByLabel('To', { exact: true }).fill(DAY);
  // Part-billable time is kept as a billable entry plus a non-billable rest, both shown as durations.
  const entries = page.getByRole('listitem').filter({ hasText: note });
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: '1h 00m' }).filter({ hasNotText: 'Non-billable' })).toHaveCount(1);
  await expect(entries.filter({ hasText: '1h 30m' }).filter({ hasText: 'Non-billable' })).toHaveCount(1);
  for (const e of await entries.all()) await expect(e).toContainText('Duration entry');
  await expect(page.getByText(/Billable time\s*1h 00m/)).toBeVisible();
  await expect(page.getByText('2 entries', { exact: true })).toBeVisible();
});

test('a single entry is counted as "1 entry"', async ({ page, data }) => {
  // Live, 28 Oct 2026: the list read "1 entries". Its own day, so nothing else is counted.
  const day = '2026-01-21';
  const note = `Single entry ${data.run}`;
  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await expect(page.getByRole('heading', { level: 1, name: 'Time entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Add time' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add time' });
  await dialog.getByLabel('Date').fill(day);
  await dialog.getByLabel('Time logged').fill('0:45');
  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  await page.getByRole('option', { name: new RegExp(data.projects.app.name) }).first().click();
  await dialog.getByLabel('Work performed').fill(note);
  await dialog.getByLabel('Reason').fill('Call away from the computer');
  await dialog.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByText('Time added to the timesheet')).toBeVisible();

  await page.getByLabel('From', { exact: true }).fill(day);
  await page.getByLabel('To', { exact: true }).fill(day);
  await search(page, 'Search time entries', note, '/time-entries');
  await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(1);
  await expect(page.getByText('1 entry', { exact: true })).toBeVisible();
  await expect(page.getByText('1 entries')).toHaveCount(0);
});

test('the add time dialog checks the duration, the billable part and the project', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await page.getByRole('button', { name: 'Add time' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add time' });
  const add = dialog.getByRole('button', { name: 'Add time' });

  await add.click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose a project');

  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  await page.getByRole('option', { name: new RegExp(data.projects.website.name) }).first().click();
  await dialog.getByLabel('Time logged').fill('30h');
  await add.click();
  await expect(dialog.getByText('Enter the time worked, e.g. 2:30 or 1.5')).toBeVisible();

  await dialog.getByLabel('Time logged').fill('1:00');
  await dialog.getByLabel('Billable time').fill('2:00');
  await add.click();
  await expect(dialog.getByText('At most the time logged, e.g. 1:00')).toBeVisible();

  // Valid time, but the organization requires a reason for manual time.
  await dialog.getByLabel('Billable time').fill('');
  await add.click();
  await expect(dialog.getByRole('alert')).toHaveText('A reason is required for manual time');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Time added to the timesheet')).toHaveCount(0);
});

// Audit 28 Oct 2026 (U1): only the Member filter cleared the selection, so after narrowing by
// project a bulk Delete also removed rows that were no longer on screen.
test('changing a filter clears the selection, so a bulk delete touches only rows in view', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const day = '2025-12-03';
  const note = `Bulk scope ${data.run}-${uid()}`;
  const add = (projectId: string, hour: number) =>
    api.post(orgApi('/manual-time'), { data: { project_id: projectId, started_at: `${day}T${hour}:00:00.000Z`, ended_at: `${day}T${hour}:30:00.000Z`, note, reason: 'E2E bulk scope' } });
  await ok(await add(data.projects.website.id, 10), 'website entry');
  await ok(await add(data.projects.app.id, 11), 'app entry');

  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await page.getByLabel('From', { exact: true }).fill(day);
  await page.getByLabel('To', { exact: true }).fill(day);
  await search(page, 'Search time entries', note, '/time-entries');
  await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select all editable entries' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();

  // Narrowing to one project clears the selection instead of keeping the hidden row.
  await page.getByLabel('Project', { exact: true }).selectOption({ label: data.projects.website.name });
  await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(1);
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Select all editable entries' }).check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete 1 entry?' }));
  await expect(confirm).toContainText('Delete 1 entry?');
  await confirm.getByLabel('Reason').fill('E2E bulk scope');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(0);

  // The app entry, out of view, is still there.
  const left = await ok<Array<{ project_id: string }>>(await api.get(orgApi(`/time-entries?from=${day}&to=${day}&q=${encodeURIComponent(note)}`)), 'entries');
  expect(left.map((e) => e.project_id)).toEqual([data.projects.app.id]);
});
