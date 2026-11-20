import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * Overview and Summary (QA pass, feature 19).
 *
 * - BUG-89 (was OBS-R7-1): right after time was added or approved, Summary showed its money but not its
 *   hours. Money is priced from the time records; hours came from a daily total that the background
 *   job updates a moment later. Hours now come from the time records too.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-21T15:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@summary-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('Summary right after time is added (BUG-89)', () => {
  it('shows its hours with its money', async () => {
    const { membershipId } = await addMember(t, admin, orgId, 'Pat', 'pat@summary-rules.test');
    const project = (await admin.post<{ id: string }>(o('/projects'), { name: 'Retainer', member_ids: [membershipId] })).body.id;
    expect((await admin.patch(o(`/workers/${membershipId}`), { pay_rate_minor: 2000, bill_rate_minor: 5000, rate_effective_from: '2026-11-01' })).status).toBe(200);
    await t.flush();
    // An hour on 18 Nov whose daily total the background job hasn't written yet.
    await withSystem(t.h.db, (tx) =>
      tx.execute(sql`insert into time_entries (id, organization_id, membership_id, project_id, source, started_at, ended_at, duration_seconds, local_date, timezone, billable)
        values (gen_random_uuid(), ${orgId}::uuid, ${membershipId}::uuid, ${project}::uuid, 'MANUAL', timestamptz '2026-11-18 14:00:00+00', timestamptz '2026-11-18 15:00:00+00', 3600, '2026-11-18', 'UTC', true)`),
    );
    const s = (await admin.get<{ totals: { logged_seconds: number; billable_seconds: number; bill_minor: number | null }; by_project: Array<{ project_id: string; seconds: number }> }>(o('/insights?from=2026-11-16&to=2026-11-22'))).body;
    expect(s.totals.bill_minor).toBe(5000);
    expect([s.totals.logged_seconds, s.totals.billable_seconds]).toEqual([3600, 3600]);
    expect(s.by_project.find((p) => p.project_id === project)?.seconds).toBe(3600);
  });
});

describe('the Overview’s assigned tasks (BUG-90)', () => {
  it('only from projects the person can still see, and not archived ones', async () => {
    const { client: wes, membershipId } = await addMember(t, admin, orgId, 'Wes', 'wes@summary-rules.test');
    const open = (await admin.post<{ id: string }>(o('/projects'), { name: 'Open work', member_ids: [membershipId] })).body.id;
    const secret = (await admin.post<{ id: string }>(o('/projects'), { name: 'Acquisition codename', member_ids: [membershipId] })).body.id;
    const shelved = (await admin.post<{ id: string }>(o('/projects'), { name: 'Shelved work', member_ids: [membershipId] })).body.id;
    for (const p of [open, secret, shelved]) expect((await admin.post(o(`/projects/${p}/tasks`), { title: `Task on ${p}`, assignee_ids: [membershipId] })).status).toBe(201);
    // Taken off one project (the task assignment stays), another archived.
    expect((await admin.patch(o(`/projects/${secret}`), { member_ids: [] })).status).toBe(200);
    expect((await admin.post(o(`/projects/${shelved}/archive`))).status).toBe(204);
    const w = (await wes.get<{ assigned_tasks: Array<{ project_id: string }> }>(o('/dashboard/widgets?keys=assigned_tasks&scope=ME'))).body;
    expect(w.assigned_tasks.map((x) => x.project_id)).toEqual([open]);
  });
});
