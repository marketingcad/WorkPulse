import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Fixes from the time & timesheets audit (October 2026). Organization timezone: UTC.
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

const memberIds: string[] = [];
async function member(name: string) {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@acc.test`);
  memberIds.push(m.membershipId);
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: memberIds })).status).toBe(200);
  return m;
}

/** Time entered by an admin for a member: created directly, no approval step. */
async function adminTime(membershipId: string, startIso: string, seconds: number, extra: object = {}) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture', ...extra });
  expect(r.status).toBe(201);
}

async function entries(membershipId: string, from: string, to: string) {
  return (await admin.get(o(`/time-entries?from=${from}&to=${to}&membership_ids=${membershipId}`))).body as Array<{ id: string; duration_seconds: number; billable: boolean; time_type_id: string | null; session_id: string | null }>;
}

async function deviceFor(worker: Client) {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
  return agent;
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-25T15:00:00Z')); // Sunday
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@acc.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('weekly limit uses the organization week start', () => {
  it('with weeks starting on Sunday, last week’s 40 h do not block Sunday', async () => {
    const { client: walt, membershipId: waltId } = await member('Walt');
    expect((await admin.patch(o(''), { week_start: 0 })).status).toBe(200);
    await admin.put(o(`/policies/WORKER/${waltId}`), { limits: { weeklySeconds: 40 * H } });
    // Mon 19 – Fri 23 October, 8 h a day: the week of Sun 18 – Sat 24.
    for (const d of ['19', '20', '21', '22', '23']) await adminTime(waltId, `2026-10-${d}T08:00:00Z`, 8 * H);
    // Sunday 25 starts a new week: 0 h so far. (Before the fix the start used Monday weeks: 40 h, refused.)
    const r = await walt.post(o('/tracking/start'), { project_id: projectId });
    expect([r.status, r.body.code]).toEqual([200, undefined]);
    await walt.post(o('/tracking/stop'));
    await admin.patch(o(''), { week_start: 1 });
  });
});

describe('desktop totals', () => {
  it('bootstrap reports finished time only, so the app’s own running seconds are not counted twice', async () => {
    t.clock.set(new Date('2026-10-26T09:00:00Z'));
    const { client: dee, membershipId: deeId } = await member('Dee');
    await adminTime(deeId, '2026-10-26T06:00:00Z', 2 * H); // 2 h finished today
    const agent = await deviceFor(dee);
    const sid = newId();
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }] });
    t.clock.advance(H * 1000); // the timer has run 1 h

    const boot = (await agent.get('/agent/bootstrap')).body;
    // The app shows today_seconds + (now − segment start) = 2 h + 1 h. Before the fix it got 3 h here and showed 4 h.
    expect([boot.today_seconds, boot.week_seconds]).toEqual([2 * H, 2 * H]);
    // The web timer adds only the time since its own fetch, so it still gets the running time included.
    expect((await dee.get(o('/tracking/current'))).body.today_seconds).toBe(3 * H);

    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString() }] });
    expect((await agent.get('/agent/bootstrap')).body.today_seconds).toBe(3 * H);
  });
});

describe('dashboard', () => {
  it('this week’s billable time includes a running billable timer, like today’s does', async () => {
    t.clock.set(new Date('2026-10-26T12:00:00Z'));
    const { client: rae } = await member('Rae');
    expect((await rae.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
    t.clock.advance(30 * 60_000);
    await t.flush(); // rebuild the daily rollups from the finished entries
    const w =(await admin.get(o('/dashboard/widgets?keys=worked_today,tracked_week&scope=ALL'))).body;
    // Monday: the week so far is today, so both include Rae's running 30 min (on a billable project).
    expect(w.worked_today.billable_seconds).toBeGreaterThanOrEqual(30 * 60);
    expect(w.tracked_week.billable_seconds).toBe(w.worked_today.billable_seconds);
    await rae.post(o('/tracking/stop'));
  });
});

describe('time types that are never billable', () => {
  it('stay non-billable when billable is switched on later, one by one or in bulk', async () => {
    t.clock.set(new Date('2026-10-26T18:00:00Z'));
    const { membershipId: bobId } = await member('Bob');
    const training = (await admin.post(o('/time-types'), { name: 'Training', short_name: 'T', pay_coefficient: 1, bill_coefficient: 0, not_billable: true })).body.id;
    await adminTime(bobId, '2026-10-26T13:00:00Z', H, { time_type_id: training });
    const [e] = await entries(bobId, '2026-10-26', '2026-10-26');
    expect(e!.billable).toBe(false);

    expect((await admin.post(o('/time-entries/bulk'), { ids: [e!.id], action: 'set_billable', reason: 'billable' })).status).toBe(200);
    expect((await entries(bobId, '2026-10-26', '2026-10-26'))[0]!.billable).toBe(false);
    expect((await admin.patch(o(`/time-entries/${e!.id}`), { billable: true, reason: 'billable' })).status).toBe(200);
    expect((await entries(bobId, '2026-10-26', '2026-10-26'))[0]!.billable).toBe(false);
  });
});

describe('resolving an unanswered idle period from the web', () => {
  it('ends the idle period when input resumed, not at the moment someone resolves it', async () => {
    t.clock.set(new Date('2026-10-27T09:00:00Z'));
    const { client: ivy, membershipId: ivyId } = await member('Ivy');
    await admin.put(o(`/policies/WORKER/${ivyId}`), { idle: { behavior: 'prompt' } });
    const agent = await deviceFor(ivy);
    const at = (min: number) => new Date(Date.parse('2026-10-27T09:00:00Z') + min * 60_000).toISOString();
    const minute = (min: number, active: number) => ({ minute_start: at(min), keyboard: active ? 30 : 0, mouse: active ? 20 : 0, active_seconds: active, tracked_seconds: 60 });
    const sid = newId();
    const idleId = newId();
    t.clock.set(new Date(at(60)));
    // Worked 09:00–09:10, idle 09:10–09:20 (prompt never answered), worked 09:20–10:00.
    const r = await agent.post('/agent/ingest/batch', {
      sent_at: at(60),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId },
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(60), minutes: Array.from({ length: 60 }, (_, i) => minute(i, i >= 10 && i < 20 ? 0 : 50)) },
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(10), idle_id: idleId, started_at: at(10) },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(60) },
      ],
    });
    expect(r.body.results.every((x: { status: string }) => x.status !== 'rejected')).toBe(true);
    const total = async () => (await entries(ivyId, '2026-10-27', '2026-10-27')).reduce((s, e) => s + e.duration_seconds, 0);
    expect(await total()).toBe(60 * 60);

    // A manager discards it the next morning.
    t.clock.set(new Date('2026-10-28T08:00:00Z'));
    const pending = (await admin.get(o(`/idle-events?from=2026-10-27&to=2026-10-27&membership_ids=${ivyId}&status=PENDING`))).body as Array<{ id: string }>;
    expect(pending).toHaveLength(1);
    expect((await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'DISCARDED' })).status).toBe(204);
    // 10 minutes removed (09:10–09:20). Before the fix the idle "ended" at the resolve time, leaving only 10 minutes.
    expect(await total()).toBe(50 * 60);
  });

  it('with no input after it, the idle period ends with the session', async () => {
    t.clock.set(new Date('2026-10-28T09:00:00Z'));
    const { client: max, membershipId: maxId } = await member('Max');
    await admin.put(o(`/policies/WORKER/${maxId}`), { idle: { behavior: 'prompt' } });
    const agent = await deviceFor(max);
    const at = (min: number) => new Date(Date.parse('2026-10-28T09:00:00Z') + min * 60_000).toISOString();
    const sid = newId();
    t.clock.set(new Date(at(30)));
    await agent.post('/agent/ingest/batch', {
      sent_at: at(30),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId },
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(20), idle_id: newId(), started_at: at(20) },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(30) },
      ],
    });
    t.clock.set(new Date('2026-10-29T08:00:00Z'));
    const [ev] = (await admin.get(o(`/idle-events?from=2026-10-28&to=2026-10-28&membership_ids=${maxId}&status=PENDING`))).body as Array<{ id: string }>;
    expect((await admin.post(o(`/idle-events/${ev!.id}/resolve`), { resolution: 'DISCARDED' })).status).toBe(204);
    // 09:20 to the 09:30 stop is removed; 20 minutes stay.
    expect((await entries(maxId, '2026-10-28', '2026-10-28')).reduce((s, e) => s + e.duration_seconds, 0)).toBe(20 * 60);
  });
});
