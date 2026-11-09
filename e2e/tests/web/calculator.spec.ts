import type { Locator, Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
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
  // Opening animates; measure and type once it has settled.
  await expect(p).toHaveAttribute('data-state', 'open');
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
      await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('8:00');
      await p.getByLabel(/^Pay rate per hour/).fill('75.50');
      await p.getByLabel(/^Bill rate per hour/).fill('120');
      await expect(result(p, 'Pay')).toHaveText('$604.00');
      await expect(result(p, 'Bill')).toHaveText('$960.00');
      await expect(result(p, 'Margin')).toHaveText('$356.00');
    });

    await test.step('convert: 7.75 hours is 7:45 and 465 minutes', async () => {
      await p.getByRole('radio', { name: 'Convert' }).click();
      await p.getByLabel('Hours', { exact: true }).fill('7.75');
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
    await p.getByLabel('Hours', { exact: true }).fill('8');
    // A decimal comma is refused, never read as 1,250.00.
    await p.getByLabel(/^Pay rate per hour/).fill('12,50');
    await expect(p.getByRole('alert')).toHaveText('Enter an amount like 75 or 75.50');
    await expect(result(p, 'Pay')).toHaveText('—');
    await p.getByLabel('Hours', { exact: true }).fill('eight');
    await expect(p.getByText('Enter hours like 7:30, 7h 30m or 7.5')).toBeVisible();

    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('soon');
    await expect(p.getByRole('alert')).toHaveText('Enter hours like 7:30, 7h 30m or 7.5');
    await expect(result(p, 'Minutes')).toHaveText('—');
  });

  test('starts empty, closes with Escape and keeps what was typed across pages', async ({ page, data }) => {
    const p = await openCalculator(page, '/teams', data.orgId);
    await expect(result(p, 'Total worked')).toHaveText('0:00');
    await p.getByRole('radio', { name: 'Convert' }).click();
    await expect(result(p, 'Hours and minutes')).toHaveText('—');
    await p.getByLabel('Hours', { exact: true }).fill('1h 20m');
    await expect(result(p, 'Decimal hours')).toHaveText('1.33');

    await page.keyboard.press('Escape');
    await expect(p).toBeHidden();
    await expect(launcher(page)).toBeFocused();
    await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');

    // Move to another page through the app: the button is there and the panel remembers the entry.
    const nav = page.getByRole('complementary', { name: 'Primary' });
    const work = nav.getByRole('button', { name: 'Project Management', exact: true });
    if ((await work.getAttribute('aria-expanded')) === 'false') await work.click();
    await nav.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await launcher(page).click();
    await expect(p.getByRole('radio', { name: 'Convert' })).toHaveAttribute('aria-checked', 'true');
    await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('1h 20m');
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

  test('adds and takes away time, then carries the total to pay', { tag: '@smoke' }, async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await p.getByRole('radio', { name: 'Add time' }).click();
    await expect(p.getByLabel('Time 1')).toBeFocused();
    await expect(result(p, 'Total')).toHaveText('0:00');
    await expect(p.getByRole('button', { name: 'Work out pay for these hours' })).toBeDisabled();

    await p.getByLabel('Time 1').fill('7:30');
    await p.getByLabel('Time 2').fill('8h 15m');
    await p.getByRole('button', { name: 'Add a line' }).click();
    await p.getByLabel('Time 3').fill('45m');
    await expect(result(p, 'Total')).toHaveText('16:30'); // 7:30 + 8:15 + 0:45
    await p.getByRole('button', { name: 'Line 3 adds. Press to take it away.' }).click();
    await expect(p.getByRole('button', { name: 'Line 3 takes away. Press to add it.' })).toBeVisible();
    await expect(result(p, 'Total')).toHaveText('15:00'); // 7:30 + 8:15 − 0:45
    await expect(result(p, 'In decimal hours')).toHaveText('15.00');

    await test.step('an unreadable line is explained and left out', async () => {
      await p.getByLabel('Time 2').fill('lunch');
      await expect(p.getByRole('alert')).toHaveText('Enter hours like 7:30, 7h 30m or 7.5');
      await expect(p.getByLabel('Time 2')).toHaveAttribute('aria-invalid', 'true');
      await expect(result(p, 'Total')).toHaveText('6:45');
      await p.getByLabel('Time 2').fill('8h 15m');
      await expect(p.getByRole('alert')).toHaveCount(0);
    });

    await test.step('below zero, the total shows a minus and cannot go to pay', async () => {
      await p.getByLabel('Time 3').fill('20');
      await expect(result(p, 'Total')).toHaveText('-4:15'); // 15:45 − 20:00
      await expect(p.getByRole('button', { name: 'Work out pay for these hours' })).toBeDisabled();
      await p.getByRole('button', { name: 'Remove line 3' }).click();
      await expect(result(p, 'Total')).toHaveText('15:45');
    });

    await p.getByRole('button', { name: 'Work out pay for these hours' }).click();
    await expect(p.getByRole('radio', { name: 'Pay' })).toHaveAttribute('aria-checked', 'true');
    await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('15:45');
  });

  test('shows margin and markup as percentages, in red below cost', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await p.getByRole('radio', { name: 'Pay' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('8');
    await p.getByLabel(/^Pay rate per hour/).fill('25');
    await expect(result(p, 'Margin %')).toHaveText('—');
    await p.getByLabel(/^Bill rate per hour/).fill('40');
    await expect(result(p, 'Margin')).toHaveText('$120.00'); // 320 − 200
    await expect(result(p, 'Margin %')).toHaveText('38%'); // 120 / 320 = 37.5 %
    await expect(result(p, 'Markup %')).toHaveText('60%'); // 120 / 200
    await p.getByLabel(/^Bill rate per hour/).fill('20');
    await expect(result(p, 'Margin')).toHaveText('-$40.00'); // 160 − 200
    await expect(result(p, 'Margin %')).toHaveText('-25%');
    await expect(result(p, 'Markup %')).toHaveText('-20%');
    await expect(result(p, 'Margin %').locator('span').first()).toHaveClass(/text-danger/);
    await expect(p.getByText('An estimate, not a pay run or invoice.', { exact: false })).toBeVisible();
  });

  test('reads long totals typed as H:MM, and the shorter ways of typing hours', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await p.getByRole('radio', { name: 'Pay' }).click();
    await p.getByLabel(/^Pay rate per hour/).fill('20');
    for (const [typed, pay] of [['120:30', '$2,410.00'], ['.5', '$10.00'], ['7h30', '$150.00']] as const) {
      await p.getByLabel('Hours', { exact: true }).fill(typed);
      await expect(result(p, 'Pay'), typed).toHaveText(pay);
    }
  });

  test('copies an answer as a plain number, ready to paste', async ({ page, context, data }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await openCalculator(page, '', data.orgId);
    await p.getByRole('radio', { name: 'Pay' }).click();
    // Nothing to copy yet.
    await expect(p.getByRole('button', { name: 'Copy Pay' })).toHaveCount(0);
    await p.getByLabel('Hours', { exact: true }).fill('37.5');
    await p.getByLabel(/^Pay rate per hour/).fill('1,250.00');
    await expect(result(p, 'Pay')).toHaveText('$46,875.00');
    await p.getByRole('button', { name: 'Copy Pay' }).click();
    await expect(p.getByRole('status').filter({ hasText: 'Pay copied' })).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('46875.00');

    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('7.75');
    await p.getByRole('button', { name: 'Copy Hours and minutes' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('7:45');
  });

  test('Clear empties only the mode on screen', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await expect(p.getByRole('button', { name: 'Clear Hours' })).toBeDisabled();
    await p.getByRole('radio', { name: 'Pay' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('8');
    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('90m');
    await expect(result(p, 'Minutes')).toHaveText('90');
    await p.getByRole('button', { name: 'Clear Convert' }).click();
    await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('');
    await expect(result(p, 'Minutes')).toHaveText('—');
    await expect(p.getByRole('button', { name: 'Clear Convert' })).toBeDisabled();
    await p.getByRole('radio', { name: 'Pay' }).click();
    await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('8');
  });

  test('Escape in another menu closes that menu, not the calculator', async ({ page, data }) => {
    const p = await openCalculator(page, '', data.orgId);
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(p).toBeVisible();
    // Back in the calculator, Escape closes it.
    await p.getByRole('radio', { name: 'Convert' }).click();
    await page.keyboard.press('Escape');
    await expect(p).toBeHidden();
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
    await expect(p).toHaveAttribute('data-state', 'open');
    // Near the top, the panel opens below the button, inside the window.
    const pb = await boxOf(p);
    const view = page.viewportSize()!;
    expect(pb.y).toBeGreaterThan(moved.y + moved.height);
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(view.width);
    expect(pb.y + pb.height).toBeLessThanOrEqual(view.height);
    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('2.5');
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
    await expect(panel(page)).toHaveAttribute('data-state', 'open');
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
    // The position is restored from storage: allow sub-pixel rounding (it was 375.5 → 375 or 376), not a real move.
    await expect.poll(async () => Math.abs((await boxOf(button)).x - moved.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((await boxOf(button)).y - moved.y)).toBeLessThanOrEqual(1);

    await button.click();
    await panel(page).getByRole('button', { name: 'Move to corner' }).click();
    await expect.poll(async () => Math.round((await boxOf(button)).x)).toBe(Math.round(corner.x));
    await expect(panel(page).getByRole('button', { name: 'Move to corner' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(Math.abs((await boxOf(button)).y - corner.y)).toBeLessThanOrEqual(1);
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
    await p.getByLabel('Hours', { exact: true }).fill('90m');
    const header = p.getByRole('heading', { name: 'Calculator' });
    const before = await boxOf(p);
    await drag(page, header, { x: 300, y: 200 });
    const after = await boxOf(p);
    expect(after.x).toBeLessThan(before.x);
    await expect(p).toBeInViewport({ ratio: 1 });
    await expect(p.getByLabel('Hours', { exact: true })).toHaveValue('90m');
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

test.describe('calculator on a phone and in the dark theme', () => {
  test.use({ storageState: ADMIN_STATE });

  test('fits a phone screen with all four modes reachable', async ({ page, data }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const p = await openCalculator(page, '', data.orgId);
    await expect(p).toBeInViewport({ ratio: 1 });
    const box = (await p.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375 - 32); // 1rem gutter each side
    for (const mode of ['Hours', 'Add time', 'Pay', 'Convert']) {
      await p.getByRole('radio', { name: mode }).click();
      await expect(p.getByRole('radio', { name: mode })).toHaveAttribute('aria-checked', 'true');
      await expect(p.getByRole('radio', { name: mode })).toBeInViewport({ ratio: 1 });
    }
    // Nothing in the panel scrolls sideways.
    const overflow = await p.evaluate((el) => Array.from(el.querySelectorAll('*')).some((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible'));
    expect(overflow).toBe(false);
  });

  test('uses the dark theme colours', async ({ page, data }) => {
    await page.addInitScript(() => localStorage.setItem('tw.theme', 'dark'));
    const p = await openCalculator(page, '', data.orgId);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await p.getByRole('radio', { name: 'Convert' }).click();
    await p.getByLabel('Hours', { exact: true }).fill('7.75');
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const panelBg = await p.evaluate((el) => getComputedStyle(el).backgroundColor);
    const answer = result(p, 'Hours and minutes').locator('span').first();
    const answerColor = await answer.evaluate((el) => getComputedStyle(el).color);
    // A dark panel with light text: the answer stays readable.
    expect(luminance(panelBg)).toBeLessThan(80);
    expect(luminance(answerColor)).toBeGreaterThan(180);
  });
});

test.describe('calculator open and close animation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('grows out of its button, settles, and shrinks back before it is removed', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await launcher(page).click();
    const p = panel(page);
    await expect(p).toHaveAttribute('data-state', 'open');
    await expect(p).toHaveCSS('opacity', '1');
    // Scaled from the button's centre, below and to the right of the panel in the corner.
    await expect(p).toHaveCSS('animation-name', 'calc-in');
    const origin = await p.evaluate((el) => getComputedStyle(el).transformOrigin.split(' ').map(parseFloat));
    const box = (await p.boundingBox())!;
    const btn = (await launcher(page).boundingBox())!;
    expect(Math.abs(box.x + origin[0]! - (btn.x + btn.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + origin[1]! - (btn.y + btn.height / 2))).toBeLessThanOrEqual(2);

    // Closing: the button says "Open" at once; the panel stops taking input, animates out, then goes.
    await launcher(page).click();
    await expect(page.getByRole('button', { name: 'Open calculator' })).toBeVisible();
    await expect(p).toBeHidden();
    await expect(page.locator('#calculator-panel')).toHaveCount(0);

    // Open again straight away: it comes back, not stuck closing.
    await launcher(page).click();
    await expect(p).toHaveAttribute('data-state', 'open');
  });

  test('with reduced motion, opens and closes at once without animating', async ({ page, data }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await launcher(page).click();
    const p = panel(page);
    // Settled from the first frame: nothing to wait for.
    await expect(p).toHaveAttribute('data-state', 'open');
    await expect(p).toHaveCSS('animation-name', 'none');
    await page.keyboard.press('Escape');
    await expect(page.locator('#calculator-panel')).toHaveCount(0);
  });
});

// Known issue (Nov 2026): on a short window, the last row's Cancel sat under the floating calculator
// button, so a click on it opened the calculator. Pages now leave room to scroll past both buttons.
test.describe('the floating buttons never cover the end of a page', () => {
  test('your last time-off request’s Cancel stays clickable at the bottom of a short window', async ({ page, data, adminApi }) => {
    const name = `QA bottom ${uid()}`;
    const policy = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.admin.membershipId] } }), 'policy');
    await ok(await adminApi.api.post(adminApi.orgApi('/time-off/requests'), { data: { policy_id: policy.id, start_date: '2031-01-06', end_date: '2031-01-06', half_day: false, reason: `${name} trip` } }), 'request');
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto(`/o/${data.orgId}/time-off?tab=mine`);
    const cancel = page.getByRole('row').filter({ hasText: `${name} trip` }).getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();
    await expect(launcher(page)).toBeVisible();

    // At the very bottom of the page, everything in the content area ends above the floating buttons.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastContentBottom = await page.locator('#main').evaluate((main) => {
      const pad = parseFloat(getComputedStyle(main).paddingBottom);
      return main.getBoundingClientRect().bottom - pad;
    });
    const buttonTop = (await launcher(page).boundingBox())!.y;
    expect(lastContentBottom).toBeLessThanOrEqual(buttonTop);

    // And the row's own Cancel is what a click there reaches, wherever the row sits.
    await cancel.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    const hit = await cancel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(hit).toBe(true);
    await cancel.click({ trial: true, timeout: 2_000 });
  });
});
