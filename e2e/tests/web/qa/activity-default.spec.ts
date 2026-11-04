import { randomUUID } from 'node:crypto';
import type { LiveWorkerDto } from '@tallywork/contracts';
import { expect, ok, test } from '../../../support/fixtures';
import { ADMIN_STATE, WEB_URL } from '../../../support/env';

/**
 * Regression: Activity opened from the menu (no member or date in the link) showed an empty day for
 * whoever came first in the list, while the same page opened from an Overview screenshot showed the
 * work. It now opens on someone with activity: working now, then on a break, then who tracked most today.
 */
test.describe('QA · Activity default view (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('opened from the menu, Activity shows a member who tracked time, not an empty day', { tag: '@smoke' }, async ({ page, data, adminApi, newcomerDevice }) => {
    // The newcomer tracks 40 minutes today in the desktop app.
    const send = async (events: unknown[]) => {
      const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, { method: 'POST', headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sent_at: new Date().toISOString(), events }) });
      expect(res.status).toBe(200);
    };
    const sid = randomUUID();
    await send([{ event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: new Date(Date.now() - 50 * 60_000).toISOString(), project_id: data.projects.website.id }]);
    await send([{ event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: new Date(Date.now() - 10 * 60_000).toISOString() }]);

    await page.goto(`/o/${data.orgId}`);
    const nav = page.getByRole('complementary', { name: 'Primary' });
    const group = nav.getByRole('button', { name: 'Time Tracking' });
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await nav.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/activity$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();

    // The member chosen follows the rule, read from live status at the same moment.
    const live = await ok<LiveWorkerDto[]>(await adminApi.api.get(adminApi.orgApi('/tracking/live')), 'live');
    const others = live.filter((w) => w.membership_id !== data.admin.membershipId);
    const expected = others.find((w) => w.status === 'WORKING') ?? others.find((w) => w.status === 'IDLE') ?? [...others].filter((w) => w.today_seconds > 0).sort((a, b) => b.today_seconds - a.today_seconds)[0];
    expect(expected, 'someone tracked time today').toBeTruthy();
    await expect(page.getByLabel('Member', { exact: true })).toHaveValue(expected!.membership_id);
    if (expected!.status === 'OFFLINE') await expect(page.getByText('No time tracked on this day')).toHaveCount(0);

    // A link with a member but no date (as from a member's profile) opens on a day with their work.
    await page.goto(`/o/${data.orgId}/activity?member=${data.newcomer.membershipId}`);
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(data.newcomer.name) })).toBeVisible();
    await expect(page.getByText('No time tracked on this day')).toHaveCount(0);
  });
});
