import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../../support/fixtures';
import { ADMIN_STATE, PASSWORD } from '../../../support/env';

/**
 * QA: accessibility. An axe-core scan against WCAG 2.2 A/AA on the main signed-out and admin pages,
 * plus keyboard-only checks that a scanner cannot make. Automated scans find only part of the
 * problems; they do not replace a screen-reader pass.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  await testInfo.attach('axe-results.json', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
  // One line per rule: what, how bad, how many elements, and the first few of them.
  return results.violations.map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.help} → ${v.nodes.slice(0, 2).map((n) => `${n.target.join(' ')} [${n.any[0]?.message ?? n.failureSummary ?? ''}]`).join(' | ')}`);
}

test.describe('QA · Accessibility scan, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ['/login', '/signup', '/forgot-password', '/download']) {
    test(`axe ${route}`, async ({ page }, testInfo) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await scan(page, testInfo)).toEqual([]);
    });
  }
});

test.describe('QA · Accessibility scan, admin workspace', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const route of ['', '/workers', '/timesheets/all', '/projects', '/finance/invoices', '/finance/payroll', '/reports', '/settings', '/settings/roles']) {
    test(`axe ${route || '/'}`, async ({ page, data }, testInfo) => {
      await page.goto(`/o/${data.orgId}${route}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await scan(page, testInfo)).toEqual([]);
    });
  }
});

test.describe('QA · Keyboard', () => {
  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('signing in works with the keyboard alone', { tag: '@smoke' }, async ({ page, data }) => {
      await page.goto('/login');
      await page.getByLabel('Work email').focus();
      await page.keyboard.type(data.admin.email);
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
      await page.keyboard.type(PASSWORD);
      await page.keyboard.press('Enter');
      // Signing in returns to the last workspace used, which other specs may have changed.
      await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}/);
      await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
    });
  });

  test.describe('admin', () => {
    test.use({ storageState: ADMIN_STATE });

    /** Where keyboard focus is, for failure messages. */
    const focused = (page: Page) => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160) ?? 'nothing');

    // (Sign-in puts focus in the email field on load, so the workspace is where the skip link is tested.)
    test('the first Tab reaches "Skip to content", which moves focus past the navigation', async ({ page, data }) => {
      await page.goto(`/o/${data.orgId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to content' });
      await expect(skip, `focus is on ${await focused(page)}`).toBeFocused();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('main')), `focus is on ${await focused(page)}`).toBe(true);
    });

    test('a dialog takes focus, closes with Escape and gives focus back', async ({ page, data }) => {
      await page.goto(`/o/${data.orgId}/clients`);
      const open = page.getByRole('button', { name: 'New client' }).first();
      await open.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
      // Tabbing stays inside the dialog.
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(open, `focus is on ${await focused(page)}`).toBeFocused();
    });

    test('on a phone, the navigation drawer opens, closes with Escape and returns focus', async ({ page, data }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/o/${data.orgId}`);
      const open = page.getByRole('button', { name: 'Open navigation' });
      await open.click();
      const close = page.getByRole('button', { name: 'Close navigation' }).last();
      await expect(close).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(close, 'drawer still open after Escape').toBeHidden();
      await expect(open, `focus is on ${await focused(page)}`).toBeFocused();
    });

    test('on a phone, keyboard focus stays inside the open navigation drawer', async ({ page, data }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/o/${data.orgId}`);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Navigation' });
      await expect(drawer).toBeVisible();
      const inDrawer = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(await inDrawer(), `focus is on ${await focused(page)}`).toBe(true);
      // More presses than the drawer has controls, both ways round.
      for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
      expect(await inDrawer(), `focus is on ${await focused(page)}`).toBe(true);
      for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+Tab');
      expect(await inDrawer(), `focus is on ${await focused(page)}`).toBe(true);
    });
  });
});
