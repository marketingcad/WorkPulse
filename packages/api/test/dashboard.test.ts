import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runDaily } from '../src/jobs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Phase 10 gate: widget permissions and scope, live data, rollup reconciliation, stream, digests, latency.
const NOW = new Date('2026-09-23T18:00:00Z'); // Wednesday 14:00 New York
const TODAY = '2026-09-23';

let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let a: Client;
let aId: string;
let b: Client;
let bId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const ADMIN_KEYS = ['worked_today', 'tracked_week', 'hours_by_project', 'active_workers', 'timesheets_to_approve', 'project_budgets', 'invoices', 'time_off_requests', 'attendance_today', 'devices_offline'];
const widgets = (c: Client, keys: string[], extra = '') => c.get(o(`/dashboard/widgets?keys=${keys.join(',')}${extra}`));

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
async function addTime(membershipId: string, start: string, seconds: number) {
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: start, ended_at: new Date(Date.parse(start) + seconds * 1000).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@dash.test'));
  let managerId: string;
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Mona', 'mona@dash.test', 'TEAM_MANAGER'));
  ({ client: a, membershipId: aId } = await addMember(t, admin, orgId, 'Anna', 'anna@dash.test'));
  ({ client: b, membershipId: bId } = await addMember(t, admin, orgId, 'Ben', 'ben@dash.test'));
  const team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' });
  await admin.put(o(`/teams/${team}/members/${aId}`), { role: 'MEMBER' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [aId, bId, managerId] })).body.id;
  await addTime(aId, '2026-09-23T13:00:00Z', 3600); // Anna 1h today
  await addTime(bId, '2026-09-23T13:00:00Z', 7200); // Ben 2h today
  await t.flush();
});
afterAll(() => t.close());

describe('widget permissions and scope', () => {
  it('admins see the whole organization', async () => {
    const d = (await widgets(admin, ADMIN_KEYS)).body;
    expect(d.worked_today).toMatchObject({ seconds: 3 * 3600, workers: 2 });
    expect(Object.keys(d)).toEqual(expect.arrayContaining(ADMIN_KEYS));
  });

  it('team managers see only their team, and no finance widgets', async () => {
    const d = (await widgets(manager, ADMIN_KEYS)).body;
    expect(d.worked_today).toMatchObject({ seconds: 3600, workers: 1 });
    expect(d.hours_by_project).toEqual([expect.objectContaining({ project_id: projectId, seconds: 3600 })]);
    expect(d.invoices).toBeUndefined();
    expect(d.devices_offline).toBeUndefined();
    // Asking for a worker outside the team returns nothing about them.
    const other = (await widgets(manager, ['worked_today'], `&scope=WORKER&membership_id=${bId}`)).body;
    expect(other.worked_today.seconds).toBe(0);
  });

  it('workers see only themselves, whatever they ask for', async () => {
    const d = (await widgets(b, ADMIN_KEYS)).body;
    expect(d.worked_today).toMatchObject({ seconds: 7200, workers: 1 });
    for (const k of ['active_workers', 'timesheets_to_approve', 'project_budgets', 'invoices', 'attendance_today', 'devices_offline']) expect(d[k]).toBeUndefined();
    expect((await widgets(b, ['worked_today'], `&scope=WORKER&membership_id=${aId}`)).body.worked_today.seconds).toBe(0);
  });

  it('each role gets a useful default layout', async () => {
    const keys = async (c: Client) => (await c.get(o('/dashboard/layout'))).body.widgets.map((w: { key: string }) => w.key);
    expect(await keys(admin)).toEqual(expect.arrayContaining(['worked_today', 'timesheets_to_approve', 'project_budgets', 'invoices']));
    expect(await keys(manager)).toEqual(expect.arrayContaining(['worked_today', 'active_workers', 'timesheets_to_approve', 'attendance_today']));
    expect(await keys(b)).toEqual(expect.arrayContaining(['current_timer', 'tracked_week', 'my_timesheet']));
    // Every default widget returns data for its role.
    for (const c of [admin, manager, b]) {
      const layout = await keys(c);
      const d = (await widgets(c, layout)).body;
      for (const k of layout) expect(k in d, k).toBe(true);
    }
  });

  it('running timers count toward team totals right away', async () => {
    expect((await a.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
    t.clock.set(new Date(NOW.getTime() + 30 * 60_000));
    const d = (await widgets(manager, ['worked_today', 'tracked_week', 'hours_by_project'])).body;
    expect(d.worked_today.seconds).toBe(3600 + 1800);
    expect(d.tracked_week.by_day.find((x: { date: string }) => x.date === TODAY).seconds).toBe(3600 + 1800);
    expect(d.hours_by_project[0].seconds).toBe(3600 + 1800);
    await a.post(o('/tracking/stop'));
    await t.flush();
    expect((await widgets(manager, ['worked_today'])).body.worked_today.seconds).toBe(3600 + 1800);
  });

  it("weekly limits show the worker's own usage", async () => {
    expect((await widgets(b, ['weekly_limits'])).body.weekly_limits).toBeNull();
    await admin.put(o(`/policies/WORKER/${bId}`), { limits: { dailySeconds: 8 * 3600, weeklySeconds: 40 * 3600 } });
    expect((await widgets(b, ['weekly_limits'])).body.weekly_limits).toEqual({ daily: { limit_seconds: 8 * 3600, used_seconds: 7200 }, weekly: { limit_seconds: 40 * 3600, used_seconds: 7200 } });
  });
});

describe('rollups', () => {
  it('nightly reconciliation rebuilds worker-days that drifted from their time entries', async () => {
    await asOwner(sql`update rollup_worker_day set tracked_seconds = tracked_seconds + 999 where membership_id = ${bId}`);
    expect((await widgets(admin, ['worked_today'])).body.worked_today.seconds).not.toBe(3 * 3600 + 1800);
    t.clock.set(new Date('2026-09-24T15:00:00Z'));
    const summary = (await runDaily(t.deps)) as Record<string, { rollups: { checked: number; drifted: number } }>;
    expect(summary[orgId]!.rollups.drifted).toBe(1);
    const src = await asOwner<{ s: number }>(sql`select coalesce(sum(duration_seconds),0)::int s from time_entries where deleted_at is null and organization_id = ${orgId}`);
    const agg = await asOwner<{ s: number }>(sql`select coalesce(sum(tracked_seconds + manual_seconds),0)::int s from rollup_worker_day where organization_id = ${orgId}`);
    expect(agg[0]!.s).toBe(src[0]!.s);
    expect(((await runDaily(t.deps)) as Record<string, { rollups: { drifted: number } }>)[orgId]!.rollups.drifted).toBe(0);
    const audit = await asOwner<{ n: number }>(sql`select count(*)::int n from audit_logs where organization_id = ${orgId} and action = 'rollups.reconciled'`);
    expect(audit[0]!.n).toBe(1);
    t.clock.set(NOW);
  });
});

describe('live stream', () => {
  const read = async (c: Client, headers: Record<string, string> = {}) => {
    const r = await c.req<string>('GET', o('/stream'), undefined, headers);
    const events = String(r.body)
      .split('\n\n')
      .map((blk) => Object.fromEntries(blk.split('\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()])))
      .filter((e) => e.event);
    return { status: r.status, type: r.headers.get('content-type'), events };
  };

  beforeAll(() => {
    t.deps.config.streamPollMs = 30;
    t.deps.config.streamMaxMs = 700;
    t.clock.set(new Date('2026-09-23T19:00:00Z'));
  });

  it('pushes changes for workers the viewer may see, and nothing else', async () => {
    const managerStream = read(manager);
    const benStream = read(b);
    await new Promise((r) => setTimeout(r, 100));
    await a.post(o('/tracking/start'), { project_id: projectId });
    await b.post(o('/tracking/start'), { project_id: projectId });
    const [m, ben] = await Promise.all([managerStream, benStream]);
    expect(m.status).toBe(200);
    expect(m.type).toContain('text/event-stream');
    expect(m.events[0]!.event).toBe('ready');
    const workersSeen = (s: typeof m) => [...new Set(s.events.filter((e) => e.event === 'change').map((e) => JSON.parse(e.data!).worker_id))];
    expect(workersSeen(m)).toEqual([aId]); // Ben is not on Mona's team
    expect(workersSeen(ben)).toEqual([bId]);
    expect(m.events.find((e) => e.event === 'change')!.data).toBe(JSON.stringify({ type: 'session.started', worker_id: aId }));
  });

  it('resumes from Last-Event-ID without losing events', async () => {
    const first = await read(admin);
    const cursor = first.events[0]!.id!;
    await a.post(o('/tracking/stop'));
    await b.post(o('/tracking/stop'));
    const resumed = await read(admin, { 'Last-Event-ID': cursor });
    const types = resumed.events.filter((e) => e.event === 'change').map((e) => JSON.parse(e.data!));
    expect(types).toEqual(expect.arrayContaining([{ type: 'session.stopped', worker_id: aId }, { type: 'session.stopped', worker_id: bId }]));
  });

  afterAll(() => {
    t.clock.set(NOW);
  });
});

describe('daily digest email', () => {
  it('goes only to members who turned it on, once a day, with what they may see', async () => {
    expect((await manager.put(o('/notification-preferences'), { preferences: [{ type: 'digest.daily', in_app: false, email: true }] })).status).toBe(200);
    expect((await b.put(o('/notification-preferences'), { preferences: [{ type: 'digest.daily', in_app: false, email: true }] })).status).toBe(200);
    await addTime(aId, '2026-09-21T13:00:00Z', 600);
    t.mailer.sent.length = 0;
    t.clock.set(new Date('2026-09-24T12:00:00Z')); // digest for the 23rd
    await runDaily(t.deps);
    const digests = t.mailer.sent.filter((m) => m.subject.startsWith('Your daily summary'));
    expect(digests.map((m) => m.to).sort()).toEqual(['ben@dash.test', 'mona@dash.test']);
    const mona = digests.find((m) => m.to === 'mona@dash.test')!.text;
    expect(mona).toContain('Your team:');
    expect(mona).not.toContain('Ben');
    const ben = digests.find((m) => m.to === 'ben@dash.test')!.text;
    expect(ben).toMatch(/You worked \d+h \d{2}m/);
    expect(ben).not.toContain('Your team');
    await runDaily(t.deps);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Your daily summary'))).toHaveLength(2);
    t.clock.set(NOW);
  });
});

// Latency budgets only mean something without other test files competing for the CPU: CI runs this
// on its own (LOAD_SMOKE=1, see .github/workflows/ci.yml); the parallel suite skips it, where it
// failed on busy machines without anything being slow.
describe.skipIf(!process.env.LOAD_SMOKE)('latency', () => {
  it('admin dashboard widgets stay under 300ms p95 with 10× demo data', async () => {
    // ~10× the demo workspace: 30 workers × 60 days × 3 projects of rollups, plus their time entries.
    const projects = [projectId, (await admin.post(o('/projects'), { name: 'P2' })).body.id, (await admin.post(o('/projects'), { name: 'P3' })).body.id];
    const workers: string[] = [];
    for (let i = 0; i < 30; i++) workers.push((await addMember(t, admin, orgId, `W${i}`, `w${i}@dash.test`)).membershipId);
    await asOwner(sql`
      insert into rollup_worker_day (organization_id, membership_id, local_date, project_id, task_key, billable, tracked_seconds, manual_seconds)
      select ${orgId}::uuid, m, to_char(date '2026-07-26' + d, 'YYYY-MM-DD'), p, '', true, 2 * 3600, 0
        from unnest(${sql.raw(`array[${workers.map((w) => `'${w}'::uuid`).join(',')}]`)}) m,
             generate_series(0, 59) d,
             unnest(${sql.raw(`array[${projects.map((p) => `'${p}'::uuid`).join(',')}]`)}) p
      on conflict do nothing`);
    const keys = (await admin.get(o('/dashboard/layout'))).body.widgets.map((w: { key: string }) => w.key);
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      const r = await widgets(admin, keys);
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(300);
  }, 120_000);
});
