import { expect, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Help Center (a plain-language manual with search and links into the app) and the product tour
 * (starts once for a new account, can be skipped, finished, and restarted from Help).
 */
const sidebar = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Primary' });

test.describe('Help Center', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Help is in the menu and opens the manual; Back returns to the page you were on', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/clients`);
    await sidebar(page).getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/help$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Help Center' })).toBeVisible();
    for (const topic of ['Getting started', 'Time Tracking', 'Project Management', 'Finance', 'Frequently asked questions', 'Troubleshooting', 'Finding your way']) {
      await expect(page.getByRole('heading', { level: 2, name: topic })).toBeVisible();
    }
    // “Finding your way” lists the menu this person sees.
    await expect(page.getByRole('region', { name: 'Finding your way' }).getByText('Payroll runs, what members are owed, and pay groups.')).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    await test.info().attach('help-center', { body: await page.screenshot(), contentType: 'image/png' });
    // No tour: this account has seen it.
    await expect(page.getByTestId('product-tour')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/clients$`));
  });

  test('search finds guides by keyword, and says so when nothing matches', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/help`);
    const search = page.getByRole('searchbox', { name: 'Search help' });
    await search.fill('invoice');
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(results.getByRole('button', { name: /Create and send an invoice/ })).toBeVisible();
    // Results open, so the steps are right there.
    await expect(results.getByText('Click Review, then Create draft invoice.')).toBeVisible();

    await search.fill('lunch break');
    await expect(results.getByRole('button').first()).toContainText('Plan breaks for a project');

    await search.fill('xyzzy plover');
    await expect(page.getByText('Nothing found for “xyzzy plover”')).toBeVisible();
    await page.getByRole('button', { name: 'Show all topics' }).click();
    await expect(search).toHaveValue('');
    await expect(page.getByRole('heading', { level: 2, name: 'Getting started' })).toBeVisible();
  });

  test('guides explain the rules added by the October 2026 audits', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/help`);
    const search = page.getByRole('searchbox', { name: 'Search help' });
    const results = page.getByRole('region', { name: 'Search results' });
    await search.fill('bank details');
    await expect(results.getByText(/Members add their own bank details on Pay stubs/)).toBeVisible();
    await search.fill('archive client');
    await expect(results.getByText(/Archiving a client archives its projects too/)).toBeVisible();
    await search.fill('approved time changed');
    await expect(results.getByText(/paid in a finalized payroll cannot be reopened/)).toBeVisible();
  });

  test('a guide’s button opens the page, with a way back to the guide', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/help`);
    const guide = page.getByRole('button', { name: /Approve timesheets/ });
    await expect(guide).toHaveAttribute('aria-expanded', 'false');
    await guide.click();
    await expect(guide).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('link', { name: 'Open Approvals' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/timesheets/approvals$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();

    const back = page.getByRole('region', { name: 'Help guide' }).getByRole('link', { name: 'Back to Help: Approve timesheets' });
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/help#approve-timesheets$`));
    await expect(page.getByRole('button', { name: /Approve timesheets/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('complex pages have a Help link to their own guide', async ({ page, data }) => {
    for (const [path, guide] of [
      ['/finance/billing', 'Set pay and bill rates'],
      ['/settings/policies', 'Choose what the desktop app tracks'],
      ['/finance/payroll', 'Run payroll'],
      ['/reports', 'Run, save and schedule a report'],
    ] as const) {
      await page.goto(`/o/${data.orgId}${path}`);
      await page.getByRole('link', { name: 'Help: how to use this page' }).click();
      await expect(page.getByRole('button', { name: new RegExp(guide) })).toHaveAttribute('aria-expanded', 'true');
    }
  });
});

test.describe('Help for a restricted role', () => {
  test.use({ storageState: VIEWER_STATE });

  test('only shows guides for pages this person can open', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/help`);
    await expect(page.getByRole('heading', { level: 1, name: 'Help Center' })).toBeVisible();
    await expect(page.getByRole('button', { name: /How WorkPulse works/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Set a budget/ })).toHaveCount(0); // can read budgets, not set them
    for (const hidden of ['Run payroll', 'Approve timesheets', 'Invite a member', 'Create and send an invoice']) {
      await expect(page.getByRole('button', { name: new RegExp(hidden) })).toHaveCount(0);
    }
  });
});

test.describe('Product tour for a new account', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts once on the first visit, can be skipped, restarted from Help and finished', { tag: '@smoke' }, async ({ page }) => {
    // A brand-new organization owner, signed in in this browser.
    const su = await page.request.post('/api/v1/auth/signup', { headers: { Origin: WEB_URL }, data: { name: 'Nova Owner', email: `nova+${uid()}@e2e.test`, password: PASSWORD, organization_name: `Tour ${uid()}`, timezone: 'UTC' } });
    expect(su.status()).toBe(201);
    const orgId = (await su.json()).organization_id as string;

    await page.goto(`/o/${orgId}`);
    const tour = page.getByRole('dialog', { name: 'Welcome to WorkPulse' });
    await expect(tour).toBeVisible();
    await expect(tour).toContainText(/Step 1 of \d+/);
    await expect(tour.getByRole('button', { name: 'Previous' })).toHaveCount(0);

    // Next highlights the first menu group; Previous goes back.
    await tour.getByRole('button', { name: 'Next' }).click();
    const step2 = page.getByRole('dialog', { name: 'Time Tracking' });
    await expect(step2).toContainText(/Step 2 of \d+/);
    await test.info().attach('tour-step-2', { body: await page.screenshot(), contentType: 'image/png' });
    await step2.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to WorkPulse' })).toBeVisible();
    // The keyboard works too.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Time Tracking' })).toBeVisible();

    // Skip: gone, and it stays gone after a reload.
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.getByTestId('product-tour')).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/v1/me')).json()).user.tour_done).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('product-tour')).toHaveCount(0);

    // Restart from Help, then go all the way through to Finish.
    await sidebar(page).getByRole('link', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'Start the tour' }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to WorkPulse' })).toBeVisible();
    // (textContent: the counter is styled in capitals, which innerText would return.)
    const total = Number((await page.getByTestId('product-tour').getByText(/Step 1 of \d+/).textContent())!.match(/of (\d+)/)![1]);
    expect(total).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < total; i++) await page.getByTestId('product-tour').getByRole('button', { name: 'Next' }).click();
    const last = page.getByRole('dialog', { name: 'Help is always here' });
    await expect(last).toContainText(`Step ${total} of ${total}`);
    await expect(last.getByRole('button', { name: 'Skip tour' })).toHaveCount(0);
    await last.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByTestId('product-tour')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/o/${orgId}$`));

    // On a phone the tour points at the menu button instead of the sidebar.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${orgId}?tour=1`);
    await expect(page.getByRole('dialog', { name: 'Welcome to WorkPulse' })).toBeVisible();
    await page.getByTestId('product-tour').getByRole('button', { name: 'Next' }).click();
    const menu = page.getByRole('dialog', { name: 'The menu' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('product-tour')).toHaveCount(0);
  });
});
