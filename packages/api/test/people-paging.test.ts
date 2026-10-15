import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, type Harness } from './harness';

// Server-side paging for members, devices, tasks and attendance (phase 3): every record is
// reachable, filters and search run on the server, totals cover every match, and lists without
// `page` keep their old shape. Single members and devices are looked up directly.
// Clock: 2026-09-23; the organization is in UTC.
const NOW = new Date('2026-09-23T12:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

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

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  admin = new Client(t);
  const r = await admin.post<{ organization_id: string }>('/auth/signup', { name: 'Ada', email: 'ada@people-paging.test', password: 'correct-horse-battery', organization_name: 'People Org', timezone: 'UTC' });
  expect(r.status).toBe(201);
  orgId = r.body.organization_id;
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@people-paging.test'));
  projectId = (await admin.post<{ id: string }>(o('/projects'), { name: 'Beacon', member_ids: [waltId] })).body.id;
  const workerRole = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body.find((x) => x.key === 'WORKER')!.id;

  // 1050 more Workers, "Member 0001" … "Member 1050"; 5 of them removed and 3 suspended.
  await asOwner(sql`
    with u as (
      insert into users (id, email, name, password_hash)
      select gen_random_uuid(), 'member' || lpad(n::text, 4, '0') || '@people-paging.test', 'Member ' || lpad(n::text, 4, '0'), 'x'
      from generate_series(1, 1050) as n
      returning id, name),
    m as (
      insert into memberships (id, organization_id, user_id, role_id, status)
      select gen_random_uuid(), ${orgId}::uuid, u.id, ${workerRole}::uuid,
             case when u.name in ('Member 0001', 'Member 0002', 'Member 0003', 'Member 0004', 'Member 0005') then 'REMOVED'
                  when u.name in ('Member 0006', 'Member 0007', 'Member 0008') then 'SUSPENDED' else 'ACTIVE' end
      from u
      returning id)
    insert into worker_profiles (membership_id, organization_id, timezone, tracking_enabled)
    select m.id, ${orgId}::uuid, 'Europe/Lisbon', true from m`);
  // 260 desktop devices, 10 still pending approval.
  await asOwner(sql`
    insert into devices (id, organization_id, membership_id, name, platform, status, last_seen_at)
    select gen_random_uuid(), ${orgId}::uuid, m.id, 'Laptop ' || row_number() over (order by u.name), 'windows',
           case when row_number() over (order by u.name) <= 10 then 'PENDING' else 'ACTIVE' end, now() - (row_number() over (order by u.name)) * interval '1 minute'
    from memberships m join users u on u.id = m.user_id
    where m.organization_id = ${orgId}::uuid and u.name like 'Member %'
    order by u.name limit 260`);
  // 2100 tasks: 100 done, the rest to do.
  await asOwner(sql`
    insert into tasks (id, organization_id, project_id, title, status)
    select gen_random_uuid(), ${orgId}::uuid, ${projectId}::uuid, 'Task ' || lpad(n::text, 4, '0'), case when n <= 100 then 'DONE' else 'TODO' end
    from generate_series(1, 2100) as n`);
  // 120 active members tracked an hour on 2026-09-21, so they appear in attendance.
  await asOwner(sql`
    insert into time_entries (id, organization_id, membership_id, project_id, source, started_at, ended_at, duration_seconds, local_date, timezone, billable)
    select gen_random_uuid(), ${orgId}::uuid, m.id, ${projectId}::uuid, 'MANUAL', timestamptz '2026-09-21 09:00:00+00', timestamptz '2026-09-21 10:00:00+00', 3600, '2026-09-21', 'UTC', true
    from memberships m join users u on u.id = m.user_id
    where m.organization_id = ${orgId}::uuid and m.status = 'ACTIVE' and u.name like 'Member %'
    order by u.name limit 120`);
});
afterAll(() => t.close());

describe('members', () => {
  it('pages through every current member by name, with filters and search on the server', async () => {
    const r = await admin.get<Page<{ name: string; status: string }>>(o('/workers?page=1&page_size=100'));
    expect(r.status).toBe(200);
    // 1050 + Ada + Walt, minus the 5 removed.
    expect(r.body.total).toBe(1047);
    expect(r.body.data[0]!.name).toBe('Ada');
    const last = await admin.get<Page<{ name: string }>>(o('/workers?page=11&page_size=100'));
    expect(last.body.data.at(-1)!.name).toBe('Walt');

    expect((await admin.get<Page<unknown>>(o('/workers?page=1&view=former'))).body.total).toBe(5);
    expect((await admin.get<Page<unknown>>(o('/workers?page=1&status=SUSPENDED'))).body.total).toBe(3);
    expect((await admin.get<Page<unknown>>(o('/workers?page=1&q=member0042%40'))).body.total).toBe(1);
    expect((await admin.get<Page<unknown>>(o('/workers?page=1&q=Member%2010'))).body.total).toBe(51);
    const owner = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body.find((x) => x.key === 'SYSTEM_ADMIN')!.id;
    expect((await admin.get<Page<{ name: string }>>(o(`/workers?page=1&role_id=${owner}`))).body.data.map((w) => w.name)).toEqual(['Ada']);
  });

  it('without `page`, still returns every member as an array', async () => {
    expect((await admin.get<unknown[]>(o('/workers'))).body).toHaveLength(1047);
    expect((await admin.get<unknown[]>(o('/workers?include_removed=true'))).body).toHaveLength(1052);
  });

  it('opens a single member directly, including a removed one, and 404s on a bad id', async () => {
    const removed = (await admin.get<Page<{ id: string; name: string }>>(o('/workers?page=1&view=former'))).body.data[0]!;
    const r = await admin.get<{ name: string; status: string }>(o(`/workers/${removed.id}`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: removed.name, status: 'REMOVED' });
    expect((await admin.get(o('/workers/not-a-uuid'))).status).toBe(404);
  });

  it('lists every member for pickers with only the light fields, by name', async () => {
    const r = await admin.get<Array<Record<string, unknown>>>(o('/workers/options'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1047);
    expect(r.body[0]!.name).toBe('Ada');
    expect(Object.keys(r.body[0]!).sort()).toEqual(['email', 'id', 'name', 'role_name', 'status', 'timezone', 'title', 'tracking_enabled', 'weekly_expected_seconds']);
    // No rates or team lists, even for an admin who may see rates.
    expect(r.body.some((m) => 'pay_rate_minor' in m || 'team_ids' in m)).toBe(false);
    expect((await admin.get<unknown[]>(o('/workers/options?include_removed=true'))).body).toHaveLength(1052);
    // A Worker's picker holds only themselves, like the full list.
    expect((await walt.get<Array<{ name: string }>>(o('/workers/options'))).body.map((m) => m.name)).toEqual(['Walt']);
  });

  it('a Worker only sees themselves', async () => {
    const r = await walt.get<Page<{ name: string }>>(o('/workers?page=1'));
    expect(r.body.total).toBe(1);
    expect(r.body.data[0]!.name).toBe('Walt');
  });
});

describe('devices', () => {
  it('pages through every device with counts per status, filters and search', async () => {
    const r = await admin.get<Page<{ name: string; status: string }> & { summary: { counts: Record<string, number> } }>(o('/devices?page=1&page_size=100'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(260);
    expect(r.body.summary.counts).toMatchObject({ ALL: 260, PENDING: 10, ACTIVE: 250 });
    // Most recently seen first.
    expect(r.body.data[0]!.name).toBe('Laptop 1');
    expect((await admin.get<Page<unknown>>(o('/devices?page=1&status=PENDING'))).body.total).toBe(10);
    expect((await admin.get<Page<unknown>>(o('/devices?page=1&q=Member%200042'))).body.total).toBe(1);
    expect((await admin.get<unknown[]>(o('/devices'))).body).toHaveLength(260);
  });

  it('filters by member on the server', async () => {
    const member = (await admin.get<Page<{ id: string }>>(o('/workers?page=1&q=member0042%40'))).body.data[0]!;
    const r = await admin.get<Array<{ membership_id: string }>>(o(`/devices?membership_id=${member.id}`));
    expect(r.body).toHaveLength(1);
    expect(r.body[0]!.membership_id).toBe(member.id);
  });
});

describe('tasks', () => {
  it('pages through every task with counts per status and search', async () => {
    const r = await admin.get<Page<{ title: string }> & { summary: { counts: Record<string, number> } }>(o('/tasks?page=1&page_size=200'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2100);
    expect(r.body.summary.counts).toMatchObject({ ALL: 2100, TODO: 2000, DONE: 100 });
    expect((await admin.get<Page<unknown>>(o('/tasks?page=1&status=DONE'))).body.total).toBe(100);
    expect((await admin.get<Page<unknown>>(o('/tasks?page=1&q=Task%202099'))).body.total).toBe(1);
    // The array form still stops at 2000.
    expect((await admin.get<unknown[]>(o('/tasks'))).body).toHaveLength(2000);
  });
});

describe('attendance', () => {
  it('sends one page of rows, with counts over everyone and each member’s time zone', async () => {
    const r = await admin.get<Page<{ worker_name: string; timezone: string; status: string }> & { summary: { counts: Record<string, number> } }>(o('/attendance?from=2026-09-21&to=2026-09-21&page=1&page_size=50'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(120);
    expect(r.body.data).toHaveLength(50);
    expect(r.body.summary.counts.ALL).toBe(120);
    expect(r.body.data[0]!.timezone).toBe('Europe/Lisbon');
    const one = await admin.get<Page<{ worker_name: string }>>(o('/attendance?from=2026-09-21&to=2026-09-21&page=1&q=Member%200009'));
    expect(one.body.data.map((x) => x.worker_name)).toEqual(['Member 0009']);
    expect((await admin.get<unknown[]>(o('/attendance?from=2026-09-21&to=2026-09-21'))).body).toHaveLength(120);
  });

  it('refuses page sizes over 200', async () => {
    for (const path of ['/workers?page=1&page_size=500', '/devices?page=1&page_size=500', '/tasks?page=1&page_size=500', '/attendance?from=2026-09-21&to=2026-09-21&page=1&page_size=500']) expect((await admin.get(o(path))).status, path).toBe(400);
  });
});
