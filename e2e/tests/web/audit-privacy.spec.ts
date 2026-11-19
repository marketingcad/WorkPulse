import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';
import { invitePerson } from '../../support/people';

/**
 * The audit log and erasing a member's personal data (QA pass, feature 24).
 *
 * - BUG-42: erasing a member left the personal-data exports made of them downloadable from Exports.
 * - BUG-44: the audit log showed dates without a year, its detail used the browser's time zone, and
 *   its date filters used the browser's midnight. A Manila browser makes the difference visible.
 */
const stamp = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
type AuditRow = { id: string; action: string; target_id: string | null; created_at: string };
type Run = { id: string; report_key: string; status: string; download_url: string | null };

test.describe('An admin', () => {
  test.use({ storageState: ADMIN_STATE, timezoneId: 'Asia/Manila' });

  test('finds an entry in the audit log, dated with the year in the profile time zone (BUG-44)', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const me = await ok<{ membership: { timezone: string | null }; organization: { timezone: string } }>(await api.get(orgApi('')), 'org context');
    const tz = me.membership.timezone || me.organization.timezone;
    const name = `Audit team ${uid()}`;
    const team = await ok<{ id: string }>(await api.post(orgApi('/teams'), { data: { name } }), 'team');
    const [entry] = await ok<AuditRow[]>(await api.get(orgApi(`/audit-logs?action=team.created&target_id=${team.id}`)), 'audit');
    expect(entry).toBeTruthy();

    await page.goto(`/o/${data.orgId}/settings/audit`);
    await page.getByLabel('Target type').selectOption('team');
    await page.getByLabel('Action starts with').fill('team.created');
    const row = page.getByRole('row').filter({ hasText: 'team.created' }).filter({ hasText: stamp(entry!.created_at, tz) }).first();
    await expect(row).toBeVisible();
    // The year is shown.
    await expect(row).toContainText(String(new Date(entry!.created_at).getUTCFullYear()));

    // Newer target types can be chosen.
    await expect(page.getByLabel('Target type').locator('option', { hasText: /invitation/i })).toHaveCount(1);

    // The detail shows the same zone, not the browser's.
    await row.click();
    const drawer = page.getByRole('dialog', { name: 'team.created' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(stamp(entry!.created_at, tz)).first()).toBeVisible();
  });

  test('erasing a member also removes the exports made of them (BUG-42)', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Erin Erase ${uid()}`;
    const membershipId = await invitePerson(adminApi, `erin+${uid()}@e2e.test`, name);
    const queued = await ok<{ id: string }>(await api.post(orgApi(`/workers/${membershipId}/data-export`)), 'export');
    const run = async () => (await ok<Run[]>(await api.get(orgApi('/report-runs')), 'runs')).find((r) => r.id === queued.id);
    await expect.poll(async () => (await run())?.download_url ?? null, { timeout: 20_000 }).not.toBeNull();

    await page.goto(`/o/${data.orgId}/workers/${membershipId}`);
    await page.getByRole('button', { name: 'Erase', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Erase ${name}’s personal data?` });
    const erase = dialog.getByRole('button', { name: 'Erase permanently' });
    await expect(erase).toBeDisabled();
    await dialog.getByLabel(`Type “${name}” to confirm`).fill(name);
    await erase.click();
    await expect(page.getByText(new RegExp(`${name}’s data`))).toBeVisible();

    // The export made of them is gone; nobody can download it any more.
    expect(await run()).toBeUndefined();
  });
});

test.describe('A team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('can’t read the audit log', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/audit`);
    await expect(page.getByRole('row').filter({ hasText: 'team.created' })).toHaveCount(0);
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/audit-logs?page=1&page_size=25`);
    expect(res.status()).toBe(403);
  });
});
