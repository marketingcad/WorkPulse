import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, WORKER_STATE } from '../../support/env';

/**
 * Live tracking (QA pass, feature 8). The live list is served by the test, so the checks do not depend on
 * who happens to be clocked in on the shared server; stopping a real running session is covered from its
 * drawer in simplified-nav.spec.ts.
 *
 * BUG-34: the "Started" column and the session drawer showed times in the browser's zone, while the rest
 * of the app shows them in the person's profile zone. A Manila browser makes the difference visible.
 */
const STARTED = '2026-11-20T01:05:00.000Z';
const time = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

test.describe('An admin on Live', () => {
  test.use({ storageState: ADMIN_STATE, timezoneId: 'Asia/Manila' });

  test('shows when each session started in the profile time zone, and stops one only after confirming', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const me = await ok<{ membership: { timezone: string | null }; organization: { timezone: string } }>(await adminApi.api.get(adminApi.orgApi('')), 'org context');
    const tz = me.membership.timezone || me.organization.timezone;
    test.skip(time(STARTED, tz) === time(STARTED, 'Asia/Manila'), 'the profile zone shows the same clock as the browser; nothing to compare');

    const sessionId = '00000000-0000-4000-8000-000000000034';
    const row = { membership_id: data.worker.membershipId, name: data.worker.name, status: 'WORKING', session_id: sessionId, project_id: data.projects.website.id, project_name: data.projects.website.name, task_title: null, started_at: STARTED, activity_pct: 64, today_seconds: 5400, last_seen_at: new Date().toISOString() };
    await page.route('**/api/v1/orgs/*/tracking/live', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) }));
    await page.route(`**/api/v1/orgs/*/sessions/${sessionId}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: sessionId, membership_id: data.worker.membershipId, worker_name: data.worker.name, project_id: data.projects.website.id, project_name: data.projects.website.name, task_id: null, task_title: null, state: 'RUNNING', source: 'DESKTOP', started_at: STARTED, ended_at: null, end_reason: null, note: null, work_seconds: 5400, idle_seconds: 0, break_seconds: 0, transitions: [], segments: [{ kind: 'WORK', started_at: STARTED, ended_at: null }] }),
      }),
    );
    let stopped = 0;
    await page.route(`**/api/v1/orgs/*/sessions/${sessionId}/force-stop`, (route) => {
      stopped++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: sessionId, state: 'STOPPED' }) });
    });

    await page.goto(`/o/${data.orgId}/tracking/live`);
    const line = page.getByRole('row', { name: new RegExp(data.worker.name) });
    // Before the fix this cell said the Manila time.
    await expect(line.getByText(time(STARTED, tz), { exact: true })).toBeVisible();
    await expect(line.getByText(time(STARTED, 'Asia/Manila'), { exact: true })).toHaveCount(0);

    // The session drawer uses the same zone.
    await line.getByRole('button', { name: `Actions for ${data.worker.name}` }).click();
    await page.getByRole('menuitem', { name: 'View session' }).click();
    const drawer = page.getByRole('dialog', { name: new RegExp(data.projects.website.name) });
    await expect(drawer.getByText(new RegExp(`^${time(STARTED, tz)} – now$`))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // Force stop asks first; cancelling sends nothing.
    await line.getByRole('button', { name: `Actions for ${data.worker.name}` }).click();
    await page.getByRole('menuitem', { name: 'Force stop timer' }).click();
    const confirm = page.getByRole('dialog', { name: 'Force stop this timer?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(stopped).toBe(0);

    await line.getByRole('button', { name: `Actions for ${data.worker.name}` }).click();
    await page.getByRole('menuitem', { name: 'Force stop timer' }).click();
    await confirm.getByRole('button', { name: 'Stop timer' }).click();
    await expect(page.getByText(`Stopped ${data.worker.name}'s timer`)).toBeVisible();
    expect(stopped).toBe(1);
  });

  test('says so when nobody is tracked', async ({ page, data }) => {
    await page.route('**/api/v1/orgs/*/tracking/live', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(`/o/${data.orgId}/tracking/live`);
    await expect(page.getByRole('heading', { level: 1, name: 'Who is working now' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(data.worker.name) })).toHaveCount(0);
    await expect(page.getByText('No members with tracking enabled')).toBeVisible();
  });

  test('Session history shows start and end in the profile time zone, with the date only when the day changes there', async ({ page, data, adminApi }) => {
    const me = await ok<{ membership: { timezone: string | null }; organization: { timezone: string } }>(await adminApi.api.get(adminApi.orgApi('')), 'org context');
    const tz = me.membership.timezone || me.organization.timezone;
    // 11:30 PM to 12:30 AM in Manila: across midnight there, but not in UTC or the Americas.
    const start = '2026-11-19T15:30:00.000Z';
    const end = '2026-11-19T16:30:00.000Z';
    const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
    test.skip(day(start) !== day(end), 'the profile zone also crosses midnight; nothing to compare');

    const session = { id: '00000000-0000-4000-8000-000000000035', membership_id: data.worker.membershipId, worker_name: data.worker.name, device_id: null, source: 'DESKTOP', project_id: data.projects.website.id, project_name: data.projects.website.name, task_id: null, task_title: null, state: 'STOPPED', started_at: start, ended_at: end, end_reason: 'USER', note: null, worked_seconds: 3600, current_segment_started_at: null };
    await page.route('**/api/v1/orgs/*/sessions?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [session], total: 1, page: 0, page_size: 25, summary: { worked_seconds: 3600 } }) }));
    await page.goto(`/o/${data.orgId}/sessions`);
    const row = page.getByRole('row', { name: new RegExp(data.worker.name) });
    const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(start));
    await expect(row.getByText(dateTime, { exact: true })).toBeVisible();
    // Same day in the profile zone: the end shows just its time. Before the fix it showed the Manila date and time.
    await expect(row.getByText(time(end, tz), { exact: true })).toBeVisible();
  });
});

test.describe('A worker', () => {
  test.use({ storageState: WORKER_STATE });

  test('sees nobody else on Live', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/tracking/live`);
    // Workers use the desktop app: the website sends them to its download page, never to the live list.
    await expect(page.getByRole('heading', { level: 1, name: 'Get the WorkPulse desktop app' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Who is working now' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(data.newcomer.name) })).toHaveCount(0);
    const res = await page.request.get(`/api/v1/orgs/${data.orgId}/tracking/live`);
    // A worker may read their own tracking only: the list holds them and nobody else.
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as Array<{ membership_id: string }>;
    expect(rows.every((r) => r.membership_id === data.worker.membershipId)).toBe(true);
  });
});
