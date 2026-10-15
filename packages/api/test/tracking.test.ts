import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { sweepSessions } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
let agent: Client;

const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);
const RANGE = () => `from=${day(-30)}&to=${day(30)}`;

async function entriesTotal(sessionId?: string) {
  const r = await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`);
  return r.body.filter((e: { session_id: string | null }) => !sessionId || e.session_id === sessionId).reduce((s: number, e: { duration_seconds: number }) => s + e.duration_seconds, 0);
}

async function ingest(events: unknown[], sentAt = t.clock.now) {
  return agent.post('/agent/ingest/batch', { sent_at: sentAt.toISOString(), events });
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@t.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@t.test'));
  projectId = (await admin.post(`/orgs/${orgId}/projects`, { name: 'P', member_ids: [workerId] })).body.id;
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  agent = new Client(t);
  const reg = await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.0' } });
  agent.bearer = reg.body.access_token;
});
afterAll(() => t.close());

describe('offline tracking', () => {
  it('sweeper interrupts a silent desktop session; replayed offline events recover it with no gap', async () => {
    const sid = newId();
    const start = new Date(t.clock.now);
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: start.toISOString(), project_id: projectId }]);
    // Device goes offline: no heartbeats for 10 minutes.
    t.clock.advance(10 * 60_000);
    const s = await sweepSessions(t.deps);
    expect(s.interrupted).toBe(1);
    expect((await worker.get(`/orgs/${orgId}/tracking/current`)).body.session.state).toBe('INTERRUPTED');
    // Back online after 60 minutes total: replay activity + stop.
    t.clock.advance(50 * 60_000);
    const r = await ingest([
      { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: new Date(start.getTime() + 30 * 60_000).toISOString(), minutes: [{ minute_start: new Date(start.getTime() + 30 * 60_000).toISOString(), keyboard: 5, mouse: 5, active_seconds: 40, tracked_seconds: 60 }] },
      { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString() },
    ]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['accepted', 'accepted']);
    expect(await entriesTotal(sid)).toBe(60 * 60);
  });

  it('corrects device clock skew and never records future time', async () => {
    const sid = newId();
    // Device clock is 2 hours behind the server.
    const deviceNow = new Date(t.clock.now.getTime() - 2 * 3600_000);
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: deviceNow.toISOString(), project_id: projectId }], deviceNow);
    t.clock.advance(15 * 60_000);
    const deviceLater = new Date(deviceNow.getTime() + 15 * 60_000);
    const r = await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: deviceLater.toISOString() }], deviceLater);
    expect(Math.abs(r.body.clock_skew_ms - 2 * 3600_000)).toBeLessThan(5_000);
    const total = await entriesTotal(sid);
    expect(Math.abs(total - 15 * 60)).toBeLessThanOrEqual(2);
    const entries = (await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`)).body.filter((e: { session_id: string }) => e.session_id === sid);
    expect(new Date(entries[0].ended_at).getTime()).toBeLessThanOrEqual(t.clock.now.getTime() + 5_000);
  });

  it('ignores out-of-order and duplicate state commands by sequence', async () => {
    const sid = newId();
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    t.clock.advance(5 * 60_000);
    await ingest([{ event_id: newId(), type: 'session.pause', session_id: sid, seq: 3, occurred_at: t.clock.now.toISOString(), kind: 'BREAK' }]);
    const late = await ingest([{ event_id: newId(), type: 'session.resume', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString() }]);
    expect(late.body.results[0].status).toBe('duplicate');
    expect(late.body.session.state).toBe('PAUSED');
    t.clock.advance(60_000);
    await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 4, occurred_at: t.clock.now.toISOString() }]);
    expect(await entriesTotal(sid)).toBe(5 * 60);
  });
});

describe('single timer across devices', () => {
  it('starting on the web supersedes the running desktop session', async () => {
    const sid = newId();
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    t.clock.advance(3 * 60_000);
    const web = await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId });
    expect(web.body.session.source).toBe('WEB');
    const hb = await agent.post('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: sid });
    expect(hb.body.session.source ?? hb.body.session.id).not.toBe(sid);
    expect(await entriesTotal(sid)).toBe(3 * 60);
    await worker.post(`/orgs/${orgId}/tracking/stop`);
  });

  it('reject policy returns 409 instead of superseding', async () => {
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, { tracking: { singleTimer: 'reject' } });
    await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId });
    const r = await ingest([{ event_id: newId(), type: 'session.start', session_id: newId(), seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    expect(r.body.results[0]).toMatchObject({ status: 'rejected', code: 'session_already_running' });
    await worker.post(`/orgs/${orgId}/tracking/stop`);
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, {});
  });
});

describe('limits, pause timeout, idle pause policy', () => {
  it('stops tracking at the daily limit', async () => {
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, { limits: { dailySeconds: 1 } });
    const r = await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('limit_reached');
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, {});
  });

  it('auto-stops a session paused longer than the maximum', async () => {
    await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId });
    t.clock.advance(60_000);
    await worker.post(`/orgs/${orgId}/tracking/pause`);
    t.clock.advance(5 * 3600_000);
    await sweepSessions(t.deps);
    expect((await worker.get(`/orgs/${orgId}/tracking/current`)).body.session).toBeNull();
  });

  it('idle with pause policy: kept idle becomes work, session resumes', async () => {
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, { idle: { behavior: 'pause' } });
    const sid = newId();
    const t0 = new Date(t.clock.now);
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t0.toISOString(), project_id: projectId }]);
    const idleId = newId();
    t.clock.advance(20 * 60_000);
    const r = await ingest([
      { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: new Date(t0.getTime() + 10 * 60_000).toISOString(), idle_id: idleId, started_at: new Date(t0.getTime() + 10 * 60_000).toISOString() },
    ]);
    expect(r.body.session.state).toBe('PAUSED');
    const r2 = await ingest([
      { event_id: newId(), type: 'idle.resolved', session_id: sid, occurred_at: t.clock.now.toISOString(), idle_id: idleId, started_at: new Date(t0.getTime() + 10 * 60_000).toISOString(), ended_at: t.clock.now.toISOString(), resolution: 'KEPT' },
    ]);
    expect(r2.body.session.state).toBe('ACTIVE');
    t.clock.advance(5 * 60_000);
    await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString() }]);
    expect(await entriesTotal(sid)).toBe(25 * 60);
    await admin.put(`/orgs/${orgId}/policies/WORKER/${workerId}`, {});
  });
});

describe('manual time, edits and approvals', () => {
  it('requires approval, then creates a MANUAL entry', async () => {
    const start = new Date(Date.parse(`${day(-2)}T14:00:00Z`));
    const r = await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 3600_000).toISOString(), reason: 'Client meeting offline' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    expect((await worker.post(`/orgs/${orgId}/manual-time/${r.body.id}/approve`, {})).status).toBe(403);
    expect((await admin.post(`/orgs/${orgId}/manual-time/${r.body.id}/approve`, {})).status).toBe(204);
    const e = (await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`)).body.find((x: { source: string }) => x.source === 'MANUAL');
    expect(e.duration_seconds).toBe(3600);
    // Overlapping manual time is rejected.
    const dup = await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 600_000).toISOString(), reason: 'again' });
    expect(dup.status).toBe(422);
  });

  it('manual time cannot overlap the timer that is running now (it would be counted twice)', async () => {
    const timerStart = new Date(t.clock.now);
    expect((await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId })).status).toBe(200);
    t.clock.advance(30 * 60_000);
    const at = (min: number) => new Date(timerStart.getTime() + min * 60_000).toISOString();

    const inside = await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: at(5), ended_at: at(15), reason: 'meeting' });
    expect(inside.status).toBe(422);
    expect(inside.body.code).toBe('time_overlap');
    const across = await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: at(-20), ended_at: at(5), reason: 'meeting' });
    expect(across.status).toBe(422);
    // Before the timer started is fine.
    const before = await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: at(-60), ended_at: at(-30), reason: 'meeting' });
    expect(before.status).toBe(201);

    expect((await worker.post(`/orgs/${orgId}/tracking/stop`)).status).toBe(200);
    // Once stopped, the tracked time is an entry and the same range is still refused.
    expect((await worker.post(`/orgs/${orgId}/manual-time`, { project_id: projectId, started_at: at(5), ended_at: at(15), reason: 'meeting' })).status).toBe(422);
  });

  it('edits require a reason, are revisioned, and cannot overlap', async () => {
    const e = (await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`)).body.find((x: { source: string }) => x.source === 'MANUAL');
    expect((await worker.patch(`/orgs/${orgId}/time-entries/${e.id}`, { note: 'x' })).status).toBe(400);
    const ok = await worker.patch(`/orgs/${orgId}/time-entries/${e.id}`, { ended_at: new Date(Date.parse(e.ended_at) - 600_000).toISOString(), reason: 'Left early' });
    expect(ok.status).toBe(200);
    expect(ok.body.duration_seconds).toBe(3000);
    const revs = await worker.get(`/orgs/${orgId}/time-entries/${e.id}/revisions`);
    expect(revs.body.map((r: { action: string }) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(revs.body[1].reason).toBe('Left early');
  });
});

describe('time off', () => {
  it('requests against a balance and approval debits the ledger', async () => {
    const pol = await admin.post(`/orgs/${orgId}/time-off/policies`, { name: 'PTO', accrual: { type: 'annual', amountHours: 80, maxBalanceHours: null, carryOverHours: null } });
    expect(pol.status).toBe(201);
    await admin.post(`/orgs/${orgId}/time-off/balances/adjust`, { policy_id: pol.body.id, membership_id: workerId, hours: 16 });
    // Find next Monday so the request contains 2 working days.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    const mon = d.toISOString().slice(0, 10);
    const tue = new Date(d.getTime() + 86400_000).toISOString().slice(0, 10);
    const tooMuch = await worker.post(`/orgs/${orgId}/time-off/requests`, { policy_id: pol.body.id, start_date: mon, end_date: new Date(d.getTime() + 4 * 86400_000).toISOString().slice(0, 10) });
    expect(tooMuch.status).toBe(422);
    const req = await worker.post(`/orgs/${orgId}/time-off/requests`, { policy_id: pol.body.id, start_date: mon, end_date: tue });
    expect(req.status).toBe(201);
    expect(req.body.hours).toBe(16);
    expect((await admin.post(`/orgs/${orgId}/time-off/requests/${req.body.id}/approve`, {})).status).toBe(204);
    const bal = (await worker.get(`/orgs/${orgId}/time-off/balances`)).body.find((b: { policy_id: string }) => b.policy_id === pol.body.id);
    expect(bal.balance_hours).toBe(0);
    // Cancelling an approved request reverses the debit.
    expect((await worker.post(`/orgs/${orgId}/time-off/requests/${req.body.id}/cancel`, {})).status).toBe(204);
    expect((await worker.get(`/orgs/${orgId}/time-off/balances`)).body.find((b: { policy_id: string }) => b.policy_id === pol.body.id).balance_hours).toBe(16);
  });
});

describe('schedules and attendance', () => {
  it('derives late arrival from schedule vs tracked time', async () => {
    await admin.post(`/orgs/${orgId}/schedules`, { membership_id: workerId, timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: '09:00', end: '17:00' })), effective_from: day(-10) });
    const target = day(-3);
    const start = new Date(`${target}T09:30:00Z`);
    await admin.post(`/orgs/${orgId}/manual-time`, { membership_id: workerId, project_id: projectId, started_at: start.toISOString(), ended_at: new Date(start.getTime() + 2 * 3600_000).toISOString(), reason: 'backfill' });
    const rows = (await admin.get(`/orgs/${orgId}/attendance?from=${target}&to=${target}&membership_ids=${workerId}`)).body;
    expect(rows[0]).toMatchObject({ status: 'LATE', late_seconds: 1800, worked_seconds: 7200 });
  });
});
