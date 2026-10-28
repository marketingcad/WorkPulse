import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Attendance before a shift starts, and schedules for people who do not track time. Live, 28 Oct 2026:
 * at 04:30 a member scheduled for 09:00 was missing and the roster said "Nobody was scheduled"; a schedule
 * for the owner (time tracking off) never showed in attendance, with no reason given.
 */
test.use({ storageState: ADMIN_STATE });

/** Tomorrow in UTC (the E2E organization's time zone): its shift is always still to come. */
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: '09:00', end: '17:00' }));

test('a shift that has not started yet is on the roster as "Not started yet"', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const day = tomorrow();
  // Nina tracks time; her schedule starts tomorrow, so no day another spec reads changes.
  await ok(await adminApi.api.post(adminApi.orgApi('/schedules'), { data: { membership_id: data.newcomer.membershipId, name: 'E2E every day', timezone: 'UTC', days: EVERY_DAY, effective_from: day } }), 'schedule');

  await page.goto(`/o/${data.orgId}/attendance`);
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();
  await page.getByLabel('Date', { exact: true }).fill(day);
  const roster = page.getByRole('table', { name: 'Attendance roster' });
  const nina = roster.getByRole('row', { name: new RegExp(data.newcomer.name) });
  await expect(nina).toContainText('Not started yet');
  await expect(page.getByText('Nobody was scheduled or tracked time')).toHaveCount(0);

  await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Not started yet' });
  await expect(nina).toBeVisible();
  await expect(page.getByText(/Members with time tracking off are not included/)).toBeVisible();
});

test('the schedule editor says when attendance leaves someone out because they do not track time', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/schedules`);
  await expect(page.getByRole('heading', { level: 1, name: 'Schedules' })).toBeVisible();

  // The admin signed up the organization: time tracking is off for them.
  await page.getByRole('button', { name: `Edit schedule for ${data.admin.name}` }).click();
  const own = page.getByRole('dialog', { name: `Schedule · ${data.admin.name}` });
  await expect(own.getByRole('note')).toHaveText(`Time tracking is off for ${data.admin.name}, so attendance does not include them. Their schedule still sets the hours of their time off and paid holidays.`);
  await own.getByRole('button', { name: 'Cancel' }).click();

  // A worker tracks time: no note.
  await page.getByRole('button', { name: `Edit schedule for ${data.worker.name}` }).click();
  const worker = page.getByRole('dialog', { name: `Schedule · ${data.worker.name}` });
  await expect(worker.getByLabel('Name')).toBeVisible();
  await expect(worker.getByRole('note')).toHaveCount(0);
});
