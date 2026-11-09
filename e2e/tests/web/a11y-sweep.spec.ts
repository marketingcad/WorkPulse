import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Accessibility acceptance (UX remediation, phase 4): every main screen, at desktop and phone width,
 * has no serious or critical WCAG 2.1 A/AA violation that axe can detect (names, labels, contrast,
 * roles, lists, landmarks...). Real fixes, no rules switched off. Axe finds about a third of
 * accessibility problems; keyboard flows have their own tests.
 */
const PAGES = [
  '',
  '/timesheets',
  '/timesheets/all',
  '/timesheets/approvals',
  '/timesheets/team',
  '/timesheets/manual',
  '/timesheets/not-added',
  '/tracking/live',
  '/sessions',
  '/activity',
  '/tracking/reports',
  '/workers',
  '/teams',
  '/schedules',
  '/attendance',
  '/time-off',
  '/time-off?tab=requests',
  '/time-off?tab=calendar',
  '/time-off?tab=admin',
  '/clients',
  '/projects',
  '/tasks',
  '/finance/billing',
  '/finance/budgets',
  '/finance/expenses',
  '/finance/invoices',
  '/finance/invoices/payments',
  '/finance/payroll',
  '/insights',
  '/ai-insights',
  '/reports',
  '/performance',
  '/performance/achievements',
  '/performance/leaderboards',
  '/performance/teams',
  '/performance/workers',
  '/performance/goals',
  '/settings',
  '/settings/time',
  '/settings/policies',
  '/settings/roles',
  '/settings/access-review',
  '/settings/security',
  '/settings/screenshot-retention',
  '/settings/audit',
  '/devices',
  '/developer/api-keys',
  '/developer/webhooks',
  '/help',
  '/me/profile',
  '/me/monitoring',
  '/pay-stubs',
];

async function serious(page: Page) {
  // Let lists finish loading before checking.
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
}

test.describe('accessibility: signed in', () => {
  test.use({ storageState: ADMIN_STATE });
  for (const [name, viewport] of [
    ['desktop', { width: 1366, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    for (const path of PAGES) {
      test(`${path || '/ (Overview)'} on ${name}`, async ({ page, data }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/o/${data.orgId}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await serious(page)).toEqual([]);
      });
    }
  }
});

test.describe('accessibility: signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of ['/login', '/signup', '/forgot-password', '/download']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  }
});
