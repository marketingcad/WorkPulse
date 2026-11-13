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
  // Too long for one entry says so (QA audit C-9: it was told the format was wrong).
  await dialog.getByLabel('Time logged').fill('30h');
  await add.click();
  await expect(dialog.getByText('One entry can hold at most 24 hours. Split longer work across days.')).toBeVisible();
  await dialog.getByLabel('Time logged').fill('two hours');
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
  // A day of its own in 2022, a year no other spec uses: the entry it keeps would otherwise overlap the
  // next run's, or another spec's fixed day on the same server (refused, 422).
  const day = new Date(Date.UTC(2022, 0, 1) + (parseInt(uid(), 16) % 360) * 86400_000).toISOString().slice(0, 10);
  const note = `Bulk scope ${data.run}-${uid()}`;
  const add = (projectId: string, hour: number) =>
    api.post(orgApi('/manual-time'), { data: { project_id: projectId, started_at: `${day}T${hour}:00:00.000Z`, ended_at: `${day}T${hour}:30:00.000Z`, note, reason: 'E2E bulk scope' } });
  await ok(await add(data.projects.website.id, 10), 'website entry');
  await ok(await add(data.projects.app.id, 11), 'app entry');

  // Typed dates stick only once the page has loaded its default range (else that range replaces them).
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/time-entries') && r.ok());
  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await loaded;
  await page.getByLabel('From', { exact: true }).fill(day);
  await page.getByLabel('To', { exact: true }).fill(day);
  // The list for this search and these dates (an earlier answer, for the dates before, can arrive first).
  const listed = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname.endsWith('/time-entries') && u.searchParams.get('q') === note && u.searchParams.get('from') === day && u.searchParams.get('to') === day && r.ok(); });
  await search(page, 'Search time entries', note, '/time-entries');
  await listed;
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

test('From and To changed one right after the other both stick (neither writes back the old other date)', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/timesheets/all`);
  await expect(page.getByRole('heading', { level: 1, name: 'Time entries' })).toBeVisible();
  // Both in one task, before the page re-renders (fast typing, autofill, a slow computer): the To
  // change used to write back the From date of the previous render.
  await page.evaluate(() => {
    const set = (label: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('From', '2025-12-01');
    set('To', '2025-12-05');
  });
  await expect(page).toHaveURL(/from=2025-12-01&to=2025-12-05/);
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2025-12-01');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('2025-12-05');
});
