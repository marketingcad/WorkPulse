import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Opening a dropdown menu must not move the page. Radix menus are modal by default and lock scrolling,
 * which removed the scrollbar: on Windows (classic 15px scrollbars) the page and every fixed element
 * jumped sideways each time the account menu opened. Headless Chromium hides scrollbars, so this spec
 * turns them back on to see the real layout.
 */
test.use({ storageState: ADMIN_STATE, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const accountButton = (page: Page) => page.getByRole('button', { name: 'Account menu' });

/** Opens a menu and lets it settle: the scroll lock (the bug) is applied a moment after the menu shows. */
async function openMenu(page: Page, trigger: ReturnType<Page['getByRole']>) {
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.waitForTimeout(300);
}

/** Positions of the layout and of the fixed calculator button, plus the page's scroll state. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const x = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().x);
    return {
      scrollbar: window.innerWidth - document.documentElement.clientWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
      header: x('header'),
      heading: x('h1'),
      trigger: x('[data-tour="account-menu"]'),
      calculator: x('button.fixed.z-40'),
    };
  });

test.describe('Account menu', () => {
  for (const width of [1280, 1920]) {
    test(`opening it does not move the page (${width}px) @smoke`, async ({ page, data }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/o/${data.orgId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The regression needs a scrolling page with a real scrollbar (once the widgets have loaded).
      await expect.poll(async () => (await layout(page)).scrollbar, { message: 'the page has a visible scrollbar' }).toBeGreaterThan(0);
      const before = await layout(page);

      await openMenu(page, accountButton(page));
      expect(await layout(page)).toEqual(before);

      // Still scrollable while the menu is open.
      await page.mouse.move(width / 2, 500);
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });
  }

  test('closes with Escape and with a click outside, and focus returns to the button', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await accountButton(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(accountButton(page)).toBeFocused();

    await accountButton(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the organization switcher does not move the page either', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(async () => (await layout(page)).scrollbar).toBeGreaterThan(0);
    const before = await layout(page);
    await openMenu(page, page.getByRole('button', { name: 'Switch organization' }));
    expect(await layout(page)).toEqual(before);
  });
});
