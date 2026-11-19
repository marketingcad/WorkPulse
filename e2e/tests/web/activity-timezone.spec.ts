import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Activity shows one day in one time zone (QA round 6, BUG-28). A viewer in Manila looking at a member
 * whose day is in New York saw the timeline say "Tracked, 4:32 AM – 4:40 AM" (the browser's time)
 * while the 10-minute blocks for the same work said 3:30 PM (the day's time). The day's data is
 * recorded (served by the test), so the check does not depend on shared tracking data.
 */
test.use({ storageState: ADMIN_STATE, timezoneId: 'Asia/Manila' });

const DAY = '2026-11-12';
// 3:30 PM in New York (UTC−5 in November) is 20:30 UTC, and 4:30 AM the next day in Manila.
const BLOCK_START = `${DAY}T20:30:00.000Z`;
const WORK_START = `${DAY}T20:32:00.000Z`;
const WORK_END = `${DAY}T20:40:00.000Z`;

const time = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

test('the timeline and the 10-minute blocks show the same time zone', async ({ page, data }) => {
  await page.route('**/api/v1/orgs/*/activity/day?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        membership_id: data.worker.membershipId,
        date: DAY,
        timezone: 'America/New_York',
        total_seconds: 480,
        avg_activity_pct: 70,
        blocks: [{ window_start: BLOCK_START, session_id: 's1', project_id: 'p1', project_name: 'Website', task_title: null, activity_pct: 70, keyboard_pct: 50, mouse_pct: 60, tracked_seconds: 480, screenshots: [], idle: false, manual: false }],
        timeline: [{ start: WORK_START, end: WORK_END, kind: 'WORK', color: '#2563eb' }],
        apps: [],
        urls: [],
      }),
    }),
  );
  await page.goto(`/o/${data.orgId}/activity?member=${data.worker.membershipId}&date=${DAY}`);

  // The block: 3:30 PM, New York time (named on the page, since it is not the viewer's zone).
  await expect(page.getByRole('button', { name: new RegExp(`^${time(BLOCK_START, 'America/New_York')} – `) })).toBeVisible();
  await expect(page.getByText('Times shown in America/New_York')).toBeVisible();

  // The timeline: the same work, the same zone. Before the fix it said 4:32 AM (Manila).
  const segment = page.getByRole('group', { name: 'Timeline of the day' }).locator('span[title^="Tracked,"]');
  await expect(segment).toHaveAttribute('title', `Tracked, ${time(WORK_START, 'America/New_York')} – ${time(WORK_END, 'America/New_York')}`);
  expect(time(WORK_START, 'America/New_York')).toBe('3:32 PM');
  expect(time(WORK_START, 'Asia/Manila')).not.toBe('3:32 PM');
});

test('the app timeline shows the member’s day in the member’s time zone, and names it', async ({ page, data, adminApi }) => {
  const worker = await ok<{ timezone: string }>(await adminApi.api.get(adminApi.orgApi(`/workers/${data.worker.membershipId}`)), 'worker');
  const tz = worker.timezone || 'UTC';
  test.skip(tz === 'Asia/Manila', 'the member already uses the browser’s zone; nothing to compare');

  await page.route('**/api/v1/orgs/*/apps?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: data.worker.membershipId, label: data.worker.name, seconds: 480, top: ['Code'] }]) }),
  );
  await page.route('**/api/v1/orgs/*/apps/spans?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Code', detail: 'com.example.code', started_at: WORK_START, ended_at: WORK_END, seconds: 480 }]) }),
  );
  await page.goto(`/o/${data.orgId}/activity?tab=apps`);
  await page.getByRole('radio', { name: 'Member' }).click();
  await page.getByRole('button', { name: 'Day timeline' }).first().click();

  const drawer = page.getByRole('dialog', { name: 'App timeline' });
  await expect(drawer.getByText(`times in ${tz}`)).toBeVisible();
  await expect(drawer.getByText(`${time(WORK_START, tz)} – ${time(WORK_END, tz)}`)).toBeVisible();
  // Not the browser's (Manila) time.
  await expect(drawer.getByText(`${time(WORK_START, 'Asia/Manila')} – `)).toHaveCount(0);
});

// BUG-33: the app day timeline asked the real server for /apps/spans and always got "From: This field
// is required" (a route clash). The spans are not served by the test here, so the request is real.
test('the app day timeline opens against the real server', async ({ page, data }) => {
  await page.route('**/api/v1/orgs/*/apps?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: data.worker.membershipId, label: data.worker.name, seconds: 480, top: ['Code'] }]) }),
  );
  await page.goto(`/o/${data.orgId}/activity?tab=apps`);
  await page.getByRole('radio', { name: 'Member' }).click();
  const spans = page.waitForResponse((r) => r.url().includes('/apps/spans?'));
  await page.getByRole('button', { name: 'Day timeline' }).first().click();
  expect((await spans).status()).toBe(200);
  const drawer = page.getByRole('dialog', { name: 'App timeline' });
  await expect(drawer.getByText(/No app activity on this day|spans ·/)).toBeVisible();
  await expect(drawer.getByText('This field is required', { exact: false })).toHaveCount(0);
});
