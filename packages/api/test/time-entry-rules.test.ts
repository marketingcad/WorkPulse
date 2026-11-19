import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Time entries and manual time (QA pass, feature 10).
 *
 * - BUG-54: "Time not added" kept the newest 500 records of the range and only then picked the open
 *   ones, so with many dismissed or corrected records, open ones were missing from the default view.
 * - BUG-55: manual time for a future day, given as a duration, was refused with "There is no free
 *   slot", which sent people looking for a clash instead of saying the day is in the future.
 * - Approving a manual request twice, and the 24-hour and future limits, had no test.
 */
const NOW = new Date('2026-11-20T06:00:00Z');
let t: Harness;
let admin: Client;
let orgId: string;
let walt: { client: Client; membershipId: string };
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@time-entry-rules.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@time-entry-rules.test');
  projectId = (await admin.post<{ id: string }>(o('/projects'), { name: 'Site', member_ids: [walt.membershipId] })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('time not added (BUG-54)', () => {
  it('lists every open record, however many closed ones the range holds', async () => {
    await withSystem(t.h.db, async (tx) => {
      // 600 dismissed records newer than the one still open.
      await tx.execute(sql`
        insert into refused_time (id, organization_id, membership_id, device_id, kind, started_at, ended_at, code, message, dismissed_at)
        select gen_random_uuid(), ${orgId}::uuid, ${walt.membershipId}::uuid, gen_random_uuid(), 'time',
               ${'2026-11-18T10:00:00Z'}::timestamptz + (g || ' seconds')::interval, ${'2026-11-18T10:00:00Z'}::timestamptz + (g || ' seconds')::interval + interval '1 second',
               'timesheet_locked', 'Locked', now()
        from generate_series(1, 600) g`);
      await tx.execute(sql`
        insert into refused_time (id, organization_id, membership_id, device_id, kind, started_at, ended_at, code, message)
        values (gen_random_uuid(), ${orgId}::uuid, ${walt.membershipId}::uuid, gen_random_uuid(), 'time', '2026-11-17T09:00:00Z', '2026-11-17T10:00:00Z', 'timesheet_locked', 'Still open')`);
    });
    const open = (await admin.get<Array<{ message: string; status: string }>>(o('/time-not-added?from=2026-11-16&to=2026-11-19'))).body;
    expect(open.map((r) => r.message)).toContain('Still open');
    expect(open.every((r) => r.status === 'OPEN' || r.status === 'CORRECTION_REQUESTED')).toBe(true);
  });
});

describe('manual time', () => {
  it('for a future day says it is in the future (BUG-55)', async () => {
    const r = await walt.client.post(o('/manual-time'), { project_id: projectId, local_date: '2026-11-25', duration_seconds: 3600, reason: 'planned' });
    expect(r.status).toBe(400);
    expect(r.body.title).toMatch(/future/i);
  });

  it('can’t end in the future or last more than 24 hours', async () => {
    expect((await walt.client.post(o('/manual-time'), { project_id: projectId, started_at: '2026-11-20T05:00:00Z', ended_at: '2026-11-20T07:00:00Z', reason: 'x' })).status).toBe(400);
    expect((await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: projectId, started_at: '2026-11-10T00:00:00Z', ended_at: '2026-11-11T01:00:00Z', reason: 'x' })).status).toBe(400);
  });

  it('is approved once: a second decision is refused', async () => {
    const req = await walt.client.post<{ id: string }>(o('/manual-time'), { project_id: projectId, started_at: '2026-11-12T01:00:00Z', ended_at: '2026-11-12T02:00:00Z', reason: 'forgot the timer' });
    expect(req.status).toBe(201);
    expect((await admin.post(o(`/manual-time/${req.body.id}/approve`), {})).status).toBe(204);
    const again = await admin.post(o(`/manual-time/${req.body.id}/approve`), {});
    expect(again.status).toBeGreaterThanOrEqual(400);
    const entries = (await admin.get<Array<{ started_at: string }>>(o(`/time-entries?membership_ids=${walt.membershipId}&from=2026-11-11&to=2026-11-13`))).body;
    expect(entries.filter((e) => e.started_at === '2026-11-12T01:00:00.000Z')).toHaveLength(1);
  });
});
