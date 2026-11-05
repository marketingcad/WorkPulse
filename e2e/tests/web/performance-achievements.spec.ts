import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * Achievements & recognition (Performance Center, web): the catalog, creating a custom achievement,
 * recognizing someone with a reason (once per period), revoking, client appreciation waiting for
 * approval, and who may open it. Each run makes its own once-only achievement, so a retry never meets
 * an award from an earlier attempt; it is archived at the end.
 */
const ACHIEVEMENTS = /\/api\/v1\/orgs\/[^/]+\/performance\/achievements(\?|$)/;
const APPRECIATIONS = /\/api\/v1\/orgs\/[^/]+\/performance\/appreciations(\?|$)/;
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });
const card = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });
const recognize = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recognize someone', exact: true }) });

test.describe('Achievements', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin opens the catalog from the sidebar: built-in badges, how each is earned, and its levels', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await sidebar(page).getByRole('link', { name: 'Achievements', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/performance/achievements$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Achievements & recognition' })).toBeVisible();

    const champion = card(page, 'Productivity Champion');
    await expect(champion).toContainText('Automatic');
    await expect(champion.getByRole('list', { name: 'Levels' })).toContainText('Bronze');
    await expect(champion.getByRole('list', { name: 'Levels' })).toContainText('Platinum');
    await expect(card(page, 'Team Player')).toContainText('Manager-awarded');
    await expect(card(page, 'Client Hero')).toContainText('From client appreciation');

    // Category chips filter the catalog.
    await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Teamwork' }).click();
    await expect(card(page, 'Team Player')).toBeVisible();
    await expect(card(page, 'Productivity Champion')).toHaveCount(0);
    await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'All' }).click();
    await expect(card(page, 'Productivity Champion')).toBeVisible();
  });

  test('create a custom achievement, recognize someone with it once, then revoke it with a reason', async ({ page, data }) => {
    const name = `Launch Hero ${Date.now().toString(36)}`;
    await page.goto(`/o/${data.orgId}/performance/achievements`);

    // Create: what is missing is said, and automatic levels must go up.
    await page.getByRole('button', { name: 'Create achievement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create achievement' });
    await dialog.getByRole('button', { name: 'Create achievement' }).click();
    await expect(dialog.getByText('Give it a name.')).toBeVisible();
    await expect(dialog.getByText('Say what it is for.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Automatic' }).or(dialog.getByRole('button', { name: 'Automatic', exact: true })).first().click();
    await dialog.getByLabel('Bronze').fill('5');
    await dialog.getByLabel('Silver').fill('3');
    await dialog.getByRole('button', { name: 'Create achievement' }).click();
    await expect(dialog.getByText('Use whole numbers above 0, each higher than the one before, with no gaps.')).toBeVisible();

    // A manager-awarded one, given once ever.
    await dialog.getByRole('radio', { name: 'Manager-awarded' }).or(dialog.getByRole('button', { name: 'Manager-awarded', exact: true })).first().click();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('What it is for').fill('Carried a launch over the line.');
    await dialog.getByLabel('Category').selectOption({ label: 'Teamwork' });
    await dialog.getByLabel('How often').selectOption({ label: 'Once ever' });
    await dialog.getByRole('button', { name: 'Create achievement' }).click();
    await expect(page.getByText(`${name} created`)).toBeVisible();
    await expect(card(page, name)).toContainText('Custom');

    // Recognize: nothing is sent until who, what and why are given.
    const form = recognize(page);
    await form.getByRole('button', { name: 'Award recognition' }).click();
    await expect(form.getByText('Choose who to recognize.')).toBeVisible();
    await expect(form.getByText('Choose an achievement.')).toBeVisible();
    await expect(form.getByText('Say what they did.')).toBeVisible();
    const worker = (await form.getByRole('combobox', { name: 'Who' }).locator('option', { hasText: data.worker.name }).first().getAttribute('value'))!;
    await form.getByRole('combobox', { name: 'Who' }).selectOption(worker);
    await form.getByLabel('Achievement').selectOption({ label: name });
    await form.getByLabel('Reason').fill('Stayed late to fix the release checklist.');
    await form.getByRole('button', { name: 'Award recognition' }).click();
    await expect(page.getByText(`${name} given to ${data.worker.name}`)).toBeVisible();

    // The same achievement twice in its period is refused, with the server's reason.
    await form.getByRole('combobox', { name: 'Who' }).selectOption(worker);
    await form.getByLabel('Reason').fill('Again.');
    await form.getByRole('button', { name: 'Award recognition' }).click();
    await expect(form.getByRole('alert').filter({ hasText: 'was already given for this period' })).toBeVisible();

    // Awarded: listed with the reason; revoked with a reason, it leaves the list.
    await page.getByRole('button', { name: /^Awarded/ }).or(page.getByRole('tab', { name: /^Awarded/ })).first().click();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText(data.worker.name);
    await expect(row).toContainText('Stayed late to fix the release checklist.');
    await row.getByRole('button', { name: /^Revoke/ }).click();
    const revoke = page.getByRole('dialog', { name: `Revoke ${name} from ${data.worker.name}?` });
    await revoke.getByRole('button', { name: 'Revoke award' }).click();
    await expect(revoke.getByText('Say why it is revoked.')).toBeVisible();
    await revoke.getByLabel('Reason').fill('Given to the wrong person.');
    await revoke.getByRole('button', { name: 'Revoke award' }).click();
    await expect(page.getByText('Award revoked')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);

    // Archive the test achievement; it shows again with "Show archived".
    await page.getByRole('button', { name: /^Catalog/ }).or(page.getByRole('tab', { name: /^Catalog/ })).first().click();
    await card(page, name).getByRole('button', { name: `Archive ${name}` }).click();
    await expect(page.getByText(`${name} archived. Past awards stay.`)).toBeVisible();
    await expect(card(page, name)).toHaveCount(0);
    await page.getByLabel('Show archived').check();
    await expect(card(page, name)).toContainText('Archived');
  });

  test('client appreciation waits for approval, and approving it says so', async ({ page, data }) => {
    const waiting = [{ id: '0190a000-0000-7000-8000-00000000a001', client: { id: 'c', name: 'Wonka Confectionery' }, project: { id: 'p', name: 'Wonka SEO' }, member: null, message: 'The landing pages shipped a week early.', status: 'PENDING', decided_by: null, decided_at: null, created_at: '2026-11-03T15:00:00Z' }];
    let decided = '';
    await page.route(APPRECIATIONS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(decided ? [] : waiting) }));
    await page.route(/\/performance\/appreciations\/[^/]+\/(approve|decline)$/, (route) => {
      decided = route.request().url().split('/').pop()!;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/o/${data.orgId}/performance/achievements`);
    await page.getByRole('button', { name: /^Waiting for approval/ }).or(page.getByRole('tab', { name: /^Waiting for approval/ })).first().click();
    await expect(page.getByText('Wonka Confectionery')).toBeVisible();
    await expect(page.getByText('For the project team · Wonka SEO')).toBeVisible();
    await expect(page.getByText('Not visible to anyone until you approve it.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Approve and share' }).click();
    await expect(page.getByText('Appreciation approved')).toBeVisible();
    expect(decided).toBe('approve');
    await expect(page.getByText('Nothing waiting')).toBeVisible();
  });

  test('says when it is loading, explains a failure and recovers with Try again', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let fail = true;
    await page.route(ACHIEVEMENTS, async (route) => {
      await held;
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fallback();
    });
    await page.goto(`/o/${data.orgId}/performance/achievements`);
    await expect(page.getByRole('status', { name: 'Loading performance' }).first()).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await expect(card(page, 'Team Player')).toBeVisible();
  });

  test('on a phone it fits the screen without sideways scrolling', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}/performance/achievements`);
    await expect(card(page, 'Team Player')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Achievements: who cannot open it', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without achievements access has no menu item, and the page and API refuse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/performance/achievements`);
    await expect(page.getByText('You don’t have access to this area.')).toBeVisible();
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/performance/achievements`)).status()).toBe(403);
    expect((await page.request.post(`/api/v1/orgs/${data.orgId}/performance/awards`, { data: { definition_id: '0190a000-0000-7000-8000-000000000001', membership_id: data.worker.membershipId, reason: 'x' }, headers: { Origin: new URL(page.url()).origin } })).status()).toBe(403);
  });
});
