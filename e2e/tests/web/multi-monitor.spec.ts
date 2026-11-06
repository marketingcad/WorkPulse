import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Activity › a worker with three monitors: a 10-minute block shows every screen of a capture side by
 * side, as Screen 1, 2 and 3, says how many screens there were, and marks blurred captures; a
 * one-screen block stays a single screenshot. The day is recorded data: storing three screens is
 * proven on the real API in packages/api/test/multi-monitor.test.ts, and capturing them in
 * apps/desktop/test/multi-monitor.test.ts. Recording it here avoids changing a shared member's
 * policy, which other specs edit at the same time.
 */
test.use({ storageState: ADMIN_STATE });

const today = new Date().toISOString().slice(0, 10);
const image = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${color}"/></svg>`)}`;
const shot = (id: string, at: string, display: number, blurred: boolean, color: string) => ({ id, captured_at: at, display_index: display, blurred, thumb_url: image(color), full_url: image(color) });
const block = (start: string, screenshots: unknown[]) => ({ window_start: start, session_id: 's1', project_id: 'p1', project_name: 'Website', task_title: null, activity_pct: 64, keyboard_pct: 40, mouse_pct: 60, tracked_seconds: 600, screenshots, idle: false, manual: false });
const AT_THREE = `${today}T09:02:00.000Z`;
const AT_ONE = `${today}T09:12:00.000Z`;

test.beforeEach(async ({ page, data }) => {
  await page.route('**/api/v1/orgs/*/activity/day?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        membership_id: data.worker.membershipId,
        date: today,
        timezone: 'UTC',
        total_seconds: 1200,
        avg_activity_pct: 64,
        // Out of order on purpose: the page orders the screens.
        blocks: [block(`${today}T09:00:00.000Z`, [shot('s3', AT_THREE, 2, true, '#9333ea'), shot('s1', AT_THREE, 0, true, '#2563eb'), shot('s2', AT_THREE, 1, true, '#16a34a')]), block(`${today}T09:10:00.000Z`, [shot('solo', AT_ONE, 0, false, '#ea580c')])],
        timeline: [],
        apps: [],
        urls: [],
      }),
    }),
  );
});

test('a three-monitor capture shows Screen 1, 2 and 3 side by side, blurred, with the count', { tag: '@smoke' }, async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/activity?member=${data.worker.membershipId}&date=${today}`);
  const tile = page.getByRole('button', { name: /, 3 screens/ });
  await expect(tile).toBeVisible();
  await tile.click();

  const details = page.getByRole('complementary', { name: 'Block details' });
  await expect(details.locator('figcaption')).toHaveText(['Screen 1', 'Screen 2', 'Screen 3']);
  const imgs = details.getByRole('img', { name: /^Screen \d, screenshot captured at/ });
  await expect(imgs).toHaveCount(3);
  await expect(imgs.first()).toHaveAccessibleName(/^Screen 1, screenshot captured at .+ \(blurred\)$/);
  await expect(details.getByText('· 3 screens', { exact: false })).toBeVisible();
  await expect(details.getByText('Blurred by policy')).toBeVisible();
  // Each screen can be deleted on its own.
  for (const n of [1, 2, 3]) await expect(details.getByRole('button', { name: `Delete screen ${n}` })).toBeVisible();
  // Each screen opens full size on its own.
  await expect(details.getByRole('link', { name: /Screen 3, screenshot/ })).toHaveAttribute('title', 'Open screen 3 full size in a new tab');

  const axe = await new AxeBuilder({ page }).include('[aria-label="Block details"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('a one-screen capture stays a single screenshot, without screen numbers', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/activity?member=${data.worker.membershipId}&date=${today}`);
  await expect(page.getByRole('button', { name: /, 3 screens/ })).toHaveCount(1);
  const tile = page.getByRole('button', { name: /^9:10 AM – 9:20 AM, / });
  await expect(tile).not.toHaveAccessibleName(/screens/);
  await tile.click();
  const details = page.getByRole('complementary', { name: 'Block details' });
  await expect(details.getByRole('img', { name: /^screenshot captured at/ })).toHaveCount(1);
  await expect(details.locator('figcaption')).toHaveCount(0);
  await expect(details.getByText(/\d+ screens\b/)).toHaveCount(0);
});

test('on a phone the three screens fit without sideways scrolling', async ({ page, data }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${data.orgId}/activity?member=${data.worker.membershipId}&date=${today}`);
  await page.getByRole('button', { name: /, 3 screens/ }).click();
  await expect(page.getByRole('img', { name: /^Screen 3, screenshot/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
