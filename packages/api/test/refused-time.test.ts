import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * What the desktop app relies on when it tracks offline (UX remediation, phases 2 and 3), next to
 * the server's own offline rules (offline-sync.test.ts): time whose project changed meanwhile is kept
 * and flagged for review, not refused. A batch sent twice adds the time once. What the server still
 * refuses (time recorded while tracking was turned off) is refused per record, with a code the app
 * explains, never takes the rest of the batch with it, and is listed in Time not added. A computer
 * waiting for approval keeps its time: once approved, the same records are accepted.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const day = (offset: number) => new Date(t.clock.now.getTime() + offset * 86400_000).toISOString().slice(0, 10);

async function newDevice() {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  const reg = await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.1.9' } });
  expect(reg.status).toBe(201);
  agent.bearer = reg.body.access_token;
  return { agent, deviceId: reg.body.device_id as string };
}

/** An offline session as the app queues it: start, an hour of activity, a screenshot, stop. */
function offlineSession(projectId: string, startMs: number) {
  const sid = newId();
  const at = (min: number) => new Date(startMs + min * 60_000).toISOString();
  return {
    sid,
    events: [
      { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId },
      { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(60), minutes: Array.from({ length: 60 }, (_, i) => ({ minute_start: at(i), keyboard: 10, mouse: 10, active_seconds: 60, tracked_seconds: 60 })) },
      { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(60) },
    ],
  };
}

type Entry = { session_id: string | null; duration_seconds: number };
const entriesFor = async (sid: string) => {
  const body = (await admin.get<Entry[] | { data: Entry[] }>(o(`/time-entries?from=${day(-3)}&to=${day(1)}`))).body;
  return (Array.isArray(body) ? body : body.data).filter((e) => e.session_id === sid);
};

/** Turn tracking off for the worker for one test (the one refusal offline time still gets). */
async function trackingOff() {
  expect((await admin.patch(o(`/workers/${workerId}`), { tracking_enabled: false })).status).toBe(200);
  onTestFinished(async () => void (await admin.patch(o(`/workers/${workerId}`), { tracking_enabled: true })));
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@offline.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@offline.test'));
}, 60_000);
afterAll(() => t.close());

describe('offline sync', () => {
  it('a batch sent again after a lost answer adds the time once', async () => {
    const projectId = (await admin.post(o('/projects'), { name: 'Replay', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    const s = offlineSession(projectId, t.clock.now.getTime() - 3 * 3600_000);
    const first = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    // The app never saw that answer, so it sends the whole batch again, and once more later.
    for (let i = 0; i < 2; i++) {
      const again = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
      expect(again.body.results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    }
    const entries = await entriesFor(s.sid);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.duration_seconds).toBe(3600);
  });

  it('time on a project the worker was taken off, or one archived since, is kept (flagged for review), not refused', async () => {
    const removed = (await admin.post(o('/projects'), { name: 'Removed', member_ids: [workerId] })).body.id;
    const archived = (await admin.post(o('/projects'), { name: 'Archived later', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    expect((await admin.patch(o(`/projects/${removed}`), { member_ids: [] })).status).toBe(200);
    expect((await admin.post(o(`/projects/${archived}/archive`))).status).toBe(204);
    const a = offlineSession(removed, t.clock.now.getTime() - 6 * 3600_000);
    const b = offlineSession(archived, t.clock.now.getTime() - 8 * 3600_000);
    const r = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [...a.events, ...b.events] });
    expect(r.body.results.every((x: { status: string }) => x.status === 'accepted')).toBe(true);
    expect((await entriesFor(a.sid))[0]!.duration_seconds).toBe(3600);
    expect((await entriesFor(b.sid))[0]!.duration_seconds).toBe(3600);
    // Kept time is for the approver to review, not "time not added".
    const listed = (await admin.get<Array<{ project_id: string }>>(o(`/time-not-added?from=${day(-3)}&to=${day(1)}&status=all`))).body;
    expect(listed.filter((x) => x.project_id === removed || x.project_id === archived)).toEqual([]);
  });

  it('time recorded while tracking was turned off is refused per record with a code, and only that time', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Turned off', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    const fine = offlineSession(p, t.clock.now.getTime() - 9 * 3600_000);
    const sentBefore = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: fine.events });
    expect(sentBefore.body.results.every((x: { status: string }) => x.status === 'accepted')).toBe(true);
    await trackingOff();
    const refused = offlineSession(p, t.clock.now.getTime() - 7 * 3600_000);
    const r = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: refused.events });
    const byId = new Map(r.body.results.map((x: { event_id: string; status: string; code?: string }) => [x.event_id, x]));
    // The start says why; its later records follow from it (codes the app maps to plain words).
    expect(byId.get(refused.events[0]!.event_id)).toMatchObject({ status: 'rejected', code: 'tracking_disabled' });
    expect(byId.get(refused.events[2]!.event_id)).toMatchObject({ status: 'rejected' });
    expect(await entriesFor(refused.sid)).toHaveLength(0);
    // Time sent before tracking was turned off stays.
    expect((await entriesFor(fine.sid))[0]!.duration_seconds).toBe(3600);
  });

  it('a monitor turned off while offline refuses only its data; the time still counts', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Monitors', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    expect((await admin.put(o(`/policies/ORG/${orgId}`), { activity: { enabled: false } })).status).toBe(200);
    onTestFinished(async () => void (await admin.put(o(`/policies/ORG/${orgId}`), { activity: { enabled: true } })));
    const s = offlineSession(p, t.clock.now.getTime() - 10 * 3600_000);
    const r = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    expect(r.body.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['accepted', 'activity_disabled', 'accepted']);
    expect((await entriesFor(s.sid))[0]!.duration_seconds).toBe(3600);
  });

  it('a computer waiting for approval keeps its time: after approval the same records are accepted', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Pending', member_ids: [workerId] })).body.id;
    expect((await admin.patch(o(''), { settings: { requireDeviceApproval: true } })).status).toBe(200);
    onTestFinished(async () => void (await admin.patch(o(''), { settings: { requireDeviceApproval: false } })));
    const { agent, deviceId } = await newDevice();
    const s = offlineSession(p, t.clock.now.getTime() - 12 * 3600_000);
    const refused = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    expect([refused.status, refused.body.code]).toEqual([403, 'device_pending']);

    expect((await admin.post(o(`/devices/${deviceId}/approve`))).status).toBe(200);
    const sent = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    // Not "duplicate": nothing was recorded while it waited.
    expect(sent.body.results.map((x: { status: string }) => x.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect((await entriesFor(s.sid))[0]!.duration_seconds).toBe(3600);
  });
});

describe('Time not added (managers)', () => {
  const notAdded = (c: Client, status = 'open') => c.get<Array<Record<string, unknown>>>(o(`/time-not-added?from=${day(-3)}&to=${day(1)}&status=${status}`));

  it('lists refused offline time with who, when, how long and why; never monitoring data; never twice', async () => {
    const removed = (await admin.post(o('/projects'), { name: 'Taken off', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    await trackingOff();
    const s = offlineSession(removed, t.clock.now.getTime() - 30 * 3600_000);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    // Sent again (interrupted sync): one row, not two.
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });

    const rows = (await notAdded(admin)).body.filter((r) => r.project_id === removed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ worker_name: 'Walt', kind: 'time', project_name: 'Taken off', duration_seconds: 3600, code: 'tracking_disabled', status: 'OPEN' });
    // A monitor turned off refuses data, not time: not listed for managers.
    expect((await notAdded(admin, 'all')).body.every((r) => r.kind === 'time')).toBe(true);
  });

  it('follows the worker’s correction through the usual manual-time approval, and never adds it by itself', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Refused offline', member_ids: [workerId] })).body.id;
    const kept = (await admin.post(o('/projects'), { name: 'Correction target', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    expect((await admin.patch(o(`/workers/${workerId}`), { tracking_enabled: false })).status).toBe(200);
    const start = t.clock.now.getTime() - 40 * 3600_000;
    const s = offlineSession(p, start);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    // Turned back on before the worker asks for the time.
    expect((await admin.patch(o(`/workers/${workerId}`), { tracking_enabled: true })).status).toBe(200);
    const row = () => notAdded(admin, 'all').then((r) => r.body.find((x) => x.project_id === p)!);
    expect(await row()).toMatchObject({ status: 'OPEN', code: 'tracking_disabled' });
    expect(await entriesFor(s.sid)).toHaveLength(0);

    // The worker asks for the time as manual time on a project they are still on.
    const requestId = newId();
    const req = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [{ event_id: requestId, type: 'manual_time.request', occurred_at: t.clock.now.toISOString(), project_id: kept, started_at: new Date(start).toISOString(), ended_at: new Date(start + 3600_000).toISOString(), reason: 'Worked offline while tracking was off by mistake', refused_session_id: s.sid }],
    });
    expect(req.body.results[0].status).toBe('accepted');
    expect(await row()).toMatchObject({ status: 'CORRECTION_REQUESTED', manual_request_id: requestId, worker_reason: 'Worked offline while tracking was off by mistake' });

    // Approved by the manager in the existing flow: only then is it time.
    expect((await admin.post(o(`/manual-time/${requestId}/approve`), {})).status).toBe(204);
    expect(await row()).toMatchObject({ status: 'CORRECTED' });
    expect((await notAdded(admin)).body.find((x) => x.project_id === p)).toBeUndefined(); // resolved: off the open list
  });

  it('records the worker removing it, audited, and shows it as decided', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Dismissed', member_ids: [workerId] })).body.id;
    const { agent } = await newDevice();
    await trackingOff();
    const s = offlineSession(p, t.clock.now.getTime() - 50 * 3600_000);
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: s.events });
    expect((await agent.post(`/agent/me/refused/${s.sid}/dismiss`)).status).toBe(204);
    expect((await notAdded(admin, 'all')).body.find((x) => x.project_id === p)).toMatchObject({ status: 'DISMISSED' });
    const logs = (await admin.get<{ data: Array<{ action: string }> } | Array<{ action: string }>>(o('/audit-logs'))).body;
    expect((Array.isArray(logs) ? logs : logs.data).some((l) => l.action === 'refused_time.dismissed')).toBe(true);
    // Only the worker's own, and only once.
    expect((await agent.post(`/agent/me/refused/${s.sid}/dismiss`)).status).toBe(204);
    expect((await agent.post(`/agent/me/refused/${newId()}/dismiss`)).status).toBe(404);
  });

  it('is hidden from people who may not see the worker’s tracking, and from other organizations', async () => {
    const { client: lonelyManager } = await addMember(t, admin, orgId, 'Nobody’s manager', 'mgr@offline.test', 'TEAM_MANAGER');
    expect((await notAdded(lonelyManager, 'all')).body).toEqual([]);
    // A worker sees only their own (as with their sessions).
    const own = await notAdded(worker, 'all');
    expect(own.status).toBe(200);
    expect(own.body.length).toBeGreaterThan(0);
    expect(own.body.every((r) => r.membership_id === workerId)).toBe(true);
    const other = await signup(t, 'Olga', 'olga@other.test');
    const theirs = await other.client.get<unknown[]>(`/orgs/${other.orgId}/time-not-added?from=${day(-3)}&to=${day(1)}&status=all`);
    expect(theirs.body).toEqual([]);
  });
});
