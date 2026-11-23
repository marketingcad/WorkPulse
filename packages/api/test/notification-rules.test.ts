import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * Notifications (QA pass, feature 27): each person sees and marks only their own. No bug found; this
 * pins the rule down.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type List = { data: Array<{ id: string; read_at: string | null }>; unread: number };

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-23T09:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@notification-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('notifications', () => {
  it('are the person’s own: nobody else lists them or marks them read', async () => {
    const { client: wes } = await addMember(t, admin, orgId, 'Wes', 'wes@notification-rules.test');
    expect((await admin.post(o('/reports/time-activity/export-runs'), { from: '2026-11-16', to: '2026-11-22', format: 'CSV' })).status).toBe(202);
    await t.flush();
    const { processReportRuns } = await import('../src/services/report-runs');
    await processReportRuns(t.deps);
    const mine = (await admin.get<List>(o('/notifications'))).body;
    expect(mine.unread).toBe(1);
    expect((await wes.get<List>(o('/notifications'))).body.data).toHaveLength(0);
    // Wes "marks" Ada's notification, and everything of his: hers stays unread.
    expect((await wes.post(o('/notifications/read'), { ids: [mine.data[0]!.id] })).status).toBe(204);
    expect((await wes.post(o('/notifications/read'), { ids: 'all' })).status).toBe(204);
    expect((await admin.get<List>(o('/notifications'))).body.unread).toBe(1);
    expect((await admin.post(o('/notifications/read'), { ids: 'all' })).status).toBe(204);
    expect((await admin.get<List>(o('/notifications'))).body.unread).toBe(0);
  });
});
