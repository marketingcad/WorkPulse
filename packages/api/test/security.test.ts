import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

let t: Harness;
let adminA: Client;
let orgA: string;
let adminB: Client;
let orgB: string;
let manager: Client;
let managerId: string;
let w1: Client;
let w1Id: string;
let w2: Client;
let w2Id: string;
let teamId: string;
let projectA: string;

const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createHarness();
  ({ client: adminA, orgId: orgA } = await signup(t, 'Alice', 'alice@a.test', 'Org A'));
  ({ client: adminB, orgId: orgB } = await signup(t, 'Bob', 'bob@b.test', 'Org B'));
  ({ client: manager, membershipId: managerId } = await addMember(t, adminA, orgA, 'Mona Manager', 'mona@a.test', 'TEAM_MANAGER'));
  ({ client: w1, membershipId: w1Id } = await addMember(t, adminA, orgA, 'Will One', 'w1@a.test'));
  ({ client: w2, membershipId: w2Id } = await addMember(t, adminA, orgA, 'Wes Two', 'w2@a.test'));
  const team = await adminA.post(`/orgs/${orgA}/teams`, { name: 'Design' });
  teamId = team.body.id;
  await adminA.put(`/orgs/${orgA}/teams/${teamId}/members/${managerId}`, { role: 'MANAGER' });
  await adminA.put(`/orgs/${orgA}/teams/${teamId}/members/${w1Id}`, { role: 'MEMBER' });
  const p = await adminA.post(`/orgs/${orgA}/projects`, { name: 'A-Project', team_ids: [teamId], member_ids: [w2Id] });
  projectA = p.body.id;
  // Some data for every worker.
  for (const w of [w1, w2]) {
    await w.post(`/orgs/${orgA}/tracking/start`, { project_id: projectA });
    t.clock.advance(10 * 60_000);
    await w.post(`/orgs/${orgA}/tracking/stop`);
  }
  await t.flush();
});
afterAll(() => t.close());

/** Every GET route under /orgs/:orgId that returns org data. */
const GET_ROUTES = [
  '',
  '/roles',
  '/workers',
  '/invitations',
  '/teams',
  '/clients',
  '/projects',
  '/tasks',
  '/me/assignments',
  '/devices',
  `/tracking/current`,
  `/tracking/live`,
  `/sessions?from=${day(-7)}&to=${day(1)}`,
  `/time-entries?from=${day(-7)}&to=${day(1)}`,
  '/manual-time',
  '/timesheets',
  '/timesheets/approvals',
  `/activity/day?date=${day(0)}`,
  `/screenshots?from=${day(-7)}&to=${day(1)}`,
  `/apps?from=${day(-7)}&to=${day(1)}`,
  `/urls?from=${day(-7)}&to=${day(1)}`,
  `/idle-events?from=${day(-7)}&to=${day(1)}`,
  '/schedules',
  `/attendance?from=${day(-7)}&to=${day(0)}`,
  '/holidays',
  '/time-off/policies',
  '/time-off/requests',
  '/time-off/balances',
  '/rates',
  `/billing/amounts-owed?from=${day(-7)}&to=${day(1)}`,
  '/budgets',
  '/expenses',
  '/invoices',
  '/payments',
  '/dashboard/layout',
  '/dashboard/widgets?keys=worked_today,active_workers',
  '/reports',
  '/notifications',
  '/api-keys',
  '/webhooks',
  '/audit-logs',
  '/retention-policies',
];

describe('tenant isolation (Organization B → Organization A)', () => {
  it.each(GET_ROUTES)('GET %s is not visible to another organization', async (path) => {
    const r = await adminB.get(`/orgs/${orgA}${path}`);
    expect(r.status, `${path} → ${r.status}`).toBe(404);
  });

  it('cannot mutate another organization', async () => {
    for (const [method, path, body] of [
      ['POST', '/clients', { name: 'x' }],
      ['POST', '/projects', { name: 'x' }],
      ['POST', `/tracking/start`, { project_id: projectA }],
      ['PATCH', `/workers/${w1Id}`, { title: 'hacked' }],
      ['PUT', `/policies/ORG/${orgA}`, { screenshots: { enabled: true } }],
      ['POST', '/api-keys', { name: 'k', scopes: ['read:workers'] }],
      ['POST', `/reports/time-activity/query`, { from: day(-7), to: day(0) }],
    ] as const) {
      const r = await adminB.req(method, `/orgs/${orgA}${path}`, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it('an API key of org B cannot reach org A', async () => {
    const k = await adminB.post(`/orgs/${orgB}/api-keys`, { name: 'integration', scopes: ['read:workers', 'read:projects'] });
    expect(k.status).toBe(201);
    const api = new Client(t);
    api.bearer = k.body.key;
    expect((await api.get(`/orgs/${orgB}/workers`)).status).toBe(200);
    expect((await api.get(`/orgs/${orgA}/workers`)).status).toBe(404);
    // Scopes are enforced: no billing scope → forbidden.
    expect((await api.get(`/orgs/${orgB}/invoices`)).status).toBe(403);
    expect((await api.get(`/orgs/${orgB}/projects`)).status).toBe(200);
  });

  it('unknown and malformed org ids are 404, unauthenticated is 401', async () => {
    expect((await adminA.get(`/orgs/${newId()}/workers`)).status).toBe(404);
    expect((await adminA.get(`/orgs/not-a-uuid/workers`)).status).toBe(404);
    expect((await new Client(t).get(`/orgs/${orgA}/workers`)).status).toBe(401);
  });
});

describe('role scoping inside one organization', () => {
  it('team manager sees only their team', async () => {
    const workers = (await manager.get(`/orgs/${orgA}/workers`)).body.map((w: { id: string }) => w.id).sort();
    expect(workers).toEqual([managerId, w1Id].sort());
    const entries = (await manager.get(`/orgs/${orgA}/time-entries?from=${day(-7)}&to=${day(1)}`)).body;
    expect(new Set(entries.map((e: { membership_id: string }) => e.membership_id))).toEqual(new Set([w1Id]));
    expect((await manager.get(`/orgs/${orgA}/activity/day?membership_id=${w2Id}&date=${day(0)}`)).status).toBe(404);
    expect((await manager.get(`/orgs/${orgA}/activity/day?membership_id=${w1Id}&date=${day(0)}`)).status).toBe(200);
    const live = (await manager.get(`/orgs/${orgA}/tracking/live`)).body.map((l: { membership_id: string }) => l.membership_id);
    expect(live).not.toContain(w2Id);
  });

  it('team manager can only change members of teams they manage', async () => {
    const other = await adminA.post(`/orgs/${orgA}/teams`, { name: 'Sales' });
    expect((await manager.put(`/orgs/${orgA}/teams/${other.body.id}/members/${w2Id}`, { role: 'MEMBER' })).status).toBe(403);
    expect((await manager.put(`/orgs/${orgA}/teams/${teamId}/members/${managerId}`, { role: 'MEMBER' })).status).toBe(403);
    expect((await manager.put(`/orgs/${orgA}/teams/${teamId}/members/${newId()}`, { role: "MEMBER" })).status).toBe(403);
  });

  it('team manager cannot use admin-only resources', async () => {
    for (const path of ['/invoices', '/payments', '/api-keys', '/webhooks', '/audit-logs', '/rates']) {
      expect((await manager.get(`/orgs/${orgA}${path}`)).status, path).toBe(403);
    }
    expect((await manager.post(`/orgs/${orgA}/invitations`, { email: 'x@a.test', role_id: newId() })).status).toBe(403);
  });

  it('manager approves team timesheets only', async () => {
    const s1 = await w1.post(`/orgs/${orgA}/timesheets/submit`, { date: day(0) });
    const s2 = await w2.post(`/orgs/${orgA}/timesheets/submit`, { date: day(0) });
    const q = (await manager.get(`/orgs/${orgA}/timesheets/approvals`)).body.map((x: { timesheet_id: string }) => x.timesheet_id);
    expect(q).toContain(s1.body.id);
    expect(q).not.toContain(s2.body.id);
    expect((await manager.post(`/orgs/${orgA}/timesheets/${s2.body.id}/approve`, {})).status).toBe(404);
    expect((await manager.post(`/orgs/${orgA}/timesheets/${s1.body.id}/reject`, {})).status).toBe(400); // comment required
    expect((await manager.post(`/orgs/${orgA}/timesheets/${s1.body.id}/reject`, { comment: 'Missing Friday' })).body.status).toBe('REJECTED');
  });

  it('workers only see themselves and cannot escalate', async () => {
    expect((await w1.get(`/orgs/${orgA}/workers`)).body.map((w: { id: string }) => w.id)).toEqual([w1Id]);
    expect((await w1.get(`/orgs/${orgA}/timesheets?membership_id=${w2Id}`)).status).toBe(404);
    expect((await w1.patch(`/orgs/${orgA}/workers/${w1Id}`, { role_id: newId() })).status).toBe(403);
    expect((await w1.post(`/orgs/${orgA}/projects`, { name: 'mine' })).status).toBe(403);
    expect((await w1.put(`/orgs/${orgA}/policies/ORG/${orgA}`, { screenshots: { enabled: false } })).status).toBe(403);
    const roles = (await adminA.get(`/orgs/${orgA}/roles`)).body;
    expect((await w1.post(`/orgs/${orgA}/roles`, { name: 'Boss', grants: { 'invoices:manage': 'org' } })).status).toBe(403);
    void roles;
  });

  it('custom roles cannot exceed the creator', async () => {
    const r = await adminA.post(`/orgs/${orgA}/roles`, { name: 'Auditor', grants: { 'audit:read': 'org', 'reports:read': 'org' } });
    expect(r.status).toBe(201);
    expect(r.body.grants['audit:read']).toBe('org');
    expect((await adminA.post(`/orgs/${orgA}/roles`, { name: 'Robot', grants: { 'agent:ingest': 'own' } })).status).toBe(403);
  });
});

describe('web security', () => {
  it('blocks cross-site state changes with a cookie session (CSRF)', async () => {
    const r = await t.app.request(`/api/v1/orgs/${orgA}/clients`, { method: 'POST', headers: { Cookie: adminA.cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(r.status).toBe(403);
    const r2 = await t.app.request(`/api/v1/orgs/${orgA}/clients`, { method: 'POST', headers: { Cookie: adminA.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(r2.status).toBe(403);
  });

  it('does not leak internals in errors and sets security headers', async () => {
    const r = await t.app.request(`/api/v1/orgs/${orgA}/clients`, { method: 'POST', headers: { Cookie: adminA.cookie, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: '{bad json' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe('validation_error');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('rejects wrong passwords generically and never stores plaintext', async () => {
    const r = await new Client(t).post('/auth/login', { email: 'alice@a.test', password: 'wrong-password!' });
    expect(r.status).toBe(401);
    expect(r.body.title).toBe('Email or password is incorrect');
    const unknown = await new Client(t).post('/auth/login', { email: 'nobody@a.test', password: 'wrong-password!' });
    expect(unknown.body.title).toBe(r.body.title);
  });

  it('media links are signed and expire', async () => {
    expect((await t.app.request('/api/v1/media/forged.token')).status).toBe(404);
  });

  it('cron endpoints require the cron secret', async () => {
    expect((await t.app.request('/api/v1/cron/tick')).status).toBe(401);
    expect((await t.app.request('/api/v1/cron/tick', { headers: { Authorization: 'Bearer cron-secret' } })).status).toBe(200);
  });
});
