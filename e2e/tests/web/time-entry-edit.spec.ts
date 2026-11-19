import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';
import { invitePerson } from '../../support/people';

/**
 * Editing a time entry (QA pass, feature 10).
 *
 * BUG-53: the Edit dialog's time fields have no seconds, and saving compared them as instants with the
 * entry's real times. Tracked time always has seconds, so changing only the note also moved the start
 * and end to the whole minute (up to 59 seconds each), and could clash with the entry just before.
 * A worker of its own, so no other spec's time is touched.
 */
test.use({ storageState: ADMIN_STATE });

type Entry = { id: string; started_at: string; ended_at: string; duration_seconds: number; note: string | null };

test('changing only the note keeps the times to the second (BUG-53)', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const run = uid();
  const memberId = await invitePerson(adminApi, `edna+${run}@e2e.test`, `Edna Edit ${run}`);
  const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `Edit project ${run}`, member_ids: [memberId] } }), 'project');
  // Two entries a few seconds apart, as tracking records them.
  const day = '2025-06-10';
  for (const [s, e, note] of [
    [`${day}T08:00:05.000Z`, `${day}T08:59:58.000Z`, `Earlier ${run}`],
    [`${day}T09:00:03.000Z`, `${day}T09:47:41.000Z`, `Later ${run}`],
  ]) {
    await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: memberId, project_id: project.id, started_at: s, ended_at: e, note, reason: 'BUG-53' } }), 'time');
  }
  const entries = async () => (await ok<{ data: Entry[] } | Entry[]>(await api.get(orgApi(`/time-entries?membership_ids=${memberId}&from=2025-06-09&to=2025-06-11&page=1&page_size=50`)), 'entries'));
  const list = async () => {
    const b = await entries();
    return (Array.isArray(b) ? b : b.data).sort((a, b) => a.started_at.localeCompare(b.started_at));
  };
  const before = (await list())[1]!;
  expect(before.started_at).toBe(`${day}T09:00:03.000Z`);

  await page.goto(`/o/${data.orgId}/timesheets/all?range=custom&from=2025-06-09&to=2025-06-11&member=${memberId}`);
  // The later entry starts 3 seconds after the earlier one ends.
  const row = page.getByRole('listitem').filter({ hasText: `Later ${run}` });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Entry actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit time entry' });
  await dialog.getByLabel('Note').fill('Only the note changes');
  const reason = dialog.getByLabel(/^Reason for change/);
  if (await reason.isVisible()) await reason.fill('Note only');
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(dialog).toBeHidden();

  const after = (await list()).find((e) => e.id === before.id)!;
  expect(after.note).toBe('Only the note changes');
  expect(after.started_at).toBe(before.started_at);
  expect(after.ended_at).toBe(before.ended_at);
  expect(after.duration_seconds).toBe(before.duration_seconds);
});
