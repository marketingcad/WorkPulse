import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Settings › Tracking policies: overrides flow from the organization default to teams, then to
 * members. Saving says exactly what changes and asks first. These tests save only on a team they
 * create for themselves (no members), never on the organization default other specs depend on.
 */

const scope = (page: Page, name: 'Organization default' | 'Team' | 'Member') => page.getByRole('radiogroup', { name: 'Policy scope' }).getByRole('radio', { name, exact: true });

async function openTeamPolicy(page: Page, orgId: string, teamName: string) {
  await page.goto(`/o/${orgId}/settings/policies`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tracking policies' })).toBeVisible();
  await scope(page, 'Team').click();
  await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: teamName });
  await expect(page.getByLabel('Idle after', { exact: true })).toBeVisible();
}

test.describe('Tracking policies (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('overrides a team’s policy, confirms what changes, then resets it to inherited', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const team = await ok<{ id: string; name: string }>(await api.post(orgApi('/teams'), { data: { name: `Policy team ${uid()}` } }), 'team');
    await openTeamPolicy(page, data.orgId, team.name);
    await expect(page.getByText('0 overrides')).toBeVisible();
    const idle = page.getByLabel('Idle after', { exact: true });
    const inherited = await idle.inputValue();
    const next = inherited === '15' ? '20' : '15';

    await idle.fill(next);
    await page.getByLabel('Blur screenshots', { exact: true }).click();
    await expect(page.getByText('Unsaved')).toBeVisible();
    await expect(page.getByText('2 overrides')).toBeVisible();

    await page.getByRole('button', { name: 'Save policy' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Save the ${team.name} policy?` }).or(page.getByRole('dialog', { name: `Save the ${team.name} policy?` }));
    await expect(confirm).toContainText(`Everyone in ${team.name} is affected, except members with their own setting.`);
    await expect(confirm).toContainText(`Idle after: — → ${next} min`);
    await expect(confirm).toContainText(/Blur screenshots: — → (On|Off)/);
    await confirm.getByRole('button', { name: 'Save and notify' }).click();
    await expect(page.getByText(/^Policy saved\. Affected members were notified/)).toBeVisible();

    const saved = await ok<{ doc: { idle?: { thresholdMinutes?: number }; screenshots?: { blur?: boolean } } }>(await api.get(orgApi(`/policies/TEAM/${team.id}`)), 'policy');
    expect(saved.doc.idle?.thresholdMinutes).toBe(Number(next));
    expect(typeof saved.doc.screenshots?.blur).toBe('boolean');

    // After a reload the override is marked, with the inherited value next to it.
    await page.reload();
    await scope(page, 'Team').click();
    await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: team.name });
    await expect(page.getByLabel('Idle after', { exact: true })).toHaveValue(next);
    await expect(page.getByText(`Organization default: ${inherited} min`)).toBeVisible();

    // Reset both to inherited and save: the team follows the organization default again.
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Reset to inherited' }).first().click();
    await expect(page.getByText('0 overrides')).toBeVisible();
    await page.getByRole('button', { name: 'Save policy' }).click();
    await page.getByRole('button', { name: 'Save and notify' }).click();
    await expect(page.getByText(/^Policy saved\./)).toBeVisible();
    const reset = await ok<{ doc: Record<string, unknown> }>(await api.get(orgApi(`/policies/TEAM/${team.id}`)), 'policy');
    expect(reset.doc).toEqual({});
  });

  test('an out-of-range value blocks saving until it is corrected; Discard restores what was saved', async ({ page, data, adminApi }) => {
    const team = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/teams'), { data: { name: `Range team ${uid()}` } }), 'team');
    await openTeamPolicy(page, data.orgId, team.name);
    const idle = page.getByLabel('Idle after', { exact: true });
    const before = await idle.inputValue();
    const save = page.getByRole('button', { name: 'Save policy' });

    await idle.fill('500'); // 1–120 minutes
    await expect(idle).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'A value is out of range. Correct the highlighted field to save.' })).toBeVisible();
    await expect(save).toBeDisabled();
    await idle.fill('');
    await expect(save).toBeDisabled();

    await idle.fill('30');
    await expect(idle).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByText('A value is out of range')).toHaveCount(0);
    await expect(save).toBeEnabled();

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(idle).toHaveValue(before);
    await expect(page.getByText('Unsaved')).toHaveCount(0);
    // Nothing reached the server.
    const layer = await ok<{ doc: Record<string, unknown> }>(await adminApi.api.get(adminApi.orgApi(`/policies/TEAM/${team.id}`)), 'policy');
    expect(layer.doc).toEqual({});
  });

  test('switching what is edited with unsaved changes asks first', async ({ page, data, adminApi }) => {
    const team = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/teams'), { data: { name: `Switch team ${uid()}` } }), 'team');
    await openTeamPolicy(page, data.orgId, team.name);
    const idle = page.getByLabel('Idle after', { exact: true });
    const before = await idle.inputValue();
    await idle.fill(before === '45' ? '46' : '45');

    await scope(page, 'Member').click();
    const ask = page.getByRole('alertdialog', { name: 'Discard unsaved policy changes?' }).or(page.getByRole('dialog', { name: 'Discard unsaved policy changes?' }));
    await expect(ask).toContainText(`Your changes to the ${team.name} policy have not been saved.`);
    // Keep editing: nothing changes.
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(scope(page, 'Team')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Unsaved')).toBeVisible();

    // Discard: the member picker appears, with nothing chosen yet.
    await scope(page, 'Member').click();
    await ask.getByRole('button', { name: 'Discard changes' }).click();
    await expect(scope(page, 'Member')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Pick a member')).toBeVisible();
    const layer = await ok<{ doc: Record<string, unknown> }>(await adminApi.api.get(adminApi.orgApi(`/policies/TEAM/${team.id}`)), 'policy');
    expect(layer.doc).toEqual({});
  });

  test('asks for a team before showing team settings', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/policies`);
    await scope(page, 'Team').click();
    await expect(page.getByText('Pick a team')).toBeVisible();
    await expect(page.getByLabel('Idle after', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
  });

  test('the server refuses an invalid policy', async ({ adminApi }) => {
    const team = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/teams'), { data: { name: `Invalid team ${uid()}` } }), 'team');
    const put = await adminApi.api.put(adminApi.orgApi(`/policies/TEAM/${team.id}`), { data: { idle: { thresholdMinutes: 500 } } });
    expect([400, 422]).toContain(put.status());
    const layer = await ok<{ doc: Record<string, unknown> }>(await adminApi.api.get(adminApi.orgApi(`/policies/TEAM/${team.id}`)), 'policy');
    expect(layer.doc).toEqual({});
  });

  test('shows a loading state, then an error with a retry when the policy cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route(`**/api/v1/orgs/${data.orgId}/policies/ORG/**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await new Promise((r) => setTimeout(r, 300));
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) });
      return route.continue();
    });
    await page.goto(`/o/${data.orgId}/settings/policies`);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(page.getByLabel('Idle after', { exact: true })).toBeVisible();
  });
});

test.describe('Tracking policies for people who may not change them', () => {
  test('a team manager sees their team’s policy read-only, and the API refuses a change', async ({ browser, data, adminApi }) => {
    const teams = await ok<Array<{ id: string; name: string }> | { data: Array<{ id: string; name: string }> }>(await adminApi.api.get(adminApi.orgApi('/teams')), 'teams');
    const team = (Array.isArray(teams) ? teams : teams.data).find((t) => t.name === data.teamName)!;
    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await openTeamPolicy(page, data.orgId, data.teamName);
    await expect(page.getByLabel('Idle after', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset to inherited' })).toHaveCount(0);

    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await api.get(`/api/v1/orgs/${data.orgId}/policies/TEAM/${team.id}`)).status()).toBe(200);
    expect((await api.put(`/api/v1/orgs/${data.orgId}/policies/TEAM/${team.id}`, { data: { idle: { thresholdMinutes: 30 } } })).status()).toBe(403);
    expect((await api.put(`/api/v1/orgs/${data.orgId}/policies/ORG/${data.orgId}`, { data: { idle: { thresholdMinutes: 30 } } })).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });

  test('a custom role without policy access is told so, and the API refuses them', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/settings/policies`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(page.getByLabel('Idle after', { exact: true })).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await api.get(`/api/v1/orgs/${data.orgId}/policies/ORG/${data.orgId}`)).status()).toBe(403);
    expect((await api.put(`/api/v1/orgs/${data.orgId}/policies/ORG/${data.orgId}`, { data: { idle: { thresholdMinutes: 30 } } })).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });
});
