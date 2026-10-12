import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, ROLE_PRESETS } from '@tallywork/domain';
import { deviceGrants } from '../src/services/agent-me';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * The desktop app's own-data API (/agent/me/*): a device reads back ONLY its bound
 * worker's own data, never screenshots, and loses access the moment it is revoked.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let bea: Client;
let beaId: string;
let manager: Client;
let managerId: string;
let projectId: string;
let agent: Client;
let managerAgent: Client;
let waltSession: string;
let beaSession: string;
let shotId: string;

const today = () => t.clock.now.toISOString().slice(0, 10);

async function device(member: Client, name: string): Promise<Client> {
  const { verifier, challenge } = pkce();
  const code = await member.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const c = new Client(t);
  c.bearer = (await c.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name, platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
  return c;
}

beforeAll(async () => {
  t = await createHarness();
  // Mid-day in the org's zone so today's totals stay on one date.
  t.clock.set(new Date(`${new Date().toISOString().slice(0, 10)}T16:00:00Z`));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@t.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@t.test'));
  ({ client: bea, membershipId: beaId } = await addMember(t, admin, orgId, 'Bea', 'bea@t.test'));
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Mia', 'mia@t.test', 'TEAM_MANAGER'));
  projectId = (await admin.post(`/orgs/${orgId}/projects`, { name: 'Website', member_ids: [waltId, beaId, managerId] })).body.id;
  // Mia manages a team with Walt in it: her own web login can see Walt's sessions.
  const team = (await admin.post(`/orgs/${orgId}/teams`, { name: 'Design' })).body.id;
  expect((await admin.put(`/orgs/${orgId}/teams/${team}/members/${managerId}`, { role: 'MANAGER' })).status).toBeLessThan(300);
  expect((await admin.put(`/orgs/${orgId}/teams/${team}/members/${waltId}`, { role: 'MEMBER' })).status).toBeLessThan(300);
  expect((await admin.put(`/orgs/${orgId}/policies/ORG/${orgId}`, { screenshots: { enabled: true, perTenMinutes: 1 } })).status).toBe(200);
  agent = await device(walt, 'Walt-PC');
  managerAgent = await device(manager, 'Mia-PC');

  // Walt tracks 30 minutes on the desktop, with activity and a screenshot.
  waltSession = newId();
  const start = new Date(t.clock.now);
  const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
  await agent.post('/agent/ingest/batch', { sent_at: at(0), events: [{ event_id: newId(), type: 'session.start', session_id: waltSession, seq: 1, occurred_at: at(0), project_id: projectId }] });
  t.clock.advance(5 * 60_000);
  shotId = newId();
  const intent = await agent.post('/agent/screenshots/upload-intent', { screenshot_id: shotId, session_id: waltSession, captured_at: at(5 * 60_000), content_type: 'image/webp', bytes: 4 });
  await agent.post('/agent/ingest/batch', {
    sent_at: at(5 * 60_000),
    events: [
      { event_id: newId(), type: 'activity.minutes', session_id: waltSession, occurred_at: at(5 * 60_000), minutes: [{ minute_start: at(60_000), keyboard: 30, mouse: 20, active_seconds: 45, tracked_seconds: 60 }] },
      { event_id: newId(), type: 'screenshot.captured', session_id: waltSession, occurred_at: at(5 * 60_000), screenshot_id: shotId, captured_at: at(5 * 60_000), display_index: 0, blurred: false, width: 1920, height: 1080, bytes: 4, sha256: 'a'.repeat(64), storage_key: intent.body.storage_key },
    ],
  });
  t.clock.advance(25 * 60_000);
  await agent.post('/agent/ingest/batch', { sent_at: at(30 * 60_000), events: [{ event_id: newId(), type: 'session.stop', session_id: waltSession, seq: 2, occurred_at: at(30 * 60_000) }] });

  // Bea tracks 10 minutes on the web: never visible to Walt's device.
  expect((await bea.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId })).status).toBeLessThan(300);
  beaSession = (await bea.get(`/orgs/${orgId}/tracking/current`)).body.session.id;
  t.clock.advance(10 * 60_000);
  await bea.post(`/orgs/${orgId}/tracking/stop`);
  await t.flush();
});
afterAll(() => t.close());

describe('device grants', () => {
  it('never widen a role and never include screenshots, edits or approvals', () => {
    for (const [role, grants] of Object.entries(ROLE_PRESETS)) {
      const g = deviceGrants(grants);
      for (const [perm, scope] of Object.entries(g)) {
        expect(grants[perm as keyof typeof grants], `${role} ${perm}`).toBeTruthy();
        expect(['own', 'assigned'], `${role} ${perm}`).toContain(scope);
      }
      expect(Object.keys(g).some((p) => /^screenshots:|:edit$|:approve$|:manage$|^expenses:|^invoices:|^rates:/.test(p)), role).toBe(false);
    }
    // An admin's device is just as narrow as a worker's.
    expect(deviceGrants(ROLE_PRESETS.SYSTEM_ADMIN)['tracking:read']).toBe('own');
    // The device role itself only lists its worker's assignments.
    expect(deviceGrants(ROLE_PRESETS.AGENT)).toEqual({ 'projects:read': 'assigned', 'tasks:read': 'assigned' });
  });
});

describe('/agent/me own data', () => {
  it('summary: today\'s own totals only (Bea\'s 10 minutes are not counted)', async () => {
    const r = await agent.get('/agent/me/summary');
    expect(r.status).toBe(200);
    expect(r.body.worked_seconds).toBe(30 * 60);
    expect(r.body.projects).toEqual([expect.objectContaining({ project_id: projectId, seconds: 30 * 60 })]);
    expect(r.body.days).toHaveLength(1);
  });

  it('sessions: own sessions only', async () => {
    const r = await agent.get('/agent/me/sessions');
    expect(r.status).toBe(200);
    const ids = r.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(waltSession);
    expect(ids).not.toContain(beaSession);
    expect(r.body.every((s: { membership_id: string }) => s.membership_id === waltId)).toBe(true);
  });

  it('a team manager\'s device is narrowed to own data (her web login can see her team)', async () => {
    const web = await manager.get(`/orgs/${orgId}/sessions?from=${today()}&to=${today()}`);
    expect(web.body.map((s: { id: string }) => s.id)).toContain(waltSession);
    const dev = await managerAgent.get('/agent/me/sessions');
    expect(dev.status).toBe(200);
    expect(dev.body.map((s: { id: string }) => s.id)).not.toContain(waltSession);
  });

  it('activity: own blocks with screenshots always stripped', async () => {
    const web = await walt.get(`/orgs/${orgId}/activity/day?date=${today()}`);
    expect(web.body.blocks.flatMap((b: { screenshots: unknown[] }) => b.screenshots)).toHaveLength(1);
    const r = await agent.get('/agent/me/activity');
    expect(r.status).toBe(200);
    expect(r.body.membership_id).toBe(waltId);
    expect(r.body.blocks.length).toBeGreaterThan(0);
    expect(r.body.blocks.flatMap((b: { screenshots: unknown[] }) => b.screenshots)).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain(shotId);
  });

  it('timesheet: read and submit own', async () => {
    const r = await agent.get('/agent/me/timesheet');
    expect(r.status).toBe(200);
    expect(r.body.membership_id).toBe(waltId);
    expect(r.body.total_seconds).toBe(30 * 60);
    const s = await agent.post('/agent/me/timesheet/submit', { date: today() });
    expect(s.status).toBe(200);
    expect((await agent.get('/agent/me/timesheet')).body.status).toBe('SUBMITTED');
  });

  it('time off: balances for own policies, request, and only own requests listed', async () => {
    const pol = await admin.post(`/orgs/${orgId}/time-off/policies`, { name: 'Vacation', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } });
    expect(pol.status).toBe(201);
    const before = await agent.get('/agent/me/time-off');
    expect(before.status).toBe(200);
    expect(before.body.balances.map((b: { policy_name: string }) => b.policy_name)).toContain('Vacation');
    const d = new Date(t.clock.now.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
    const req = await agent.post('/agent/me/time-off', { policy_id: pol.body.id, start_date: d, end_date: d, reason: 'Family' });
    expect(req.status).toBe(201);
    await bea.post(`/orgs/${orgId}/time-off/requests`, { policy_id: pol.body.id, start_date: d, end_date: d });
    const after = await agent.get('/agent/me/time-off');
    expect(after.body.requests).toHaveLength(1);
    expect(after.body.requests[0]).toMatchObject({ membership_id: waltId, reason: 'Family', status: 'PENDING' });
  });

  it('schedule, tasks and notifications are readable', async () => {
    expect((await agent.get('/agent/me/schedule')).status).toBe(200);
    expect((await agent.get('/agent/me/tasks')).status).toBe(200);
    const n = await agent.get('/agent/me/notifications');
    expect(n.status).toBe(200);
    expect(n.body).toHaveProperty('unread');
    expect((await agent.post('/agent/me/notifications/read', { ids: 'all' })).status).toBe(204);
  });

  it('rejects oversized ranges and bad input', async () => {
    expect((await agent.get('/agent/me/summary?from=2026-01-01&to=2026-12-31')).status).toBe(400);
    expect((await agent.get('/agent/me/sessions?from=nope')).status).toBe(400);
    expect((await agent.post('/agent/me/notifications/read', { ids: ['not-a-uuid'] })).status).toBe(400);
  });

  it('is only for device tokens, and a revoked device loses access immediately', async () => {
    expect((await walt.get('/agent/me/summary')).status).toBe(401);
    const devices = await admin.get(`/orgs/${orgId}/devices`);
    const pc = devices.body.find((d: { name: string }) => d.name === 'Walt-PC');
    expect((await admin.post(`/orgs/${orgId}/devices/${pc.id}/revoke`)).status).toBe(200);
    expect((await agent.get('/agent/me/summary')).status).toBe(401);
    expect((await agent.get('/agent/me/timesheet')).status).toBe(401);
  });
});

// Rate limits are off in tests unless asked for. With them on, a device route must not wait on
// itself: on single-connection PGlite (local dev) a limiter that writes outside the request's
// tenant transaction deadlocks the whole server.
describe('rate limits on device routes', () => {
  const within = <T>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms}ms`)), ms))]);

  it('answers own-data reads and writes with rate limiting on', async () => {
    const pc = await device(walt, 'Walt-RL');
    const on = { 'x-test-rate-limit': 'on' };
    expect((await within(pc.req('GET', '/agent/me/summary', undefined, on))).status).toBe(200);
    expect((await within(pc.req('GET', '/agent/me/pay-stubs', undefined, on))).status).toBe(200);
    expect((await within(pc.req('POST', '/agent/me/notifications/read', { ids: 'all' }, on))).status).toBe(204);
    expect((await within(pc.req('POST', '/agent/heartbeat', { agent_version: '0.1.0' }, on))).status).toBeLessThan(500);
    // ...and the server still answers afterwards.
    expect((await within(admin.get(`/orgs/${orgId}`))).status).toBe(200);
  });

  it('still limits a device that sends too many requests', async () => {
    const pc = await device(walt, 'Walt-RL2');
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await within(pc.req('POST', '/agent/me/notifications/read', { ids: 'all' }, { 'x-test-rate-limit': 'on' }))).status);
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
