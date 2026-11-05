import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Performance overview (Performance Center, web): the score for a period and what it is made of,
 * goals, delivery and recognition, the scoring rules, and who may open it. The only write is a
 * scoring-rules save, which is put back to the weights it found.
 */
const OVERVIEW = /\/api\/v1\/orgs\/[^/]+\/performance\/overview(\?|$)/;

/** What the overview returns when nobody can be scored yet (zero people, nothing due). */
const EMPTY = {
  period: 'MONTH',
  start: '2026-11-01',
  end: '2026-11-30',
  kpis: { active_workers: 0, active_teams: 0, score: null, previous_score: null, achievements: 0, achievements_automatic: 0, goals_completed: 0, goals_due: 0, team_goal_completion: null, project_delivery: null, milestones_on_time: 0, milestones_due: 0 },
  score_trend: Array.from({ length: 6 }, (_, i) => ({ start: `2026-0${i + 6}-01`, score: null })),
  parts: Object.fromEntries(['goals', 'delivery', 'consistency', 'quality', 'attendance'].map((m) => [m, { value: null, weight: 20, measured_for: 0 }])),
  teams: [],
  achievements_by_month: [],
  goals_by_month: [],
  projects: [],
  recognition: [],
};

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const panel = (page: Page, name: string) => page.locator('section, div').filter({ has: page.getByRole('heading', { name, exact: true }) }).last();

test.describe('Performance overview', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens it from the sidebar and sees the score, what it is made of, and the period’s work', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const loaded = page.waitForResponse((r) => OVERVIEW.test(r.url()) && r.url().includes('period=MONTH'));
    await sidebar(page).getByRole('link', { name: 'Performance overview', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance$`));
    expect((await loaded).status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Performance overview' })).toBeVisible();
    const hero = page.getByRole('region', { name: 'Score for the period' });
    await expect(hero).toContainText('Organization score');
    await expect(hero.getByRole('img', { name: /^Score: / })).toBeVisible();
    for (const kpi of ['People', 'Teams', 'Achievements', 'Goals completed', 'Team goal completion', 'Project delivery']) await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible();

    // The five outcomes, with where each comes from, and what is never part of a score.
    const parts = panel(page, 'What the score is made of');
    for (const m of ['Goal completion', 'Project delivery', 'Approved-work consistency', 'Quality', 'Attendance']) await expect(parts.getByText(m, { exact: true })).toBeVisible();
    await expect(parts).toContainText('Ratings in final manager reviews');
    await expect(parts).toContainText('Activity levels, keystrokes and screenshots are never part of a score.');
    for (const title of ['Score trend', 'Teams', 'Attendance by team', 'Achievements by month', 'Goal completion by month', 'Project delivery', 'Recent recognition']) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    // No money, activity or screenshots anywhere on the page.
    await expect(page.getByText(/screenshot taken|activity %|\$\d/i)).toHaveCount(0);
  });

  test('links onward: New goal opens the goal form; All achievements opens what was awarded', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByRole('link', { name: 'All achievements' })).toHaveAttribute('href', `/o/${data.orgId}/performance/achievements?tab=awarded`);
    await page.getByRole('link', { name: 'New goal' }).click();
    await expect(page).toHaveURL(new RegExp(`/performance/goals\\?new=1$`));
    await expect(page.getByRole('dialog', { name: 'New goal' })).toBeVisible();
  });

  test('the period, team and project change what is counted', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByRole('heading', { level: 1, name: 'Performance overview' })).toBeVisible();

    const week = page.waitForResponse((r) => OVERVIEW.test(r.url()) && r.url().includes('period=WEEK'));
    await page.getByRole('radio', { name: 'Week' }).or(page.getByRole('button', { name: 'Week', exact: true })).first().click();
    expect((await week).status()).toBe(200);

    // A previous period, then back to the current one.
    const label = await page.locator('[aria-live="polite"]').first().textContent();
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.locator('[aria-live="polite"]').first()).not.toHaveText(label ?? '');
    await expect(page.getByRole('button', { name: 'Next period' })).toBeEnabled();
    await page.getByRole('button', { name: 'Current', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();

    const team = page.getByLabel('Team', { exact: true });
    const teamId = await team.locator('option', { hasText: data.teamName }).getAttribute('value');
    const byTeam = page.waitForResponse((r) => OVERVIEW.test(r.url()) && r.url().includes(`team_id=${teamId}`));
    await team.selectOption({ label: data.teamName });
    expect((await byTeam).status()).toBe(200);
    await expect(page.getByRole('region', { name: 'Score for the period' })).toContainText(data.teamName);

    const byProject = page.waitForResponse((r) => OVERVIEW.test(r.url()) && r.url().includes(`project_id=${data.projects.website.id}`));
    await page.getByLabel('Project', { exact: true }).selectOption({ label: data.projects.website.name });
    expect((await byProject).status()).toBe(200);
  });

  test('scoring rules: the weights must add up to 100%, and saving makes a new version', async ({ page, data, adminApi }) => {
    const settingsUrl = adminApi.orgApi('/performance/settings');
    const before = await (await adminApi.api.get(settingsUrl)).json();
    try {
      await page.goto(`/o/${data.orgId}/performance`);
      await page.getByRole('button', { name: 'Scoring rules' }).click();
      const dialog = page.getByRole('dialog', { name: 'Scoring rules' });
      await expect(dialog).toContainText(`Version ${before.rules.version}`);

      // 10 more on goals: 110%. Nothing is sent, and the dialog says why.
      let sent = false;
      page.on('request', (r) => {
        if (r.method() === 'PUT' && r.url().endsWith('/performance/settings')) sent = true;
      });
      await dialog.getByLabel('Goal completion').fill(String(before.rules.weights.goals + 10));
      await expect(dialog.getByText('Total: 110% (must be 100%)')).toBeVisible();
      await dialog.getByRole('button', { name: 'Save rules' }).click();
      await expect(dialog.getByRole('alert').filter({ hasText: 'Total: 110%' })).toBeVisible();
      await dialog.getByLabel('Goal completion').fill('');
      await dialog.getByRole('button', { name: 'Save rules' }).click();
      await expect(dialog.getByText('Use a whole number from 0 to 100.')).toBeVisible();
      await dialog.getByLabel('Minimum approved days to be ranked').fill('61');
      await expect(dialog.getByText('Use a whole number from 0 to 60.')).toBeVisible();
      expect(sent).toBe(false);

      // Move 5 points from goals to quality: a valid set, saved as the next version.
      await dialog.getByLabel('Goal completion').fill(String(before.rules.weights.goals - 5));
      await dialog.getByLabel('Quality').fill(String(before.rules.weights.quality + 5));
      await dialog.getByLabel('Minimum approved days to be ranked').fill(String(before.rules.min_eligible_days));
      await expect(dialog.getByText('Total: 100% (must be 100%)')).toBeVisible();
      await dialog.getByRole('button', { name: 'Save rules' }).click();
      await expect(page.getByText(`Scoring rules saved as version ${before.rules.version + 1}`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('region', { name: 'Score for the period' })).toContainText(`Scoring rules v${before.rules.version + 1}`);
    } finally {
      // Put the weights back (one more version), so other tests see the rules they expect.
      const res = await adminApi.api.put(settingsUrl, { data: { weights: before.rules.weights, min_eligible_days: before.rules.min_eligible_days } });
      expect(res.status()).toBe(200);
    }
  });

  test('says when it is loading, explains a failure and recovers with Try again', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let fail = true;
    await page.route(OVERVIEW, async (route) => {
      await held;
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fallback();
    });
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByRole('status', { name: 'Loading performance' })).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('region', { name: 'Score for the period' })).toBeVisible();
  });

  test('with nobody to score yet, it says so and what to do next, and shows no zeros as scores', async ({ page, data }) => {
    await page.route(OVERVIEW, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }));
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByText('No one to score yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Members' })).toHaveAttribute('href', `/o/${data.orgId}/workers`);
    await expect(page.getByRole('region', { name: 'Score for the period' })).toContainText('Not enough measured yet for a score');
    for (const empty of ['No scores yet', 'No teams', 'No scheduled shifts', 'No achievements yet', 'No goals due', 'No milestones in this period', 'No recognition yet']) await expect(page.getByText(empty, { exact: true })).toBeVisible();
    await expect(panel(page, 'What the score is made of').getByText('Not measured')).toHaveCount(5);
  });

  test('on a phone it fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByRole('region', { name: 'Score for the period' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Performance overview: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without performance access has no Performance menu, and the page and API refuse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/performance`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Score for the period' })).toHaveCount(0);
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/performance/overview`, { headers: { Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });
});
