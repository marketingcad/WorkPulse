import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Page speed on the production build (Phase 14, roadmap budget): the Largest Contentful Paint of the
 * Overview dashboard, Reports and Timesheets stays under 2.5 s, the median of three loads. LCP is read
 * from the browser's own performance entries, after the page's main heading is on screen.
 */
test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const LCP_BUDGET_MS = 2500;
const LOADS = 3;

async function lcpOf(page: Page, url: string, heading: RegExp): Promise<number> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        // `buffered` delivers the entries recorded so far; the last one is the page's LCP.
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1]!.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(Number.NaN), 5000);
      }),
  );
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const PAGES: Array<{ name: string; path: string; heading: RegExp }> = [
  { name: 'Overview dashboard', path: '', heading: /./ },
  { name: 'Reports', path: '/reports', heading: /report/i },
  { name: 'Timesheets', path: '/timesheets', heading: /timesheet/i },
];

for (const p of PAGES) {
  test(`${p.name}: LCP under ${LCP_BUDGET_MS} ms (median of ${LOADS})`, async ({ browser, data }, testInfo) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const samples: number[] = [];
    for (let i = 0; i < LOADS; i++) {
      const page = await context.newPage();
      samples.push(await lcpOf(page, `/o/${data.orgId}${p.path}`, p.heading));
      await page.close();
    }
    await context.close();
    testInfo.annotations.push({ type: 'lcp', description: `${p.name}: ${samples.map((s) => Math.round(s)).join(', ')} ms` });
    expect(samples.every((s) => Number.isFinite(s)), 'the browser reported an LCP').toBe(true);
    expect(median(samples)).toBeLessThan(LCP_BUDGET_MS);
  });
}
