import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Attendance and schedules (QA pass, feature 12).
 *
 * - BUG-84: two shifts on one day could overlap; the overlap counted twice as scheduled time (an
 *   8-hour day showed 9 hours, so early leave and overtime were wrong).
 * - BUG-85: deleting a holiday that does not exist answered 204 and wrote an audit row.
 * - BUG-86: a schedule could be set for someone who has left the organization.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type AuditRow = { action: string; target_id: string };
const auditFor = async (id: string) => {
  const b = (await admin.get<{ data: AuditRow[] } | AuditRow[]>(o(`/audit-logs?page=1&page_size=100`))).body;
  return (Array.isArray(b) ? b : b.data).filter((r) => r.target_id === id);
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-21T09:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@attendance-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('shifts on one day (BUG-84)', () => {
  it('can’t overlap; split shifts that don’t are fine', async () => {
    const { membershipId } = await addMember(t, admin, orgId, 'Pat', 'pat@attendance-rules.test');
    const base = { membership_id: membershipId, timezone: 'UTC', effective_from: '2026-11-01' };
    const r = await admin.post(o('/schedules'), { ...base, days: [{ dow: 1, start: '09:00', end: '13:00' }, { dow: 1, start: '12:00', end: '17:00' }] });
    expect(r.status).toBe(400);
    const split = await admin.post(o('/schedules'), { ...base, days: [{ dow: 1, start: '09:00', end: '12:00' }, { dow: 1, start: '13:00', end: '17:00' }, { dow: 2, start: '09:00', end: '17:00' }] });
    expect(split.status).toBe(201);
    const a = (await admin.get<Array<{ scheduled_seconds: number }>>(o(`/attendance?from=2026-11-16&to=2026-11-16&membership_ids=${membershipId}`))).body;
    expect(a[0]!.scheduled_seconds).toBe(7 * 3600);
  });
});

describe('deleting a holiday (BUG-85)', () => {
  it('one that does not exist is 404, with no audit row', async () => {
    const ghost = '01900000-0000-7000-8000-000000000085';
    expect((await admin.del(o(`/holidays/${ghost}`))).status).toBe(404);
    expect(await auditFor(ghost)).toHaveLength(0);
    const list = (await admin.post<Array<{ id: string; date: string }>>(o('/holidays'), { date: '2026-12-25', name: 'Christmas' })).body;
    const id = list.find((h) => h.date === '2026-12-25')!.id;
    expect((await admin.del(o(`/holidays/${id}`))).status).toBe(204);
    expect((await admin.del(o(`/holidays/${id}`))).status).toBe(404);
  });
});

describe('a schedule for someone who has left (BUG-86)', () => {
  it('is refused', async () => {
    const { membershipId } = await addMember(t, admin, orgId, 'Lee', 'lee@attendance-rules.test');
    expect((await admin.del(o(`/workers/${membershipId}`))).status).toBe(204);
    const r = await admin.post(o('/schedules'), { membership_id: membershipId, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: '2026-11-01' });
    expect(r.status).toBe(422);
  });
});
