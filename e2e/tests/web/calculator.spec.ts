import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * The floating calculator: a round button in the corner of every workspace page opens a panel that
 * works out hours worked, pay and bill amounts, and hour conversions. It is arithmetic in the browser:
 * it reads and saves nothing.
 */
test.use({ storageState: ADMIN_STATE });

const launcher = (page: Page) => page.getByRole('button', { name: /^(Open|Close) calculator$/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Calculator' });
/** The value shown next to a result label in the panel. */
const result = (p: Locator, label: string) => p.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');

async function openCalculator(page: Page, path: string, orgId: string) {
  await page.goto(`/o/${orgId}${path}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Open calculator' }).click();
  const p = panel(page);
  await expect(p).toBeVisible();
  return p;
}

test.describe('calculator', () => {
  test('works out a shift, then its pay, bill and margin', { tag: '@smoke' }, async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    const shift = p.getByRole('group', { name: 'Shift' });

    await test.step('hours: 09:00 to 17:30 with a 30 minute break is 8:00', async () => {
      await shift.getByLabel('Start').fill('09:00');
      await shift.getByLabel('End').fill('17:30');
      await shift.getByLabel('Break').fill('0:30');
      await expect(shift.getByText('8:00 worked')).toBeVisible();
      await expect(result(p, 'Total worked')).toHaveText('8:00');
      await expect(result(p, 'In decimal hours')).toHaveText('8.00');
    });

    await test.step('pay: 8 hours at 75.50, billed at 120', async () => {
      await p.getByRole('button', { name: 'Work out pay for these hours' }).click();
      await expect(p.getByRole('radio', { name: 'Pay' })).toHaveAttribute('aria-checked', 'true');
      await expect(p.getByLabel('Hours')).toHaveValue('8:00');
      await p.getByLabel(/^Pay rate per hour/).fill('75.50');
      await p.getByLabel(/^Bill rate per hour/).fill('120');
      await expect(result(p, 'Pay')).toHaveText('$604.00');
      await expect(result(p, 'Bill')).toHaveText('$960.00');
      await expect(result(p, 'Margin')).toHaveText('$356.00');
    });

    await test.step('convert: 7.75 hours is 7:45 and 465 minutes', async () => {
      await p.getByRole('radio', { name: 'Convert' }).click();
      await p.getByLabel('Hours').fill('7.75');
      await expect(result(p, 'Hours and minutes')).toHaveText('7:45');
      await expect(result(p, 'Decimal hours')).toHaveText('7.75');
      await expect(result(p, 'Minutes')).toHaveText('465');
    });
  });

  test('adds up several shifts, including one past midnight', async ({ page, data }) => {
    const p = await openCalculator(page, '/projects', data.orgId);
    await p.getByRole('group', { name: 'Shift' }).getByLabel('Start').fill('09:00');
    await p.getByRole('group', { name: 'Shift' }).getByLabel('End').fill('12:00');
    await p.getByRole('button', { name: 'Add shift' }).click();
    const second = p.getByRole('group', { name: 'Shift 2' });
    await second.getByLabel('Start').fill('22:00');
    await second.getByLabel('End').fill('06:00');
    await second.getByLabel('Break').fill('1');
    await expect(second.getByText('7:00 worked, past midnight')).toBeVisible();
    await expect(result(p, 'Total worked')).toHaveText('10:00');

    await p.getByRole('button', { name: 'Remove shift 2' }).click();
    await expect(p.getByRole('group')).toHaveCount(1);
    await expect(result(p, 'Total worked')).toHaveText('3:00');
  });

  test('explains what is wrong with an entry and shows no figure for it', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    const shift = p.getByRole('group', { name: 'Shift' });
    await shift.getByLabel('Start').fill('09:00');
    await shift.getByLabel('End').fill('10:00');
    await shift.getByLabel('Break').fill('lunch');
    await expect(shift.getByRole('alert')).toHaveText('Enter the break like 0:30, 30m or 0.5');
    await shift.getByLabel('Break').fill('2:00');
    await expect(shift.getByRole('alert')).toHaveText('The break is as long as the shift or longer');
    await expect(result(p, 'Total worked')).toHaveText('0:00');
    await expect(p.getByRole('button', { name: 'Work out pay for these hours' })).toBeDisabled();

    await p.getByRole('radio', { name: 'Pay' }).click();
    await p.getByLabel('Hours').fill('8');
    // A decimal comma is refused, never read as 1,250.00.
    await p.getByLabel(/^Pay rate per hour/).fill('12,50');
    await expect(p.getByRole('alert')).toHaveText('Enter an amount like 75 or 75.50');
    await expect(result(p, 'Pay')).toHaveText('—');
    await p.getByLabel('Hours').fill('eight');
    await expect(p.getByText('Enter hours like 7:30, 7h 30m or 7.5')).toBeVisible();

    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours').fill('soon');
    await expect(p.getByRole('alert')).toHaveText('Enter hours like 7:30, 7h 30m or 7.5');
    await expect(result(p, 'Minutes')).toHaveText('—');
  });

  test('starts empty, closes with Escape and keeps what was typed across pages', async ({ page, data }) => {
    const p = await openCalculator(page, '/teams', data.orgId);
    await expect(result(p, 'Total worked')).toHaveText('0:00');
    await p.getByRole('radio', { name: 'Convert' }).click();
    await expect(result(p, 'Hours and minutes')).toHaveText('—');
    await p.getByLabel('Hours').fill('1h 20m');
    await expect(result(p, 'Decimal hours')).toHaveText('1.33');

    await page.keyboard.press('Escape');
    await expect(p).toBeHidden();
    await expect(launcher(page)).toBeFocused();
    await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');

    // Move to another page through the app: the button is there and the panel remembers the entry.
    const nav = page.getByRole('complementary', { name: 'Primary' });
    const work = nav.getByRole('button', { name: 'Work', exact: true });
    if ((await work.getAttribute('aria-expanded')) === 'false') await work.click();
    await nav.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await launcher(page).click();
    await expect(p.getByRole('radio', { name: 'Convert' })).toHaveAttribute('aria-checked', 'true');
    await expect(p.getByLabel('Hours')).toHaveValue('1h 20m');
    await p.getByRole('button', { name: 'Close calculator' }).first().click();
    await expect(p).toBeHidden();
  });

  test('never calls the server: it reads and saves nothing', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await page.waitForLoadState('networkidle');
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    const shift = p.getByRole('group', { name: 'Shift' });
    await shift.getByLabel('Start').fill('08:00');
    await shift.getByLabel('End').fill('16:00');
    await p.getByRole('button', { name: 'Work out pay for these hours' }).click();
    await p.getByLabel(/^Pay rate per hour/).fill('30');
    await expect(result(p, 'Pay')).toHaveText('$240.00');
    expect(calls).toEqual([]);
  });
});

test.describe('calculator when signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is not on the sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
    await expect(launcher(page)).toHaveCount(0);
  });
});
