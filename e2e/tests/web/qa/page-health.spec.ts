import type { Page } from '@playwright/test';
import { expect, test } from '../../../support/fixtures';
import { ADMIN_STATE } from '../../../support/env';

/**
 * QA: every admin page loads cleanly. For each route, at desktop and phone widths: a page heading,
 * no uncaught errors or console errors, no failed or 5xx API calls, no sideways page scroll, and
 * every visible button has an accessible name.
 */
const ROUTES = [
  '',
  '/timesheets/all',
  '/timesheets/approvals',
  '/timesheets/team',
  '/tracking/live',
  '/activity',
  '/tracking/reports',
  '/workers',
  '/teams',
  '/schedules',
  '/attendance',
  '/time-off',
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
  '/reports',
  '/settings',
  '/settings/time',
  '/settings/policies',
  '/devices',
  '/settings/roles',
  '/settings/access-review',
  '/settings/security',
  '/developer/api-keys',
  '/developer/webhooks',
  '/settings/audit',
  '/help',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    // Navigating away aborts in-flight requests; that is not a failure of the page.
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(r.failure()?.errorText ?? '')) problems.push(`failed ${r.method()} ${r.url()}: ${r.failure()?.errorText}`);
  });
  return problems;
}

test.describe('QA · Page health (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${vp.name} ${route || '/'}`, async ({ page, data }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const problems = watch(page);
        await page.goto(`/o/${data.orgId}${route}`);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);

        const unnamed = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter((b) => {
              const el = b as HTMLElement;
              if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
              const labels = Array.from((el as HTMLButtonElement).labels ?? []).map((l) => l.textContent).join(' ');
              const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || labels).trim();
              const labelledBy = el.getAttribute('aria-labelledby');
              return !name && !labelledBy;
            })
            .map((b) => b.outerHTML.slice(0, 120)),
        );
        expect(unnamed, 'buttons without an accessible name').toEqual([]);
        expect(problems).toEqual([]);
      });
    }
  }
});
