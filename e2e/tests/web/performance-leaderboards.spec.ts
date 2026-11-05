import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Leaderboards (Performance Center, web): people, teams and projects ranked by score for a period,
 * compared within the role family; how ranking works; who may see rankings (admins switch it); and
 * who cannot open it. The visibility test puts the setting back the way it found it.
 */
const BOARD = /\/api\/v1\/orgs\/[^/]+\/performance\/leaderboard(\?|$)/;
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const choose = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).or(page.getByRole('button', { name, exact: true })).first();

const board = (rows: unknown[]) => ({ type: 'workers', period: 'MONTH', start: '2026-11-01', end: '2026-11-30', rule_version: 1, min_eligible_days: 10, compare: 'role', summary_only: false, ranked: rows.length, rows });
const row = (id: string, name: string, rank: number | null, score: number | null, movement: number | null) => ({ id, name, sub: 'Designer', rank, movement, score, eligible: rank !== null, goals: { completed: 2, due: 3 }, delivery: { on_time: 4, due: 5 }, achievements: 1, trend: [60, 62, null, 70, 72, score] });

test.describe('Leaderboards', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens it from the sidebar and switches between people, teams and projects', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const first = page.waitForResponse((r) => BOARD.test(r.url()) && r.url().includes('type=workers'));
    await sidebar(page).getByRole('link', { name: 'Leaderboards', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/leaderboards$`));
    expect((await first).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Leaderboards' })).toBeVisible();
    await expect(page.getByText('Never by hours, keyboard activity or screenshots.', { exact: false })).toBeVisible();
    for (const h of ['Rank', 'Name', 'Score', 'Goals', 'Delivery', 'Achievements', 'Trend']) await expect(page.getByRole('columnheader', { name: h }).first()).toBeVisible();

    const everyone = page.waitForResponse((r) => BOARD.test(r.url()) && r.url().includes('compare=everyone'));
    await choose(page, 'Everyone').click();
    expect((await everyone).status()).toBe(200);

    const teams = page.waitForResponse((r) => BOARD.test(r.url()) && r.url().includes('type=teams'));
    await choose(page, 'Teams').click();
    expect((await teams).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: data.teamName })).toBeVisible();
    // "Compare within" is about people only.
    await expect(page.getByRole('group', { name: 'Compare within' })).toHaveCount(0);

    const projects = page.waitForResponse((r) => BOARD.test(r.url()) && r.url().includes('type=projects'));
    await choose(page, 'Projects').click();
    expect((await projects).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: data.projects.website.name })).toBeVisible();

    const how = page.locator('section').filter({ has: page.getByRole('heading', { name: 'How ranking works' }) });
    await expect(how).toContainText('compared within their role family');
    await expect(how).toContainText('Fewer than 10 approved days');
  });

  test('a person on the board opens their profile', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    await page.getByRole('row').filter({ hasText: data.worker.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`/performance/workers/${data.worker.membershipId}$`));
    await expect(page.getByRole('heading', { level: 1, name: data.worker.name })).toBeVisible();
  });

  test('the podium and table show rank, movement and who is not ranked', async ({ page, data }) => {
    await page.route(BOARD, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board([row('a', 'Ava Stone', 1, 91, 2), row('b', 'Ben Ito', 2, 84, -1), row('c', 'Cy Park', 3, 80, 0), row('d', 'Dee Moss', null, null, null)])) }));
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    const podium = page.getByRole('region', { name: 'Top three' });
    await expect(podium).toContainText('Ava Stone');
    await expect(podium).toContainText('Rank 1');
    await expect(podium.getByText('Up 2')).toBeAttached();
    const ben = page.getByRole('row').filter({ hasText: 'Ben Ito' });
    await expect(ben.getByText('Down 1')).toBeAttached();
    await expect(ben).toContainText('2 of 3');
    await expect(page.getByRole('row').filter({ hasText: 'Dee Moss' })).toContainText('Not ranked');
    await expect(page.getByRole('img', { name: 'Scores over the last six periods for Ava Stone' })).toBeVisible();
  });

  test('an admin switches who sees rankings, and it is saved', async ({ page, data, adminApi }) => {
    const url = adminApi.orgApi('/performance/settings');
    const before = await (await adminApi.api.get(url)).json();
    try {
      await page.goto(`/o/${data.orgId}/performance/leaderboards`);
      const who = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Who can see this' }) });
      const workers = who.getByRole('switch', { name: /Workers/ }).or(who.getByRole('checkbox', { name: /Workers/ })).first();
      await expect(workers).not.toBeChecked();
      const saved = page.waitForResponse((r) => r.url().endsWith('/performance/settings') && r.request().method() === 'PUT');
      await workers.click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByText('Visibility saved')).toBeVisible();
      expect((await (await adminApi.api.get(url)).json()).leaderboard_workers).toBe(true);
    } finally {
      expect((await adminApi.api.put(url, { data: { leaderboard_workers: before.leaderboard_workers, leaderboard_managers: before.leaderboard_managers } })).status()).toBe(200);
    }
  });

  test('when rankings are turned off for the viewer, it says so instead of an error', async ({ page, data }) => {
    await page.route(BOARD, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ title: 'Leaderboards are turned off for managers in this organization.', status: 403, code: 'forbidden' }) }));
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    await expect(page.getByText('Leaderboards are turned off for managers in this organization.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('empty, loading and error states', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let mode: 'fail' | 'empty' = 'fail';
    await page.route(BOARD, async (route) => {
      await held;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board([])) });
    });
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    await expect(page.getByRole('status', { name: 'Loading performance' })).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    mode = 'empty';
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Nobody to rank in this period')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Top three' })).toHaveCount(0);
  });

  test('on a phone it fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    await expect(page.getByRole('heading', { level: 1, name: 'Leaderboards' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How ranking works' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Leaderboards: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without performance access has no menu item, and the page and API refuse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/performance/leaderboards`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/leaderboard`)).status()).toBe(403);
  });
});
