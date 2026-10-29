import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../../support/fixtures';

/**
 * QA: an axe-core scan (WCAG 2.2 A/AA) of each primary screen of the worker's desktop app, with
 * the real page code and API (see support/fixtures.ts, openDesktop).
 */
const SCREENS = ['Home', 'Track', 'Timesheet', 'Time off', 'Schedule', 'Pay stubs', 'Settings'];

test.describe('QA · Desktop app accessibility', () => {
  for (const screen of SCREENS) {
    test(`axe ${screen}`, async ({ page, openDesktop, workerDevice }, testInfo) => {
      await openDesktop(workerDevice);
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: screen }).click();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      await testInfo.attach('axe-results.json', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      const found = results.violations.map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.help} → ${v.nodes.slice(0, 2).map((n) => `${n.target.join(' ')} [${n.any[0]?.message ?? n.failureSummary ?? ''}]`).join(' | ')}`);
      expect(found).toEqual([]);
    });
  }
});
