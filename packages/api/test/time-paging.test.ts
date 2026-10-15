import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Server-side paging for time entries, sessions, the approval queue, manual time and time off:
// every record is reachable past the old caps (5000 / 500), totals cover every match, and lists
// without `page` keep their old shape. The team timesheet's totals come from the database.
// Clock: 2026-09-23; the organizations are in UTC.
const NOW = new Date('2026-09-23T12:00:00Z');

let t: Harness;

interface Page<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Bulk fixtures go straight to the database (as the table owner) so the tests can pass the old caps quickly. */
async function asOwner(q: ReturnType<typeof sql>) {
  await t.h.db.execute(sql`reset role`);
  try {
    await t.h.db.execute(q);
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

async function utcOrg(name: string, email: string) {
  const c = new Client(t);
  const r = await c.post<{ organization_id: string }>('/auth/signup', { name, email, password: 'correct-horse-battery', organization_name: `${name}'s Org`, timezone: 'UTC' });
  expect(r.status).toBe(201);
  return { client: c, orgId: r.body.organization_id };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
});
afterAll(() => t.close());

describe('time entries', () => {
  let admin: Client;
  let orgId: string;
  let workerId: string;
  let otherId: string;
  let worker: Client;
  let projectId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await utcOrg('Tara', 'tara@time-paging.test'));
    ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Wim', 'wim@time-paging.test'));
    ({ membershipId: otherId } = await addMember(t, admin, orgId, 'Olga', 'olga@time-paging.test'));
    projectId = (await admin.post<{ id: string }>(o('/projects'), { name: 'Atlas', member_ids: [workerId, otherId] })).body.id;
    // 5200 ten-minute entries for Wim over 2026-08-01 … 2026-08-26 (200 a day), every other one billable,
    // and 30 one-hour entries for Olga on 2026-08-10, noted "standup".
    await asOwner(sql`
      insert into time_entries (id, organization_id, membership_id, project_id, source, started_at, ended_at, duration_seconds, local_date, timezone, billable, note)
      select gen_random_uuid(), ${orgId}::uuid, ${workerId}::uuid, ${projectId}::uuid, 'MANUAL',
             timestamptz '2026-08-01 00:00:00+00' + (n / 200) * interval '1 day' + (n % 200) * interval '6 minutes',
             timestamptz '2026-08-01 00:00:00+00' + (n / 200) * interval '1 day' + (n % 200) * interval '6 minutes' + interval '5 minutes',
             300, to_char(date '2026-08-01' + n / 200, 'YYYY-MM-DD'), 'UTC', n % 2 = 0, 'task ' || n
      from generate_series(0, 5199) as n`);
    await asOwner(sql`
      insert into time_entries (id, organization_id, membership_id, project_id, source, started_at, ended_at, duration_seconds, local_date, timezone, billable, note)
      select gen_random_uuid(), ${orgId}::uuid, ${otherId}::uuid, ${projectId}::uuid, 'TRACKED',
             timestamptz '2026-08-10 00:00:00+00' + n * interval '30 minutes', timestamptz '2026-08-10 00:00:00+00' + n * interval '30 minutes' + interval '20 minutes',
             1200, '2026-08-10', 'UTC', true, 'standup'
      from generate_series(0, 29) as n`);
  });

  it('pages through every entry in the range, newest day first, with totals for the range and each day', async () => {
    const r = await admin.get<Page<{ local_date: string; note: string }> & { summary: { entries: number; seconds: number; billable_seconds: number; by_day: Array<{ date: string; entries: number; seconds: number }> } }>(
      o('/time-entries?from=2026-08-01&to=2026-08-31&page=1&page_size=200'),
    );
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(5230);
    expect(r.body.data[0]!.local_date).toBe('2026-08-26');
    expect(r.body.summary).toMatchObject({ entries: 5230, seconds: 5200 * 300 + 30 * 1200, billable_seconds: 2600 * 300 + 30 * 1200 });
    expect(r.body.summary.by_day).toHaveLength(26);
    expect(r.body.summary.by_day.find((d) => d.date === '2026-08-10')).toMatchObject({ entries: 230, seconds: 200 * 300 + 30 * 1200 });

    // The last page reaches the oldest entries (the array form stops at 5000).
    const last = await admin.get<Page<{ local_date: string }>>(o('/time-entries?from=2026-08-01&to=2026-08-31&page=27&page_size=200'));
    expect(last.body.data).toHaveLength(30);
    expect(last.body.data.every((e) => e.local_date === '2026-08-01')).toBe(true);
    const asc = await admin.get<Page<{ local_date: string }>>(o('/time-entries?from=2026-08-01&to=2026-08-31&page=1&page_size=10&order=asc'));
    expect(asc.body.data[0]!.local_date).toBe('2026-08-01');
  });

  it('searches the note, project and member', async () => {
    const total = async (q: string) => (await admin.get<Page<unknown>>(o(`/time-entries?from=2026-08-01&to=2026-08-31&page=1&q=${encodeURIComponent(q)}`))).body.total;
    expect(await total('standup')).toBe(30);
    expect(await total('Olga')).toBe(30);
    expect(await total('task 5199')).toBe(1);
    expect(await total('atlas')).toBe(5230);
  });

  it('without `page`, still returns the plain array capped at 5000', async () => {
    const r = await admin.get<unknown[]>(o('/time-entries?from=2026-08-01&to=2026-08-31'));
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(5000);
  });

  it('a member pages through only their own entries', async () => {
    const r = await worker.get<Page<{ membership_id: string }> & { summary: { entries: number } }>(o('/time-entries?from=2026-08-01&to=2026-08-31&page=1&page_size=50'));
    expect(r.body.total).toBe(5200);
    expect(r.body.summary.entries).toBe(5200);
    expect(new Set(r.body.data.map((e) => e.membership_id))).toEqual(new Set([workerId]));
  });

  it('sums hours per member and day in the database for the team timesheet', async () => {
    const r = await admin.get<Array<{ membership_id: string; date: string; seconds: number; billable_seconds: number; manual_seconds: number }>>(o('/time-entries/totals?from=2026-08-10&to=2026-08-10'));
    expect(r.status).toBe(200);
    expect(r.body.find((x) => x.membership_id === workerId)).toMatchObject({ date: '2026-08-10', seconds: 200 * 300, billable_seconds: 100 * 300, manual_seconds: 200 * 300 });
    expect(r.body.find((x) => x.membership_id === otherId)).toMatchObject({ seconds: 30 * 1200, billable_seconds: 30 * 1200, manual_seconds: 0 });
    // A member's totals cover only themselves.
    const own = await worker.get<Array<{ membership_id: string }>>(o('/time-entries/totals?from=2026-08-10&to=2026-08-10'));
    expect(own.body.map((x) => x.membership_id)).toEqual([workerId]);
  });
});

describe('sessions', () => {
  let admin: Client;
  let orgId: string;
  let workerId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await utcOrg('Sol', 'sol@time-paging.test'));
    ({ membershipId: workerId } = await addMember(t, admin, orgId, 'Sid', 'sid@time-paging.test'));
    const projectId = (await admin.post<{ id: string }>(o('/projects'), { name: 'Orbit', member_ids: [workerId] })).body.id;
    // 520 stopped one-hour sessions, two a day from 2025-11-01 (within the 400-day range limit), each with a 45-minute work segment.
    await asOwner(sql`
      with s as (
        insert into tracking_sessions (id, organization_id, membership_id, source, project_id, state, started_at, ended_at, timezone)
        select gen_random_uuid(), ${orgId}::uuid, ${workerId}::uuid, 'DESKTOP', ${projectId}::uuid, 'STOPPED',
               timestamptz '2025-11-01 09:00:00+00' + n * interval '12 hours', timestamptz '2025-11-01 10:00:00+00' + n * interval '12 hours', 'UTC'
        from generate_series(0, 519) as n
        returning id, started_at)
      insert into time_segments (id, organization_id, session_id, membership_id, kind, started_at, ended_at)
      select gen_random_uuid(), ${orgId}::uuid, s.id, ${workerId}::uuid, 'WORK', s.started_at, s.started_at + interval '45 minutes' from s`);
  });

  it('pages through every session, newest first, with the time worked across all of them', async () => {
    const r = await admin.get<Page<{ started_at: string; worker_name: string }> & { summary: { worked_seconds: number } }>(o('/sessions?from=2025-11-01&to=2026-08-31&page=1&page_size=100'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(520);
    expect(r.body.data[0]!.started_at.slice(0, 10)).toBe('2026-07-18');
    expect(r.body.data[0]!.worker_name).toBe('Sid');
    expect(r.body.summary.worked_seconds).toBe(520 * 45 * 60);
    const last = await admin.get<Page<{ started_at: string }>>(o('/sessions?from=2025-11-01&to=2026-08-31&page=6&page_size=100'));
    expect(last.body.data.at(-1)!.started_at.slice(0, 10)).toBe('2025-11-01');
    // The array form still stops at 500.
    expect((await admin.get<unknown[]>(o('/sessions?from=2025-11-01&to=2026-08-31'))).body).toHaveLength(500);
    expect((await admin.get<Page<unknown>>(o('/sessions?from=2025-11-01&to=2026-08-31&page=1&q=nobody'))).body.total).toBe(0);
  });
});

describe('approvals, manual time and time off', () => {
  let admin: Client;
  let orgId: string;
  let workerId: string;
  let projectId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await utcOrg('Ana', 'ana@time-paging.test'));
    ({ membershipId: workerId } = await addMember(t, admin, orgId, 'Vic', 'vic@time-paging.test'));
    projectId = (await admin.post<{ id: string }>(o('/projects'), { name: 'Harbor', member_ids: [workerId] })).body.id;
    const adminId = (await admin.get<{ membership: { id: string } }>(o(''))).body.membership.id;
    // 520 approved weekly timesheets for Vic, starting 2016-01-04.
    await asOwner(sql`
      insert into timesheets (id, organization_id, membership_id, period_start, period_end, status, total_seconds)
      select gen_random_uuid(), ${orgId}::uuid, ${workerId}::uuid, to_char(date '2016-01-04' + n * 7, 'YYYY-MM-DD'), to_char(date '2016-01-10' + n * 7, 'YYYY-MM-DD'), 'APPROVED', 3600
      from generate_series(0, 519) as n`);
    // 510 manual time requests, 8 of them pending.
    await asOwner(sql`
      insert into manual_time_requests (id, organization_id, membership_id, project_id, started_at, ended_at, billable, reason, status, created_by, created_at)
      select gen_random_uuid(), ${orgId}::uuid, ${workerId}::uuid, ${projectId}::uuid,
             timestamptz '2025-01-01 09:00:00+00' + n * interval '1 day', timestamptz '2025-01-01 10:00:00+00' + n * interval '1 day', true,
             'reason ' || n, case when n < 8 then 'PENDING' else 'APPROVED' end, ${adminId}::uuid, timestamptz '2025-01-01 12:00:00+00' + n * interval '1 day'
      from generate_series(0, 509) as n`);
    const policyId = (await admin.post<{ id: string }>(o('/time-off/policies'), { name: 'Vacation', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
    // 505 approved one-day requests.
    await asOwner(sql`
      insert into time_off_requests (id, organization_id, policy_id, membership_id, start_date, end_date, hours, status, reason)
      select gen_random_uuid(), ${orgId}::uuid, ${policyId}::uuid, ${workerId}::uuid, to_char(date '2024-01-01' + n, 'YYYY-MM-DD'), to_char(date '2024-01-01' + n, 'YYYY-MM-DD'), 8, 'APPROVED', 'day ' || n
      from generate_series(0, 504) as n`);
  });

  it('the approval queue pages past 500 and searches by member', async () => {
    const r = await admin.get<Page<{ period_start: string; worker_name: string }>>(o('/timesheets/approvals?status=APPROVED&page=1&page_size=100'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(520);
    // 2016-01-04 + 519 weeks.
    expect(r.body.data[0]!.period_start).toBe('2025-12-15');
    const last = await admin.get<Page<{ period_start: string }>>(o('/timesheets/approvals?status=APPROVED&page=6&page_size=100'));
    expect(last.body.data.at(-1)!.period_start).toBe('2016-01-04');
    expect((await admin.get<unknown[]>(o('/timesheets/approvals?status=APPROVED'))).body).toHaveLength(500);
    expect((await admin.get<Page<unknown>>(o('/timesheets/approvals?status=APPROVED&page=1&q=vic'))).body.total).toBe(520);
    expect((await admin.get<Page<unknown>>(o('/timesheets/approvals?status=APPROVED&page=1&q=nobody'))).body.total).toBe(0);
  });

  it('manual time pages past 500, counts the pending ones, and searches the reason', async () => {
    const r = await admin.get<Page<{ reason: string }>>(o('/manual-time?page=1&page_size=100'));
    expect(r.body.total).toBe(510);
    expect(r.body.data[0]!.reason).toBe('reason 509');
    expect((await admin.get<Page<unknown>>(o('/manual-time?status=PENDING&page=1&page_size=1'))).body.total).toBe(8);
    expect((await admin.get<Page<unknown>>(o('/manual-time?page=1&q=reason%20509'))).body.total).toBe(1);
    expect((await admin.get<unknown[]>(o('/manual-time'))).body).toHaveLength(500);
  });

  it('time-off requests page past 500 and search the reason and policy', async () => {
    const r = await admin.get<Page<{ start_date: string }>>(o('/time-off/requests?page=1&page_size=100'));
    expect(r.body.total).toBe(505);
    expect(r.body.data[0]!.start_date).toBe('2025-05-19');
    const last = await admin.get<Page<{ start_date: string }>>(o('/time-off/requests?page=6&page_size=100'));
    expect(last.body.data.at(-1)!.start_date).toBe('2024-01-01');
    expect((await admin.get<Page<unknown>>(o('/time-off/requests?page=1&q=day%20500'))).body.total).toBe(1);
    expect((await admin.get<Page<unknown>>(o('/time-off/requests?page=1&q=vacation'))).body.total).toBe(505);
    expect((await admin.get<unknown[]>(o('/time-off/requests'))).body).toHaveLength(500);
  });

  it('refuses page sizes over 200', async () => {
    for (const path of ['/time-entries?from=2026-08-01&to=2026-08-31&page=1&page_size=500', '/sessions?from=2026-08-01&to=2026-08-31&page=1&page_size=500', '/manual-time?page=1&page_size=500', '/time-off/requests?page=1&page_size=500', '/timesheets/approvals?page=1&page_size=500'])
      expect((await admin.get(o(path))).status, path).toBe(400);
  });
});
