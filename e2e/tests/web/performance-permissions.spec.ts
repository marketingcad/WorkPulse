import { expect, test } from '../../support/fixtures';
import { request } from '@playwright/test';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Performance Center, phase 1: the new permissions on the Roles screen, in plain words, with the
 * organization-wide ones (scoring rules, the achievement catalogue) offered at organization scope only.
 * Nothing here saves data: the shared organization's roles and rules stay as they are.
 */
test.describe('Performance permissions', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the Roles screen lists the performance permissions with what they allow', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    for (const heading of ['Performance', 'Goals', 'Achievements', 'Performance reviews']) {
      await expect(page.getByRole('rowheader', { name: heading, exact: true }).or(page.getByText(heading, { exact: true })).first()).toBeVisible();
    }
    await expect(page.getByText('Change scoring rules and who sees rankings').first()).toBeVisible();
    await expect(page.getByText('Recognize people with an achievement').first()).toBeVisible();
  });

  test('a custom role can only get scoring rules and the achievement catalogue for the whole organization', async ({ page, data, adminApi }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await page.getByRole('button', { name: /Create custom role/ }).first().click();
    const dialog = page.getByRole('dialog');
    for (const p of ['performance:manage', 'achievements:manage']) {
      expect(await dialog.locator(`[id="g-${p}"] option`).allTextContents(), p).toEqual(['—', 'Org']);
    }
    // Team-level ones offer every scope.
    expect(await dialog.locator('[id="g-reviews:manage"] option').allTextContents()).toEqual(['—', 'Own', 'Assigned', 'Team', 'Org']);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const r = await adminApi.api.post(adminApi.orgApi('/roles'), { data: { name: 'Team rules (refused)', grants: { 'performance:manage': 'team' } } });
    expect(r.status()).toBe(400);
  });

  test('someone without the permission can read the scoring rules but not change them', async ({ data }) => {
    // A worker holds performance:read for their own progress, and nothing that changes the rules.
    const api = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    try {
      const base = `/api/v1/orgs/${data.orgId}/performance/settings`;
      const read = await api.get(base);
      expect(read.status()).toBe(200);
      expect((await read.json()).rules.weights).toMatchObject({ goals: expect.any(Number) });
      expect((await api.put(base, { data: { leaderboard_workers: true } })).status()).toBe(403);
      expect((await api.get(`/api/v1/orgs/${data.orgId}/performance/settings`)).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });
});
