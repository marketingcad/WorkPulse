import { expect, test } from '../../support/fixtures';
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
