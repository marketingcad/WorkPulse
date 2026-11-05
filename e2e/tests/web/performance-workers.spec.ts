import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Worker performance (Performance Center, web): the list of people with their score, one person's
 * profile, and manager reviews with a private note that is clearly marked. The review written here is
 * deleted at the end.
 */
const MEMBERS = /\/api\/v1\/orgs\/[^/]+\/performance\/members(\?|$)/;
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const feedback = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Manager feedback', exact: true }) });

test.describe('Worker performance', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens the list from the sidebar, then a person’s profile', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await sidebar(page).getByRole('link', { name: 'Worker performance', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/workers$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Worker performance' })).toBeVisible();
    for (const h of ['Person', 'Teams', 'Score', 'Approved time', 'Goals', 'Attendance']) await expect(page.getByRole('columnheader', { name: h }).first()).toBeVisible();

    await page.getByRole('row').filter({ hasText: data.worker.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`/performance/workers/${data.worker.membershipId}\\?period=MONTH$`));
    await expect(page.getByRole('heading', { level: 1, name: data.worker.name })).toBeVisible();
    await expect(page.getByRole('region', { name: 'score' }).getByRole('img', { name: /^Score: / })).toBeVisible();
    for (const h of ['Score over time', 'Score breakdown', 'Project contributions', 'Goals', 'Achievements', 'Score history', 'Manager feedback']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    await expect(page.getByText('Only their managers and admins')).toBeVisible();
    // Sidebar keeps Worker performance highlighted on a profile.
    await expect(sidebar(page).getByRole('link', { name: 'Worker performance', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Worker performance' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/workers$`));
  });

  test('the profile header shows their projects and badges; Set a goal opens the form for them', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/workers/${data.worker.membershipId}`);
    await expect(page.getByRole('heading', { level: 1, name: data.worker.name })).toBeVisible();
    await expect(page.getByText(/No badges yet|\d+ badges?/).first()).toBeVisible();
    await page.getByRole('link', { name: 'Set a goal' }).click();
    const dialog = page.getByRole('dialog', { name: 'New goal' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('For')).toHaveValue('MEMBER');
    await expect(dialog.getByLabel('Who or what')).toHaveValue(data.worker.membershipId);
  });

  test('a review: what is wrong is said; the private note is marked; edit, then delete', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/workers/${data.worker.membershipId}`);
    await expect(page.getByRole('heading', { level: 1, name: data.worker.name })).toBeVisible();
    await page.getByRole('button', { name: 'Add review' }).click();
    const dialog = page.getByRole('dialog', { name: `Add review for ${data.worker.name}` });
    await dialog.getByLabel('Period from').fill('2026-11-20');
    await dialog.getByLabel('Period to').fill('2026-11-01');
    await dialog.getByRole('button', { name: 'Save review' }).click();
    await expect(dialog.getByText('The period must end on or after it starts.')).toBeVisible();
    await dialog.getByLabel('Period from').fill('2026-11-01');
    await dialog.getByLabel('Period to').fill('2026-11-30');
    await dialog.getByLabel('Strengths').fill('Design systems, Client workshops');
    await expect(dialog.getByText(`Never shown to ${data.worker.name}`, { exact: false })).toBeVisible();
    await dialog.getByLabel('Private note').fill('E2E private note: ready for a senior role.');
    await dialog.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByText('Review saved')).toBeVisible();

    const review = feedback(page).getByRole('listitem').filter({ hasText: 'E2E private note' });
    await expect(review).toContainText('Draft');
    await expect(review).toContainText('Not shared');
    await expect(review).toContainText(`Private note · never shown to ${data.worker.name}`);
    await expect(review).toContainText('Client workshops');

    await review.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: `Edit review for ${data.worker.name}` });
    await expect(edit.getByLabel('Private note')).toHaveValue('E2E private note: ready for a senior role.');
    await edit.getByLabel('Quality rating').selectOption({ label: '4 of 5' });
    await edit.getByRole('button', { name: 'Save review' }).click();
    await expect(edit).toBeHidden();
    await expect(review).toContainText('4 of 5');
    // The private note is kept by an edit.
    await expect(review).toContainText('E2E private note: ready for a senior role.');

    await review.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete this review?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Review deleted')).toBeVisible();
    await expect(feedback(page).getByText('E2E private note')).toHaveCount(0);
  });

  test('someone not in the organization, or out of reach, is “not found”, with a way back', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/workers/0190a000-0000-7000-8000-00000000dead`);
    await expect(page.getByText('This person was not found, or is not in a team you manage.')).toBeVisible();
    await page.getByRole('link', { name: 'Worker performance' }).last().click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/workers$`));
  });

  test('the list says when it is loading, explains a failure and recovers; nobody to show is said', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let mode: 'fail' | 'empty' = 'fail';
    await page.route(MEMBERS, async (route) => {
      await held;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ start: '2026-11-01', end: '2026-11-30', rows: [] }) });
    });
    await page.goto(`/o/${data.orgId}/performance/workers`);
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    mode = 'empty';
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Nobody to show')).toBeVisible();
  });

  test('a profile on a phone fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance/workers/${data.worker.membershipId}`);
    await expect(page.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Worker performance: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without performance access has no menu item, and the pages and API refuse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/performance/workers/${data.worker.membershipId}`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/members/${data.worker.membershipId}/profile`)).status()).toBe(403);
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/members/${data.worker.membershipId}/reviews`)).status()).toBe(403);
  });
});
