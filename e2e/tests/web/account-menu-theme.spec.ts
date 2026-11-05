import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * The theme switch in the account menu. It used to be plain buttons inside the menu: arrow keys
 * skipped it and Tab cannot move inside a menu, so keyboard users could not change the theme.
 */
test.use({ storageState: ADMIN_STATE });

const accountButton = (page: Page) => page.getByRole('button', { name: 'Account menu' });
const themeGroup = (page: Page) => page.getByRole('menu').getByRole('group', { name: 'Theme' });
const option = (page: Page, mode: 'light' | 'dark' | 'system') => page.getByRole('menuitemradio', { name: `${mode} theme` });
const dataTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test.describe('Account menu theme switch', () => {
  test('can be reached and changed with the keyboard alone @smoke', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await accountButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();

    // ArrowDown walks the items and now lands on the theme options (it used to jump to Sign out).
    const menuitem = (name: string) => page.getByRole('menuitem', { name });
    await expect(menuitem('Profile & devices')).toBeFocused();
    for (const name of ['My timesheet', 'My pay stubs', 'What is monitored']) {
      await page.keyboard.press('ArrowDown');
      await expect(menuitem(name)).toBeFocused();
    }
    for (const mode of ['light', 'dark', 'system'] as const) {
      await page.keyboard.press('ArrowDown');
      await expect(option(page, mode)).toBeFocused();
    }
    await page.keyboard.press('ArrowDown');
    await expect(menuitem('Sign out')).toBeFocused();

    // Back up into the row, then Left/Right move across it.
    await page.keyboard.press('ArrowUp');
    await expect(option(page, 'system')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(option(page, 'dark')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(option(page, 'system')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(option(page, 'light')).toBeFocused(); // wraps around
    await page.keyboard.press('ArrowRight');
    await expect(option(page, 'dark')).toBeFocused();

    await page.keyboard.press('Enter');
    expect(await dataTheme(page)).toBe('dark');
    await expect(option(page, 'dark')).toHaveAttribute('aria-checked', 'true');
    await expect(option(page, 'system')).toHaveAttribute('aria-checked', 'false');
    // The menu stays open, so the choice can be seen and changed again.
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('is labelled and set apart from the links above it', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await accountButton(page).click();
    await expect(themeGroup(page)).toBeVisible();
    await expect(page.getByRole('menu').getByText('Theme', { exact: true })).toBeVisible();
    // A separator sits between "What is monitored" and the theme label.
    const between = await page.getByRole('menu').evaluate((menu) => {
      const kids = Array.from(menu.children);
      const monitored = kids.findIndex((k) => k.textContent?.trim() === 'What is monitored');
      return kids[monitored + 1]?.getAttribute('role');
    });
    expect(between).toBe('separator');
    await expect(themeGroup(page).getByRole('menuitemradio')).toHaveCount(3);
    // Nothing chosen yet: follows the system.
    await expect(option(page, 'system')).toHaveAttribute('aria-checked', 'true');
  });

  test('a mouse click changes the theme, keeps the menu open, and is remembered after a reload', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await accountButton(page).click();
    await option(page, 'light').click();
    expect(await dataTheme(page)).toBe('light');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.reload();
    expect(await dataTheme(page)).toBe('light');
    await accountButton(page).click();
    await expect(option(page, 'light')).toHaveAttribute('aria-checked', 'true');

    // Back to the system default clears the saved choice.
    await option(page, 'system').click();
    expect(await dataTheme(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('tw.theme'))).toBeNull();
  });
});

test.describe('Account menu theme switch, restricted role', () => {
  test.use({ storageState: VIEWER_STATE });

  test('is available to everyone, not only admins', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await accountButton(page).click();
    await expect(themeGroup(page).getByRole('menuitemradio')).toHaveCount(3);
    await option(page, 'dark').click();
    expect(await dataTheme(page)).toBe('dark');
  });
});
