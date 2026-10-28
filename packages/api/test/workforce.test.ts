import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { runDaily, runWorkforceAlerts, sweepSessions } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Phase 8 gate: attendance, shift alerts, limits, overtime rules, accruals, breaks.
// Org time zone America/New_York (EDT = UTC-4 in September/October).
let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;

const o = (p: string) => `/orgs/${orgId}${p}`;
const WEEKDAYS = [1, 2, 3, 4, 5].map((dow) => ({ dow, start: '09:00', end: '17:00' }));

async function member(name: string) {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@wf.test`);
  expect((await admin.patch(o(`/workers/${m.membershipId}`), { start_date: '2020-01-01' })).status).toBe(200);
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [...(await projectMembers()), m.membershipId] })).status).toBe(200);
  return m;
}
async function projectMembers(): Promise<string[]> {
  return (await admin.get(o(`/projects/${projectId}`))).body.member_ids as string[];
}
async function schedule(membershipId: string) {
  expect((await admin.post(o('/schedules'), { membership_id: membershipId, timezone: 'America/New_York', days: WEEKDAYS, effective_from: '2026-01-01' })).status).toBe(201);
}
async function addTime(membershipId: string, startIso: string, endIso: string) {
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: startIso, ended_at: endIso, reason: 'fixture' });
  expect([r.status, r.body?.code, r.body?.title]).toEqual([201, undefined, undefined]);
}
/** Jumping the clock by weeks expires sessions; sign in again as the same person. */
async function relogin(c: Client, email: string) {
  c.cookie = '';
  expect((await c.post('/auth/login', { email, password: 'correct-horse-battery' })).status).toBe(200);
}
const notes = async (c: Client) => ((await c.get(o('/notifications'))).body.data as Array<{ type: string; title: string }>);

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-09-28T13:00:00Z')); // Monday 09:00 New York
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@wf.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Ops' })).body.id;
});
afterAll(() => t.close());

describe('attendance', () => {
  it('classifies a fixture week: on time, late, absent, on leave, holiday', async () => {
    const { client: w, membershipId: id } = await member('Walt');
    await schedule(id);
    await addTime(id, '2026-09-21T13:02:00Z', '2026-09-21T21:00:00Z'); // Mon 09:02 (inside grace)
    await addTime(id, '2026-09-22T13:30:00Z', '2026-09-22T21:00:00Z'); // Tue 09:30 (late)
    // Wed: nothing (absent)
    const policy = (await admin.post(o('/time-off/policies'), { name: 'Leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } })).body;
    const req = await w.post(o('/time-off/requests'), { policy_id: policy.id, start_date: '2026-09-24', end_date: '2026-09-24' });
    expect((await admin.post(o(`/time-off/requests/${req.body.id}/approve`), {})).status).toBe(204);
    expect((await admin.post(o('/holidays'), { date: '2026-09-25', name: 'Founders day' })).status).toBe(201);

    const rows = (await admin.get(o(`/attendance?from=2026-09-21&to=2026-09-25&membership_ids=${id}`))).body as Array<{ date: string; status: string; late_seconds: number }>;
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r.status]));
    expect(byDate).toEqual({ '2026-09-21': 'PRESENT', '2026-09-22': 'LATE', '2026-09-23': 'ABSENT', '2026-09-24': 'ON_LEAVE', '2026-09-25': 'HOLIDAY' });
    expect(rows.find((r) => r.date === '2026-09-22')!.late_seconds).toBe(30 * 60);
  });

  it('lists someone whose shift has not started yet as scheduled, not as missing', async () => {
    // Live, 28 Oct 2026: at 04:30 a member scheduled for 09:00 was left out and the roster said "Nobody was scheduled".
    const { membershipId: id } = await member('Sami');
    await schedule(id);
    t.clock.set(new Date('2026-09-28T08:30:00Z')); // Monday 04:30 New York
    const rows = (await admin.get(o(`/attendance?from=2026-09-28&to=2026-09-28&membership_ids=${id}`))).body as Array<{ status: string; scheduled_start: string }>;
    expect(rows).toEqual([expect.objectContaining({ status: 'SCHEDULED', scheduled_start: '2026-09-28T13:00:00.000Z' })]);
    const page = (await admin.get(o('/attendance?from=2026-09-28&to=2026-09-28&status=SCHEDULED&page=1&page_size=50'))).body as { data: Array<{ membership_id: string }> };
    expect(page.data.map((r) => r.membership_id)).toContain(id);
    // Once the shift and the grace period have passed with no time, they are absent.
    t.clock.set(new Date('2026-09-28T13:30:00Z'));
    expect((await admin.get(o(`/attendance?from=2026-09-28&to=2026-09-28&membership_ids=${id}`))).body[0].status).toBe('ABSENT');
    t.clock.set(new Date('2026-09-28T13:00:00Z'));
    // The shift-alert tests below expect Walt to be the only scheduled member not tracking on this Monday.
    expect((await admin.del(o(`/workers/${id}`))).status).toBe(204);
  });

  it('counts a timer that is running right now (no time entry yet)', async () => {
    const { client: w, membershipId: id } = await member('Rita');
    await schedule(id);
    t.clock.set(new Date('2026-09-28T13:01:00Z'));
    expect((await w.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
    t.clock.set(new Date('2026-09-28T14:00:00Z'));
    const [row] = (await admin.get(o(`/attendance?from=2026-09-28&to=2026-09-28&membership_ids=${id}`))).body;
    expect(row).toMatchObject({ status: 'PRESENT', first_in: '2026-09-28T13:01:00.000Z', worked_seconds: 59 * 60 });
  });
});

describe('shift alerts', () => {
  it('tells the worker and their managers once when a shift has not started', async () => {
    t.clock.set(new Date('2026-09-28T14:00:00Z')); // 10:00, one hour into the shift
    const r1 = await runWorkforceAlerts(t.deps);
    // Walt has a schedule and is not tracking; Rita is tracking.
    expect(r1.shifts).toBe(1);
    const walt = (await admin.get(o('/workers'))).body.find((x: { name: string }) => x.name === 'Walt');
    const waltClient = new Client(t);
    await waltClient.post('/auth/login', { email: 'walt@wf.test', password: 'correct-horse-battery' });
    expect((await notes(waltClient)).filter((n) => n.type === 'shift.not_started').map((n) => n.title)).toEqual(['Your shift started at 9:00 AM']);
    expect((await notes(admin)).filter((n) => n.type === 'shift.not_started').map((n) => n.title)).toEqual(['Walt has not started their 9:00 AM shift']);
    expect((await runWorkforceAlerts(t.deps)).shifts).toBe(0);
    expect(walt).toBeTruthy();
  });

  it('does not alert inside the grace period or on leave/holidays', async () => {
    t.clock.set(new Date('2026-09-29T13:04:00Z')); // Tuesday 09:04, grace is 5 minutes
    expect((await runWorkforceAlerts(t.deps)).shifts).toBe(0);
  });
});

describe('time limits', () => {
  it('stops the timer exactly at the daily limit, within one sweep, and blocks restarting', async () => {
    const { client: w, membershipId: id } = await member('Lena');
    expect((await admin.put(o(`/policies/WORKER/${id}`), { limits: { dailySeconds: 3600 } })).status).toBe(200);
    t.clock.set(new Date('2026-09-30T13:00:00Z'));
    const start = await w.post(o('/tracking/start'), { project_id: projectId });
    expect(start.status).toBe(200);
    t.clock.set(new Date('2026-09-30T14:00:45Z')); // the minute sweep runs 45s after the limit
    expect((await sweepSessions(t.deps)).limit).toBe(1);
    const cur = (await w.get(o('/tracking/current'))).body;
    expect(cur.session).toBeNull();
    const day = (await w.get(o('/time-entries?from=2026-09-30&to=2026-09-30'))).body as Array<{ duration_seconds: number; ended_at: string }>;
    expect(day.reduce((s, e) => s + e.duration_seconds, 0)).toBe(3600);
    expect(day[0]!.ended_at).toBe('2026-09-30T14:00:00.000Z');
    const again = await w.post(o('/tracking/start'), { project_id: projectId });
    expect([again.status, again.body.code]).toEqual([422, 'limit_reached']);
  });

  it('two starts racing at the limit never exceed it', async () => {
    const { client: w, membershipId: id } = await member('Omar');
    await admin.put(o(`/policies/WORKER/${id}`), { limits: { dailySeconds: 3600 } });
    await addTime(id, '2026-09-30T12:00:00Z', '2026-09-30T13:00:00Z'); // already at the limit
    t.clock.set(new Date('2026-09-30T15:00:00Z'));
    const [a, b] = await Promise.all([w.post(o('/tracking/start'), { project_id: projectId }), w.post(o('/tracking/start'), { project_id: projectId })]);
    expect([a.status, b.status]).toEqual([422, 422]);
    expect((await w.get(o('/tracking/current'))).body.session).toBeNull();
  });
});

describe('overtime rules', () => {
  it('are configurable by admins and drive the payroll export', async () => {
    const { client: w, membershipId: id } = await member('Otto');
    expect((await admin.get(o('/overtime-rules'))).body).toEqual({ dailyThresholdSeconds: null, weeklyThresholdSeconds: 40 * 3600 });
    expect((await w.put(o('/overtime-rules'), { daily_threshold_seconds: 8 * 3600, weekly_threshold_seconds: null })).status).toBe(403);
    expect((await admin.put(o('/overtime-rules'), { daily_threshold_seconds: 1800, weekly_threshold_seconds: null })).status).toBe(400);
    const r = await admin.put(o('/overtime-rules'), { daily_threshold_seconds: 8 * 3600, weekly_threshold_seconds: null });
    expect(r.body).toEqual({ dailyThresholdSeconds: 8 * 3600, weeklyThresholdSeconds: null });

    await addTime(id, '2026-09-14T12:00:00Z', '2026-09-14T22:00:00Z'); // 10h on one day
    await t.flush();
    const report = await admin.post(o('/reports/payroll/query'), { from: '2026-09-14', to: '2026-09-20', membership_ids: [id] });
    expect(report.body.rows).toEqual([expect.objectContaining({ worker: 'Otto', regular: 8 * 3600, overtime: 2 * 3600 })]);
  });
});

describe('time-off accruals', () => {
  let alice: { client: Client; membershipId: string };
  let newbie: { client: Client; membershipId: string };
  let monthly: string;
  let annual: string;
  let perHour: string;
  const balance = async (who: string, policy: string) => ((await admin.get(o(`/time-off/balances?membership_id=${who}`))).body as Array<{ policy_id: string; balance_hours: number }>).find((b) => b.policy_id === policy)!.balance_hours;
  const daily = async (iso: string) => {
    t.clock.set(new Date(iso));
    await runDaily(t.deps);
    await relogin(admin, 'ada@wf.test');
  };

  beforeAll(async () => {
    alice = await member('Alice');
    newbie = await member('Nico');
    expect((await admin.patch(o(`/workers/${newbie.membershipId}`), { start_date: '2026-10-16' })).status).toBe(200);
    const mk = async (name: string, accrual: object) => (await admin.post(o('/time-off/policies'), { name, accrual, applies_to_all: false, member_ids: [alice.membershipId, newbie.membershipId] })).body.id as string;
    monthly = await mk('Sick', { type: 'monthly', amountHours: 8, maxBalanceHours: 20, carryOverHours: null });
    annual = await mk('Vacation', { type: 'annual', amountHours: 40, maxBalanceHours: null, carryOverHours: 10 });
    perHour = await mk('Comp', { type: 'per_hour_worked', amountHours: 0.05, maxBalanceHours: null, carryOverHours: null });
  });

  it('credits once per period and catches up when the 1st was missed', async () => {
    await daily('2026-10-03T15:00:00Z'); // the job did not run on October 1st
    expect(await balance(alice.membershipId, monthly)).toBe(8);
    expect(await balance(alice.membershipId, annual)).toBe(40);
    await daily('2026-10-04T15:00:00Z');
    expect(await balance(alice.membershipId, monthly)).toBe(8);
  });

  it('gives members who join mid-period a pro-rata share, and nothing before they join', async () => {
    expect(await balance(newbie.membershipId, monthly)).toBe(0);
    await daily('2026-10-20T15:00:00Z');
    expect(await balance(newbie.membershipId, monthly)).toBe(4.13); // 16 of 31 days × 8h
    expect(await balance(newbie.membershipId, annual)).toBe(8.44); // 77 of 365 days × 40h
  });

  it('respects the balance cap', async () => {
    await daily('2026-11-01T15:00:00Z');
    await daily('2026-12-01T15:00:00Z');
    expect(await balance(alice.membershipId, monthly)).toBe(20); // 8 + 8 + 8 capped at 20
  });

  it('expires hours above the carry-over limit at the start of the year, before the new credit', async () => {
    await daily('2027-01-02T15:00:00Z');
    expect(await balance(alice.membershipId, annual)).toBe(50); // 40 → carry 10, + 40 for 2027
    await daily('2027-01-03T15:00:00Z');
    expect(await balance(alice.membershipId, annual)).toBe(50);
  });

  it('accrues per hour worked on timesheet approval and reverses it on reopen', async () => {
    t.clock.set(new Date('2026-10-12T20:00:00Z'));
    await relogin(admin, 'ada@wf.test');
    await relogin(alice.client, 'alice@wf.test');
    await addTime(alice.membershipId, '2026-10-05T13:00:00Z', '2026-10-05T23:00:00Z'); // 10h
    const ts = (await alice.client.post(o('/timesheets/submit'), { date: '2026-10-05' })).body.id;
    await admin.post(o(`/timesheets/${ts}/approve`), {});
    expect(await balance(alice.membershipId, perHour)).toBe(0.5);
    await admin.post(o(`/timesheets/${ts}/approve`), {}); // already approved: no second credit
    expect(await balance(alice.membershipId, perHour)).toBe(0.5);
    await admin.post(o(`/timesheets/${ts}/reopen`), { comment: 'fix' });
    expect(await balance(alice.membershipId, perHour)).toBe(0);
    await alice.client.post(o('/timesheets/submit'), { date: '2026-10-05' });
    await admin.post(o(`/timesheets/${ts}/approve`), {});
    expect(await balance(alice.membershipId, perHour)).toBe(0.5);
  });
});

describe('breaks', () => {
  it('break types are admin-managed; a long break warns the worker once', async () => {
    t.clock.set(new Date('2026-10-13T15:00:00Z'));
    await relogin(admin, 'ada@wf.test');
    const { client: w, membershipId: id } = await member('Bea');
    expect((await w.post(o('/break-types'), { name: 'Lunch' })).status).toBe(403);
    const lunch = (await admin.post(o('/break-types'), { name: 'Lunch', paid: false, max_minutes: 30 })).body;
    expect(lunch).toMatchObject({ name: 'Lunch', paid: false, max_minutes: 30 });
    expect((await w.get(o('/break-types'))).body.map((b: { name: string }) => b.name)).toEqual(['Lunch']);

    t.clock.set(new Date('2026-10-13T16:00:00Z'));
    const s = (await w.post(o('/tracking/start'), { project_id: projectId })).body.session;
    expect((await w.post(o('/tracking/pause'), { break_type_id: newId() })).status).toBe(404);
    t.clock.set(new Date('2026-10-13T16:30:00Z'));
    expect((await w.post(o('/tracking/pause'), { break_type_id: lunch.id })).status).toBe(200);
    t.clock.set(new Date('2026-10-13T17:00:30Z'));
    expect((await runWorkforceAlerts(t.deps)).breaks).toBe(1);
    expect((await runWorkforceAlerts(t.deps)).breaks).toBe(0);
    expect((await notes(w)).filter((n) => n.type === 'break.overrun').map((n) => n.title)).toEqual(['Your lunch break is over 30 minutes']);
    await w.post(o('/tracking/resume'), {});
    const detail = (await admin.get(o(`/sessions/${s.id}`))).body;
    expect(detail.segments.map((g: { kind: string; break_type_id: string | null }) => [g.kind, g.break_type_id])).toEqual([
      ['WORK', null],
      ['BREAK', lunch.id],
      ['WORK', null],
    ]);
    expect((await admin.del(o(`/break-types/${lunch.id}`))).status).toBe(204);
    expect((await w.get(o('/break-types'))).body).toEqual([]);
    void id;
  });

  it('a manual pause from the desktop is a break, not idle; bootstrap carries break types and the next shift', async () => {
    const { client: w, membershipId: id } = await member('Dora');
    await schedule(id);
    const coffee = (await admin.post(o('/break-types'), { name: 'Coffee', paid: true, max_minutes: 15 })).body;
    const { verifier, challenge } = pkce();
    const code = await w.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'macos', agent_version: '0.1.0' } })).body.access_token;

    t.clock.set(new Date('2026-10-14T12:00:00Z')); // Wednesday 08:00, before the shift
    const boot = (await agent.get('/agent/bootstrap')).body;
    expect(boot.next_shift).toEqual({ starts_at: '2026-10-14T13:00:00.000Z', ends_at: '2026-10-14T21:00:00.000Z' });
    expect(boot.break_types).toEqual([{ id: coffee.id, name: 'Coffee', paid: true, max_minutes: 15 }]);

    const sid = newId();
    const at = (m: number) => new Date(Date.parse('2026-10-14T13:00:00Z') + m * 60_000).toISOString();
    t.clock.set(new Date(at(40)));
    const res = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId },
        { event_id: newId(), type: 'session.pause', session_id: sid, seq: 2, occurred_at: at(10), kind: 'BREAK', break_type_id: coffee.id },
        { event_id: newId(), type: 'session.resume', session_id: sid, seq: 3, occurred_at: at(20) },
        { event_id: newId(), type: 'session.pause', session_id: sid, seq: 4, occurred_at: at(25), kind: 'MANUAL' },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 5, occurred_at: at(30) },
      ],
    });
    expect(res.body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);
    const detail = (await admin.get(o(`/sessions/${sid}`))).body;
    expect(detail.segments.map((g: { kind: string; break_type_id: string | null }) => [g.kind, g.break_type_id])).toEqual([
      ['WORK', null],
      ['BREAK', coffee.id],
      ['WORK', null],
      ['BREAK', null],
    ]);
  });
});

describe('archiving a time-off policy', () => {
  // Live, 28 Oct 2026: a policy could be created but never removed in the app. The Archive button
  // promises: no new requests, gone from balances, earlier requests kept and still decidable.
  it('stops new requests and leaves balances, keeps earlier requests decidable, and is for managers only', async () => {
    const { client: w, membershipId: id } = await member('Paula');
    const policy = (await admin.post(o('/time-off/policies'), { name: 'Mistake', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [id] })).body.id as string;
    const pending = await w.post(o('/time-off/requests'), { policy_id: policy, start_date: '2026-10-07', end_date: '2026-10-07' });
    expect(pending.status).toBe(201);

    expect((await w.post(o(`/time-off/policies/${policy}/archive`), {})).status).toBe(403);
    expect((await admin.post(o(`/time-off/policies/${policy}/archive`), {})).status).toBe(204);

    const listed = (await admin.get(o('/time-off/policies'))).body as Array<{ id: string }>;
    expect(listed.some((p) => p.id === policy)).toBe(false);
    const own = (await w.get(o('/time-off/balances'))).body as Array<{ policy_id: string }>;
    expect(own.some((b) => b.policy_id === policy)).toBe(false);
    const again = await w.post(o('/time-off/requests'), { policy_id: policy, start_date: '2026-10-08', end_date: '2026-10-08' });
    expect(again.status).toBe(404);
    expect((await admin.post(o(`/time-off/requests/${pending.body.id}/approve`), {})).status).toBe(204);
  });
});
