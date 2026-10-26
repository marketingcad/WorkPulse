import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { applyIdleDefaults, sweepSessions } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Time & Timesheets audit, step 2: overlap, idle defaults, attendance by time, period guards and small fixes.
// Organization timezone UTC. Monday 19 – Sunday 25 October 2026.
const H = 3600;
const MIN = 60_000;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const memberIds: string[] = [];

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

async function member(name: string, role: 'WORKER' | 'TEAM_MANAGER' = 'WORKER') {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@int.test`, role);
  memberIds.push(m.membershipId);
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: memberIds })).status).toBe(200);
  return m;
}

async function adminTime(membershipId: string, startIso: string, seconds: number) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture' });
  return r;
}

async function dayTotal(membershipId: string, date: string) {
  const rows = (await admin.get(o(`/time-entries?from=${date}&to=${date}&membership_ids=${membershipId}`))).body as Array<{ duration_seconds: number; source: string; started_at: string; ended_at: string }>;
  return { total: rows.reduce((s, e) => s + e.duration_seconds, 0), rows };
}

async function deviceFor(worker: Client) {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
  return agent;
}

const iso = (base: string, min: number) => new Date(Date.parse(base) + min * MIN).toISOString();
const minute = (base: string, min: number, active: number) => ({ minute_start: iso(base, min), keyboard: active ? 30 : 0, mouse: active ? 20 : 0, active_seconds: active, tracked_seconds: 60 });

/** One desktop session of `length` minutes from `base`, with an idle period starting at `idleAt` and input again at `backAt`. */
function sessionEvents(base: string, length: number, idle?: { at: number; back: number | null; id?: string }) {
  const sid = newId();
  const events: unknown[] = [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: base, project_id: projectId }];
  if (idle) {
    events.push({ event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: iso(base, length), minutes: Array.from({ length }, (_, i) => minute(base, i, i >= idle.at && (idle.back === null || i < idle.back) ? 0 : 50)) });
    events.push({ event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: iso(base, idle.at), idle_id: idle.id ?? newId(), started_at: iso(base, idle.at) });
  }
  return { sid, events, stop: { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: iso(base, length) } };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-21T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@int.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('overlapping tracked time is trimmed, never counted twice', () => {
  it('a late desktop sync keeps the manual time already there and records the trim', async () => {
    const { client: walt, membershipId: waltId } = await member('Walt');
    expect((await adminTime(waltId, '2026-10-20T10:00:00Z', H)).status).toBe(201); // manual 10:00–11:00
    const agent = await deviceFor(walt);
    // The desktop was offline: it tracked 09:30–11:30 and syncs at noon.
    const s = sessionEvents('2026-10-20T09:30:00Z', 120);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [...s.events, s.stop] });
    const { total, rows } = await dayTotal(waltId, '2026-10-20');
    // 2 h of real time, not 3 h. Before the fix the tracked 09:30–11:30 was added on top of the manual hour.
    expect(total).toBe(2 * H);
    const tracked = rows.filter((r) => r.source === 'TRACKED').map((r) => [r.started_at, r.ended_at]).sort();
    expect(tracked).toEqual([
      ['2026-10-20T09:30:00.000Z', '2026-10-20T10:00:00.000Z'],
      ['2026-10-20T11:00:00.000Z', '2026-10-20T11:30:00.000Z'],
    ]);
    const [log] = await asOwner<{ metadata: { trimmed_seconds: number } }>(sql`select metadata from audit_logs where action = 'time.overlap_trimmed' and target_id = ${s.sid}`);
    expect(log?.metadata.trimmed_seconds).toBe(H);
  });
});

describe('unanswered idle gets the default resolution, from now on only', () => {
  it('applies the policy default once the worker is back, but not to idle recorded before the cutoff', async () => {
    const { client: ivy, membershipId: ivyId } = await member('Ivy');
    await admin.put(o(`/policies/WORKER/${ivyId}`), { idle: { behavior: 'prompt', defaultResolution: 'discard', confirmationTimeoutMinutes: 10 } });
    const agent = await deviceFor(ivy);
    // 09:00–10:00, idle 09:10–09:20 never answered.
    const s = sessionEvents('2026-10-21T09:00:00Z', 60, { at: 10, back: 20 });
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [...s.events, s.stop] });
    expect((await dayTotal(ivyId, '2026-10-21')).total).toBe(60 * 60);

    // Recorded before the cutoff: left for a manager (deploying changes no past time).
    expect(await applyIdleDefaults(t.deps, new Date('2999-01-01T00:00:00Z'))).toBe(0);
    expect((await dayTotal(ivyId, '2026-10-21')).total).toBe(60 * 60);
    // After the cutoff: discarded, 09:10–09:20 only. (Before the fix this never ran.)
    expect(await applyIdleDefaults(t.deps, new Date(0))).toBe(1);
    expect((await dayTotal(ivyId, '2026-10-21')).total).toBe(50 * 60);
  });

  it('leaves idle alone while it is still going, and in a submitted timesheet', async () => {
    const { client: max, membershipId: maxId } = await member('Max');
    await admin.put(o(`/policies/WORKER/${maxId}`), { idle: { behavior: 'prompt', defaultResolution: 'discard', confirmationTimeoutMinutes: 10 } });
    const agent = await deviceFor(max);
    // Finished session with idle 08:10–08:20, then the week is submitted.
    const done = sessionEvents('2026-10-20T08:00:00Z', 60, { at: 10, back: 20 });
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [...done.events, done.stop] });
    expect((await max.post(o('/timesheets/submit'), { date: '2026-10-20' })).status).toBe(200);
    // Still running, idle since 11:40 with no input since.
    const running = sessionEvents('2026-10-21T11:30:00Z', 30, { at: 10, back: null });
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: running.events });

    expect(await applyIdleDefaults(t.deps, new Date(0))).toBe(0);
    const pending = (await admin.get(o(`/idle-events?from=2026-10-20&to=2026-10-21&membership_ids=${maxId}&status=PENDING`))).body as unknown[];
    expect(pending).toHaveLength(2);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [running.stop] });
  });
});

describe('attendance matches time to shifts by when it happened', () => {
  it('a worker in Manila on a New York schedule is present on the schedule’s day', async () => {
    const { membershipId: mia } = await member('Mia');
    expect((await admin.patch(o(`/workers/${mia}`), { timezone: 'Asia/Manila' })).status).toBe(200);
    expect((await admin.post(o('/schedules'), { membership_id: mia, timezone: 'America/New_York', days: [{ dow: 1, start: '20:00', end: '23:00' }], effective_from: '2026-10-01' })).status).toBe(201);
    // Monday 20:00–23:00 in New York is Tuesday 08:00–11:00 in Manila.
    expect((await adminTime(mia, '2026-10-20T00:00:00Z', 3 * H)).status).toBe(201);
    const rows = (await admin.get(o(`/attendance?from=2026-10-19&to=2026-10-20&membership_ids=${mia}`))).body as Array<{ date: string; status: string; worked_seconds: number }>;
    // Before the fix: Monday ABSENT and Tuesday PRESENT (unscheduled).
    expect(rows.map((r) => [r.date, r.status, r.worked_seconds])).toEqual([['2026-10-19', 'PRESENT', 3 * H]]);
  });

  it('an overnight shift split across two days counts each part on its own day', async () => {
    const { membershipId: nia } = await member('Nia');
    expect((await admin.post(o('/schedules'), { membership_id: nia, timezone: 'UTC', days: [{ dow: 1, start: '22:00', end: '23:59' }, { dow: 2, start: '00:00', end: '06:00' }], effective_from: '2026-10-01' })).status).toBe(201);
    expect((await adminTime(nia, '2026-10-19T22:00:00Z', 2 * H)).status).toBe(201);
    expect((await adminTime(nia, '2026-10-20T00:00:00Z', 6 * H)).status).toBe(201);
    const rows = (await admin.get(o(`/attendance?from=2026-10-19&to=2026-10-20&membership_ids=${nia}`))).body as Array<{ date: string; status: string; worked_seconds: number }>;
    expect(rows.map((r) => [r.date, r.status, r.worked_seconds]).sort()).toEqual([
      ['2026-10-19', 'PRESENT', 2 * H],
      ['2026-10-20', 'PRESENT', 6 * H],
    ]);
  });
});

describe('desktop heartbeats keep alive only the session the device still runs', () => {
  it('a session the app no longer knows is interrupted, not kept alive', async () => {
    t.clock.set(new Date('2026-10-22T09:00:00Z'));
    const { client: hal, membershipId: halId } = await member('Hal');
    const agent = await deviceFor(hal);
    const s = sessionEvents('2026-10-22T09:00:00Z', 0);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    // The app lost its local state: it heartbeats without a session.
    for (let i = 0; i < 6; i++) {
      t.clock.advance(2 * MIN);
      await agent.post('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: null });
    }
    await sweepSessions(t.deps);
    const [row] = await asOwner<{ state: string }>(sql`select state from tracking_sessions where id = ${s.sid}`);
    // Before the fix each heartbeat refreshed it and it stayed ACTIVE indefinitely.
    expect(row?.state).toBe('INTERRUPTED');
    void halId;
  });
});

describe('keeping idle time after the timer was resumed on the web', () => {
  it('credits the idle span', async () => {
    t.clock.set(new Date('2026-10-22T13:00:00Z'));
    const { client: kim, membershipId: kimId } = await member('Kim');
    await admin.put(o(`/policies/WORKER/${kimId}`), { idle: { behavior: 'pause' } });
    const agent = await deviceFor(kim);
    const sid = newId();
    const idleId = newId();
    const base = '2026-10-22T13:00:00Z';
    await agent.post('/agent/ingest/batch', { sent_at: base, events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: base, project_id: projectId }] });
    t.clock.set(new Date(iso(base, 10)));
    const r = await agent.post('/agent/ingest/batch', { sent_at: iso(base, 10), events: [{ event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: iso(base, 10), idle_id: idleId, started_at: iso(base, 10) }] });
    expect(r.body.session.state).toBe('PAUSED');
    // Resumed on the web at 13:30, before answering.
    t.clock.set(new Date(iso(base, 30)));
    expect((await kim.post(o('/tracking/resume'))).status).toBe(200);
    // Then "Keep" on the desktop, and stop at 14:00.
    t.clock.set(new Date(iso(base, 60)));
    await agent.post('/agent/ingest/batch', {
      sent_at: iso(base, 60),
      events: [
        { event_id: newId(), type: 'idle.resolved', session_id: sid, occurred_at: iso(base, 31), idle_id: idleId, started_at: iso(base, 10), ended_at: iso(base, 30), resolution: 'KEPT' },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 3, occurred_at: iso(base, 60) },
      ],
    });
    // 13:00–13:10 + kept 13:10–13:30 + 13:30–14:00. Before the fix the kept 20 minutes were lost (40 min).
    expect((await dayTotal(kimId, '2026-10-22')).total).toBe(60 * 60);
  });
});

describe('schedules', () => {
  it('a team manager cannot take over the schedule of someone outside their team', async () => {
    const { client: lead, membershipId: leadId } = await member('Lead', 'TEAM_MANAGER');
    const { membershipId: inTeam } = await member('Tia');
    const { membershipId: outside } = await member('Oz');
    const team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
    await admin.put(o(`/teams/${team}/members/${leadId}`), { role: 'MANAGER' });
    await admin.put(o(`/teams/${team}/members/${inTeam}`), { role: 'MEMBER' });
    const sched = (await admin.post(o('/schedules'), { membership_id: outside, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: '2026-10-01' })).body;
    const r = await lead.put(o(`/schedules/${sched.id}`), { membership_id: inTeam, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: '2026-10-01' });
    expect(r.status).toBe(403);
  });
});

describe('closed periods stay closed after the pay period changes', () => {
  it('time cannot be added to a week approved before the change, and the change waits for a clean period', async () => {
    t.clock.set(new Date('2026-10-21T12:00:00Z'));
    // Its own organization: the period guard looks at every timesheet in the organization.
    const { client: admin2, orgId: org2 } = await signup(t, 'Pam', 'pam@int2.test');
    const o2 = (p: string) => `/orgs/${org2}${p}`;
    const { client: pat, membershipId: patId } = await addMember(t, admin2, org2, 'Pat', 'pat@int2.test');
    const project2 = (await admin2.post(o2('/projects'), { name: 'Site', member_ids: [patId] })).body.id;
    const time2 = (startIso: string, seconds: number) => admin2.post(o2('/manual-time'), { membership_id: patId, project_id: project2, started_at: startIso, ended_at: new Date(Date.parse(startIso) + seconds * 1000).toISOString(), reason: 'fixture' });
    expect((await time2('2026-10-13T09:00:00Z', 8 * H)).status).toBe(201);
    const ts = (await pat.post(o2('/timesheets/submit'), { date: '2026-10-13' })).body;
    expect((await admin2.post(o2(`/timesheets/${ts.id}/approve`), {})).status).toBe(200);

    // Weekly → semimonthly: nothing in the current week is submitted yet, so it is allowed.
    expect((await admin2.patch(o2(''), { pay_period: { type: 'semimonthly' } })).status).toBe(200);
    // The approved week of 12–18 October still covers the 14th. Before the fix the new period
    // (1–15 October) had no timesheet, so this was accepted into an approved week.
    const late = await time2('2026-10-14T09:00:00Z', H);
    expect([late.status, late.body.code]).toEqual([422, 'timesheet_locked']);

    // Once the current period has a submitted timesheet, the boundaries cannot change.
    expect((await time2('2026-10-21T08:00:00Z', H)).status).toBe(201);
    expect((await pat.post(o2('/timesheets/submit'), { date: '2026-10-21' })).status).toBe(200);
    const back = await admin2.patch(o2(''), { pay_period: { type: 'weekly' } });
    expect([back.status, back.body.code]).toEqual([422, 'period_in_use']);
  });
});

describe('the age lock applies to resolving idle time too', () => {
  it('a worker cannot keep or reassign their own idle time on a locked day', async () => {
    t.clock.set(new Date('2026-10-23T12:00:00Z'));
    const { client: zed, membershipId: zedId } = await member('Zed');
    const agent = await deviceFor(zed);
    t.clock.set(new Date('2026-10-05T10:00:00Z'));
    const s = sessionEvents('2026-10-05T09:00:00Z', 60, { at: 10, back: 20 });
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [...s.events, s.stop] });
    t.clock.set(new Date('2026-10-23T12:00:00Z'));
    expect((await admin.patch(o(''), { settings: { lockAfterDays: 7 } })).status).toBe(200);
    const [ev] = (await admin.get(o(`/idle-events?from=2026-10-05&to=2026-10-05&membership_ids=${zedId}&status=PENDING`))).body as Array<{ id: string }>;
    const r = await zed.post(o(`/idle-events/${ev!.id}/resolve`), { resolution: 'DISCARDED' });
    expect([r.status, r.body.code]).toEqual([422, 'time_entries_locked']);
    // A manager is not bound by the age lock.
    expect((await admin.post(o(`/idle-events/${ev!.id}/resolve`), { resolution: 'DISCARDED' })).status).toBe(204);
    await admin.patch(o(''), { settings: { lockAfterDays: null } });
  });
});
