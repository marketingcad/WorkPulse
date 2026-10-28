import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * The floating calculator: a round button in the corner of every workspace page opens a panel that
 * works out hours worked, pay and bill amounts, and hour conversions. It is arithmetic in the browser:
 * it reads and saves nothing.
 */
test.use({ storageState: ADMIN_STATE });

/** The round button. When open, the panel's own X is also "Close calculator"; only the button is expanded. */
const launcher = (page: Page) => page.getByRole('button', { name: 'Open calculator' }).or(page.getByRole('button', { name: 'Close calculator', expanded: true }));
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

test.describe('moving the calculator', () => {
  /** Press on `from`, move in steps to `to`, release: a real drag, as a mouse makes it. */
  async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
    const box = (await from.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const boxOf = async (l: Locator) => (await l.boundingBox())!;

  test('drags the button anywhere; the drag does not open it, a click does, and the panel fits on screen', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const button = launcher(page);
    const corner = await boxOf(button);

    await drag(page, button, { x: 100, y: 120 });
    const moved = await boxOf(button);
    expect(Math.round(moved.x + moved.width / 2)).toBe(100);
    expect(Math.round(moved.y + moved.height / 2)).toBe(120);
    expect(moved.x).toBeLessThan(corner.x);
    await expect(panel(page)).toBeHidden();

    await button.click();
    const p = panel(page);
    await expect(p).toBeVisible();
    // Near the top, the panel opens below the button, inside the window.
    const pb = await boxOf(p);
    const view = page.viewportSize()!;
    expect(pb.y).toBeGreaterThan(moved.y + moved.height);
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(view.width);
    expect(pb.y + pb.height).toBeLessThanOrEqual(view.height);
    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours').fill('2.5');
    await expect(result(p, 'Hours and minutes')).toHaveText('2:30');
  });

  test('stays fully on screen when dragged past an edge', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/projects`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const button = launcher(page);
    await drag(page, button, { x: -300, y: -300 });
    const b = await boxOf(button);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    await button.click();
    await expect(panel(page)).toBeInViewport({ ratio: 1 });
  });

  test('is remembered after a reload, and Move to corner puts it back', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const button = launcher(page);
    const corner = await boxOf(button);
    await drag(page, button, { x: 400, y: 300 });
    const moved = await boxOf(button);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(async () => Math.round((await boxOf(button)).x)).toBe(Math.round(moved.x));
    expect(Math.round((await boxOf(button)).y)).toBe(Math.round(moved.y));

    await button.click();
    await panel(page).getByRole('button', { name: 'Move to corner' }).click();
    await expect.poll(async () => Math.round((await boxOf(button)).x)).toBe(Math.round(corner.x));
    await expect(panel(page).getByRole('button', { name: 'Move to corner' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(Math.round((await boxOf(button)).y)).toBe(Math.round(corner.y));
  });

  test('moves with Alt and the arrow keys, for people who cannot drag', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const button = launcher(page);
    await expect(button).toHaveAccessibleDescription('Drag to move it, or press Alt and an arrow key.');
    const start = await boxOf(button);
    await button.focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(async () => Math.round((await boxOf(button)).x)).toBe(Math.round(start.x) - 24);
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect.poll(async () => Math.round((await boxOf(button)).y)).toBe(Math.round(start.y) - 96);
    // A plain arrow key does nothing to the position, and the panel stays closed.
    await page.keyboard.press('ArrowLeft');
    expect(Math.round((await boxOf(button)).x)).toBe(Math.round(start.x) - 24);
    await expect(panel(page)).toBeHidden();
  });

  test('drags by the panel header too, keeping what was typed', async ({ page, data }) => {
    const p = await openCalculator(page, '/teams', data.orgId);
    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours').fill('90m');
    const header = p.getByRole('heading', { name: 'Calculator' });
    const before = await boxOf(p);
    await drag(page, header, { x: 300, y: 200 });
    const after = await boxOf(p);
    expect(after.x).toBeLessThan(before.x);
    await expect(p).toBeInViewport({ ratio: 1 });
    await expect(p.getByLabel('Hours')).toHaveValue('90m');
    await expect(result(p, 'Hours and minutes')).toHaveText('1:30');
    // Its buttons are still buttons: Close closes rather than starting a drag.
    await p.getByRole('button', { name: 'Close calculator' }).click();
    await expect(p).toBeHidden();
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
