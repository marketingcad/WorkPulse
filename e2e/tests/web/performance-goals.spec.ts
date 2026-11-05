import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Goals & challenges (Performance Center, web): setting a goal measured from real work, only the
 * measures that apply to its subject, its progress history, editing, archiving, filters, empty,
 * loading and error states, and who cannot open it. The goal made here is archived at the end.
 */
const GOALS = /\/api\/v1\/orgs\/[^/]+\/performance\/goals(\?|$)/;
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const card = (page: Page, title: string) => page.getByRole('button').filter({ hasText: title });
const choose = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).or(page.getByRole('button', { name, exact: true })).first();

test.describe('Goals', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens Goals from the Performance tabs', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await sidebar(page).getByRole('link', { name: 'Goals & challenges', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/goals$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Goals & challenges' })).toBeVisible();
    await expect(page.getByText('Nobody types progress in.', { exact: false })).toBeVisible();
    for (const k of ['Active', 'At risk', 'Completed', 'Missed']) await expect(page.getByText(k, { exact: true }).first()).toBeVisible();
  });

  test('set a goal for a person, follow its progress, change its target, then archive it', async ({ page, data }) => {
    const title = `Ship the beta ${Date.now().toString(36)}`;
    await page.goto(`/o/${data.orgId}/performance/goals`);
    await page.getByRole('button', { name: 'New goal' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New goal' });

    // Nothing is sent until the goal is named, has a subject and a target.
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(dialog.getByText('Name the goal.')).toBeVisible();
    await expect(dialog.getByText('Choose who or what the goal is for.')).toBeVisible();
    await expect(dialog.getByText('Enter a target above 0.')).toBeVisible();

    // A person's goal is never measured by milestones (they belong to projects).
    await expect(dialog.getByLabel('Measured by').locator('option', { hasText: 'Milestones completed' })).toHaveCount(0);
    await dialog.getByLabel('For').selectOption({ label: 'Team' });
    await expect(dialog.getByLabel('Measured by').locator('option', { hasText: 'Milestones completed' })).toHaveCount(1);
    await dialog.getByLabel('For').selectOption({ label: 'Person' });

    await dialog.getByPlaceholder('For example: Ship the beta').fill(title);
    const worker = (await dialog.getByLabel('Who or what').locator('option', { hasText: data.worker.name }).first().getAttribute('value'))!;
    await dialog.getByLabel('Who or what').selectOption(worker);
    await dialog.getByLabel('Measured by').selectOption({ label: 'Tasks completed — Measured from tasks marked done' });
    await dialog.getByLabel('Target').fill('3');
    await dialog.getByLabel('Ends').fill('2020-01-01');
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(dialog.getByText('The end date must be on or after the start date.')).toBeVisible();
    await dialog.getByLabel('Ends').fill('2099-12-31');
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByText(`Goal set for ${data.worker.name}`)).toBeVisible();

    const goal = card(page, title);
    await expect(goal).toContainText(`Person · ${data.worker.name}`);
    await expect(goal).toContainText('of 3');
    await expect(goal).toContainText('Measured from tasks marked done');

    // The drawer: where progress comes from, and its history.
    await goal.click();
    const drawer = page.getByRole('dialog', { name: title });
    await expect(drawer).toContainText('Progress history');
    await expect(drawer).toContainText('when the goal was set');

    // Edit: the target and end date can change; what it measures cannot.
    await drawer.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit goal' });
    await expect(edit.getByLabel('Measured by')).toBeDisabled();
    await edit.getByLabel('Target').fill('5');
    await edit.getByRole('button', { name: 'Save goal' }).click();
    await expect(edit).toBeHidden();
    await expect(card(page, title)).toContainText('of 5');

    // Archive: it leaves the list, and is found under Archived.
    await card(page, title).click();
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog', { name: 'Archive this goal?' }).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Goal archived')).toBeVisible();
    await expect(card(page, title)).toHaveCount(0);
    await page.getByLabel('Status').selectOption({ label: 'Archived' });
    await expect(card(page, title)).toBeVisible();
  });

  test('filters ask the server for one kind of goal, and say when nothing matches', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/goals`);
    const teams = page.waitForResponse((r) => GOALS.test(r.url()) && r.url().includes('subject_type=TEAM'));
    await choose(page, 'Teams').click();
    expect((await teams).status()).toBe(200);
    // A team narrows to that team's goals.
    const team = page.getByLabel('Team', { exact: true });
    const teamId = await team.locator('option', { hasText: data.teamName }).getAttribute('value');
    const byTeam = page.waitForResponse((r) => GOALS.test(r.url()) && r.url().includes(`team_id=${teamId}`));
    await team.selectOption({ label: data.teamName });
    expect((await byTeam).status()).toBe(200);
    await team.selectOption({ label: 'All teams' });
    // "At risk" asks for active goals and keeps those behind their pace.
    const ahead = { id: 'g1', title: 'Ahead goal', description: null, category: null, subject_type: 'MEMBER', subject_id: 'm', subject_name: 'Ana', metric: 'TASKS_COMPLETED', target: 4, current: 3, progress_pct: 75, status: 'ACTIVE', pace: 'AHEAD', start_date: '2026-11-01', end_date: '2026-11-30', completed_at: null, created_by: null };
    const behind = { ...ahead, id: 'g2', title: 'Behind goal', current: 1, progress_pct: 25, pace: 'AT_RISK' };
    await page.route(GOALS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('status=ACTIVE') ? [ahead, behind] : []) }));
    await page.getByLabel('Status').selectOption({ label: 'At risk' });
    await expect(card(page, 'Behind goal')).toBeVisible();
    await expect(card(page, 'Ahead goal')).toHaveCount(0);
    await page.getByLabel('Status').selectOption({ label: 'Missed' });
    await expect(page.getByText('No goals match these filters')).toBeVisible();
  });

  test('with no goals yet it says what to do; loading and failure are explained', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let mode: 'fail' | 'empty' = 'fail';
    await page.route(GOALS, async (route) => {
      await held;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto(`/o/${data.orgId}/performance/goals`);
    await expect(page.getByRole('status', { name: 'Loading performance' })).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    mode = 'empty';
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No goals here')).toBeVisible();
    await expect(page.getByText('Set a goal for a person, a team or a project.', { exact: false })).toBeVisible();
  });

  test('on a phone it fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance/goals`);
    await expect(page.getByRole('heading', { level: 1, name: 'Goals & challenges' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Goals: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without goals access cannot open the page, and the API refuses', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/goals`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/goals`)).status()).toBe(403);
    expect((await page.request.post(`/api/v1/orgs/${data.orgId}/performance/goals`, { data: { title: 'x', subject_type: 'ORG', metric: 'TASKS_COMPLETED', target: 1, start_date: '2026-11-01', end_date: '2026-11-30' }, headers: { Origin: new URL(page.url()).origin } })).status()).toBe(403);
  });
});
