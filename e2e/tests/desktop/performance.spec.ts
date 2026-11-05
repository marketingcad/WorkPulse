import type { Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';

/**
 * My performance in the desktop app (Performance Center): the worker's own week, goals, badges,
 * recognition and milestones; their score only when the organization shares it; and the saved copy
 * when it cannot be refreshed. Never anyone else's data or a ranking. Anything this file changes in
 * the shared organization is put back.
 */
const open = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'My performance', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My performance' })).toBeVisible();
};

test.describe('My performance', () => {
  // One test switches score sharing on for the shared organization; the others must not run meanwhile.
  test.describe.configure({ mode: 'serial' });

  test('a worker opens My performance: their week, goals, badges and recognition, and no score unless shared', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await open(page);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'My performance', exact: true })).toHaveAttribute('aria-current', 'page');
    const week = page.getByRole('region', { name: 'This week' });
    for (const k of ['Approved this week', 'Tasks done this week', 'Consistency streak', 'Badges']) await expect(week.getByText(k, { exact: true })).toBeVisible();
    for (const h of ['My goals', 'Next badge', 'My badges', 'Recognition', 'My milestones']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    await expect(page.getByText('Never your activity or screenshots.', { exact: false })).toBeVisible();
    // Scores are not shared with workers by default.
    await expect(page.getByRole('heading', { name: 'Your score this month' })).toHaveCount(0);
    // Only their own data: no ranking anywhere.
    await expect(page.locator('body')).not.toContainText(/leaderboard|rank/i);
  });

  test('recognition from a manager shows with what they said', async ({ page, openDesktop, workerDevice, data, adminApi }) => {
    const name = `Desk Helper ${uid()}`;
    const def = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/performance/achievements'), { data: { name, description: 'Helped a teammate', category: 'TEAMWORK', icon: 'heart', mode: 'MANUAL', recurrence: 'ONCE' } }), 'achievement');
    const award = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/performance/awards'), { data: { definition_id: def.id, membership_id: data.worker.membershipId, reason: 'Covered the release checklist', notify: false } }), 'award');
    try {
      await openDesktop(workerDevice);
      await open(page);
      const recognition = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recognition', exact: true }) });
      await expect(recognition).toContainText(name);
      await expect(recognition).toContainText('“Covered the release checklist”');
      await expect(recognition).toContainText('From your manager');
      await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'My badges', exact: true }) })).toContainText(name);
    } finally {
      await adminApi.api.post(adminApi.orgApi(`/performance/awards/${award.id}/revoke`), { data: { reason: 'E2E clean-up' } });
      await adminApi.api.post(adminApi.orgApi(`/performance/achievements/${def.id}/archive`));
    }
  });

  test('the score shows only when the organization shares it with workers', async ({ page, openDesktop, workerDevice, adminApi }) => {
    const url = adminApi.orgApi('/performance/settings');
    const before = await (await adminApi.api.get(url)).json();
    try {
      await ok(await adminApi.api.put(url, { data: { workers_see_own_score: true } }), 'share scores');
      await openDesktop(workerDevice);
      await open(page);
      const score = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your score this month' }) });
      await expect(score).toBeVisible();
      await expect(score).toContainText('Shared by your organization');
    } finally {
      await ok(await adminApi.api.put(url, { data: { workers_see_own_score: before.workers_see_own_score } }), 'restore');
    }
  });

  test('when it cannot be refreshed, the saved copy is shown and labelled', async ({ page, openDesktop, workerDevice, data }) => {
    const saved = {
      at: '2026-11-05T09:30:00.000Z',
      data: {
        week: { start: '2026-11-02', end: '2026-11-08', approved_seconds: 7200, scheduled_seconds: 0, tasks_done: 2, tasks_due: 3, streak_weeks: 4 },
        goals: [{ id: 'g1', title: 'Saved goal', subject_type: 'MEMBER', subject_name: 'Wade', metric: 'TASKS_COMPLETED', target: 4, current: 2, progress_pct: 50, status: 'ACTIVE', pace: 'ON_TRACK', end_date: '2026-11-30' }],
        badges: [],
        recognition: [],
        next_badge: null,
        milestones: [],
        score: null,
        trend: [],
        reviews: [],
      },
    };
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [`wp.myPerformance.${data.worker.membershipId}`, JSON.stringify(saved)] as const);
    await openDesktop(workerDevice, { offline: ['performance'] });
    await open(page);
    await expect(page.getByRole('status').filter({ hasText: 'Showing the copy saved' })).toBeVisible();
    await expect(page.getByText('Saved goal')).toBeVisible();
    await expect(page.getByRole('region', { name: 'This week' })).toContainText('4 weeks');
  });

  test('with nothing saved and no connection, it explains and offers Try again', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { offline: ['performance'] });
    await open(page);
    await expect(page.getByText('Could not reach the server', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
