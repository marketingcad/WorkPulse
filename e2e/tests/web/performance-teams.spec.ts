import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Team performance (Performance Center, web): up to three teams side by side, their score over time
 * and their people; ranks hidden when the organization hides them from managers; empty, loading and
 * error states; and who cannot open it. Nothing here writes data.
 */
const TEAMS = /\/api\/v1\/orgs\/[^/]+\/performance\/teams(\?|$)/;
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const PERIODS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];
const team = (id: string, name: string, score: number | null, rank: number | null) => ({
  id,
  name,
  members: 2,
  rank,
  score,
  approved_seconds: 36000,
  goals: { completed: 3, due: 4 },
  milestones: { on_time: 0, due: 0, done: 0, total: 0 },
  attendance: { on_time: 9, scheduled: 10 },
  achievements: 2,
  history: [null, 70, 72, null, 74, score],
  people: [
    { id: `${id}-1`, name: `${name} Lead`, title: 'Designer', manager: true, score: 80, approved_seconds: 18000, eligible: true },
    { id: `${id}-2`, name: `${name} Member`, title: null, manager: false, score: null, approved_seconds: 18000, eligible: false },
  ],
});
const body = (teams: unknown[], ranksHidden = false) => JSON.stringify({ period: 'MONTH', start: '2026-11-01', end: '2026-11-30', periods: PERIODS, ranks_hidden: ranksHidden, teams });

test.describe('Team performance', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens it from the sidebar and sees each team’s score, measures and people', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const loaded = page.waitForResponse((r) => TEAMS.test(r.url()));
    await sidebar(page).getByRole('link', { name: 'Team performance', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/teams$`));
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Team performance' })).toBeVisible();

    const card = page.getByRole('region', { name: data.teamName, exact: true });
    await expect(card).toBeVisible();
    for (const k of ['Approved time', 'Goals', 'Milestones on time', 'Attendance', 'Achievements']) await expect(card.getByText(k, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Score over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${data.teamName} · people` })).toBeVisible();
    const side = page.getByRole('region', { name: 'Side by side' });
    for (const r of ['Score', 'Goal completion', 'Milestones on time', 'Attendance', 'Approved time', 'Achievements']) await expect(side.getByRole('rowheader', { name: new RegExp(`^${r}`) })).toBeVisible();
  });

  test('compares up to three teams; a fourth waits until one is removed', async ({ page, data }) => {
    await page.route(TEAMS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: body([team('a', 'Design', 86, 1), team('b', 'Engineering', 81, 2), team('c', 'Support', 77, 3), team('d', 'Marketing', 60, 4)]) }));
    await page.goto(`/o/${data.orgId}/performance/teams`);
    const picker = page.getByRole('group', { name: 'Choose up to three teams to compare' });
    // The three best-scoring teams are compared first.
    for (const n of ['Design', 'Engineering', 'Support']) await expect(picker.getByRole('button', { name: n })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByRole('button', { name: 'Marketing' })).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Design', exact: true })).toContainText('#1 of 4');
    await expect(page.getByRole('region', { name: 'Design', exact: true })).toContainText('+12 vs the previous period');

    await picker.getByRole('button', { name: 'Support' }).click();
    await expect(page.getByRole('region', { name: 'Support', exact: true })).toHaveCount(0);
    await picker.getByRole('button', { name: 'Marketing' }).click();
    await expect(page.getByRole('region', { name: 'Marketing', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Side by side' }).getByRole('columnheader', { name: 'Marketing' })).toBeVisible();

    // People: one team at a time; someone below the minimum is shown as not ranked.
    await page.getByLabel('Team', { exact: true }).selectOption({ label: 'Engineering' });
    await expect(page.getByRole('heading', { name: 'Engineering · people' })).toBeVisible();
    await expect(page.getByText('Engineering Member', { exact: true })).toBeVisible();
    // Each person opens their profile.
    await expect(page.getByRole('link', { name: 'Engineering Member', exact: true })).toHaveAttribute('href', `/o/${data.orgId}/performance/workers/b-2`);
    await expect(page.getByText(/not ranked/)).toBeVisible();
    // A table of the six periods for screen readers, with gaps as dashes (never zero).
    await expect(page.locator('table.sr-only caption')).toHaveText('Team scores over the last six periods');
  });

  test('when ranks are hidden from managers, no rank is shown anywhere', async ({ page, data }) => {
    await page.route(TEAMS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: body([team('a', 'Design', 86, null)], true) }));
    await page.goto(`/o/${data.orgId}/performance/teams`);
    await expect(page.getByText('Ranks are hidden from managers in this organization.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Design', exact: true })).not.toContainText('#');
    await expect(page.getByRole('region', { name: 'Side by side' }).getByRole('rowheader', { name: 'Rank' })).toHaveCount(0);
  });

  test('empty, loading and error states', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let mode: 'fail' | 'empty' = 'fail';
    await page.route(TEAMS, async (route) => {
      await held;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: body([]) });
    });
    await page.goto(`/o/${data.orgId}/performance/teams`);
    await expect(page.getByRole('status', { name: 'Loading performance' })).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    mode = 'empty';
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No teams to compare')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Teams' })).toHaveAttribute('href', `/o/${data.orgId}/teams`);
  });

  test('on a phone it fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance/teams`);
    await expect(page.getByRole('region', { name: data.teamName, exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Team performance: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without performance access has no menu item, and the page and API refuse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/performance/teams`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/teams`)).status()).toBe(403);
  });
});
