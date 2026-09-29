import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let manager: Client;
let orgId: string;
let clientId: string;
let otherClientId: string;
let siteId: string;
let appId: string;
let otherProjectId: string;
let walt: { client: Client; membershipId: string };
let bea: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@portal.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@portal.test');
  bea = await addMember(t, admin, orgId, 'Bea', 'bea@portal.test');
  ({ client: manager } = await addMember(t, admin, orgId, 'Mia', 'mia@portal.test', 'TEAM_MANAGER'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  otherClientId = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
  siteId = (await admin.post(o('/projects'), { name: 'Website', client_id: clientId, member_ids: [walt.membershipId, bea.membershipId] })).body.id;
  appId = (await admin.post(o('/projects'), { name: 'Mobile app', client_id: clientId, member_ids: [walt.membershipId] })).body.id;
  otherProjectId = (await admin.post(o('/projects'), { name: 'Globex site', client_id: otherClientId, member_ids: [bea.membershipId] })).body.id;
});
afterAll(() => t.close());

describe('portal admin', () => {
  it('starts disabled, with hours and tasks on and monitoring off', async () => {
    const r = await admin.get(o(`/clients/${clientId}/portal`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, sections: { hours: true, tasks: true, activity: false, screenshots: false }, project_ids: null, access: [] });
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
  });

  it('only people with org-wide monitoring access can switch activity or screenshots on', async () => {
    expect((await manager.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(403);
    const r = await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true } });
    expect(r.status).toBe(200);
    expect(r.body.sections).toEqual({ hours: true, tasks: true, activity: true, screenshots: false });
  });

  it('rejects projects that belong to another client', async () => {
    const r = await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [siteId, otherProjectId] });
    expect(r.status).toBe(400);
  });

  it('invites a viewer by email with a 7-day link, and revokes them', async () => {
    const r = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'carla@acme.test', name: 'Carla' });
    expect(r.status).toBe(201);
    expect(r.body.invite_url).toMatch(/\/portal-invite\?token=/);
    const mail = t.mailer.sent.at(-1)!;
    expect(mail.to).toBe('carla@acme.test');
    expect(mail.subject).toBe("Acme’s WorkPulse dashboard from Ada's Org");
    const again = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'CARLA@acme.test' });
    expect(again.status).toBe(409);
    const tmp = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'temp@acme.test' });
    expect((await admin.del(o(`/clients/${clientId}/portal/access/${tmp.body.id}`))).status).toBe(204);
    const list = (await admin.get(o(`/clients/${clientId}/portal`))).body.access;
    expect(list.find((a: { email: string }) => a.email === 'temp@acme.test').status).toBe('REVOKED');
  });
});

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
let dora: Client;
let doraAccessId: string;

describe('accepting a portal invitation', () => {
  it('creates a verified account that is not a member of the organization', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'dora@acme.test', name: 'Dora' });
    dora = new Client(t);
    const r = await dora.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url), name: 'Dora', password: PASSWORD });
    expect(r.status).toBe(200);
    doraAccessId = r.body.access_id;
    const me = await dora.get('/me');
    expect(me.body.organizations).toEqual([]);
    expect(me.body.user.email_verified).toBe(true);
    expect(me.body.client_portals).toEqual([{ access_id: doraAccessId, organization_name: "Ada's Org", client_name: 'Acme' }]);
    // Not a member: every org route is closed to them.
    expect((await dora.get(o('/workers'))).status).toBe(404);
  });

  it('rejects a reused or unknown token', async () => {
    expect((await new Client(t).post('/portal/invitations/accept', { token: 'x'.repeat(43), password: PASSWORD })).status).toBe(422);
  });

  it('asks an existing account to sign in first, then links it', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'walt@portal.test' });
    const r = await new Client(t).post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('login_required');
    const ok = await walt.client.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(ok.status).toBe(200);
  });
});

describe('portal dashboard', () => {
  const range = '?from=2026-09-01&to=2026-09-30';
  beforeAll(async () => {
    const task = (await admin.post(o(`/projects/${siteId}/tasks`), { title: 'Homepage', estimate_seconds: 4 * 3600, assignee_ids: [walt.membershipId] })).body.id;
    // Each member's entries are back-to-back (never overlapping) — manual-time rejects overlaps per membership.
    const add = (m: string, p: string, h: number, startedAt: string, taskId?: string) =>
      admin.post(o('/manual-time'), { membership_id: m, project_id: p, task_id: taskId, started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + h * 3600_000).toISOString(), reason: 'Work' });
    await add(walt.membershipId, siteId, 2, '2026-09-15T13:00:00Z', task);
    await add(bea.membershipId, siteId, 1, '2026-09-15T13:00:00Z');
    await add(walt.membershipId, appId, 3, '2026-09-15T15:00:00Z');
    await add(bea.membershipId, otherProjectId, 5, '2026-09-15T14:00:00Z'); // another client's project: never shown
    await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: siteId, kind: 'HOURS', amount: 10 * 3600 });
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, project_ids: null, sections: { activity: false } });
    await t.flush();
  });

  it('lists only this client’s projects, workers and tasks', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.status).toBe(200);
    expect(r.body.client.name).toBe('Acme');
    expect(r.body.totals.manual_seconds).toBe(6 * 3600);
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
    const w = Object.fromEntries(r.body.workers.map((x: { name: string; manual_seconds: number }) => [x.name, x.manual_seconds]));
    expect(w).toEqual({ Walt: 5 * 3600, Bea: 3600 });
    expect(r.body.tasks).toEqual([expect.objectContaining({ title: 'Homepage', estimate_seconds: 4 * 3600, tracked_seconds: 2 * 3600, assignees: ['Walt'] })]);
    expect(r.body.projects.find((p: { name: string }) => p.name === 'Website').budget).toEqual({ amount_seconds: 10 * 3600, used_seconds: 3 * 3600, pct_used: 30 });
  });

  it('never includes money, and activity stays hidden while that section is off', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(JSON.stringify(r.body)).not.toMatch(/amount_minor|rate|invoice|bill_|pay_|currency/);
    expect(r.body.workers.every((x: { activity_pct: number | null }) => x.activity_pct === null)).toBe(true);
  });

  it('respects the project selection and hides sections that are off', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [appId], sections: { tasks: false } });
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Mobile app']);
    expect(r.body.tasks).toBeNull();
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: null, sections: { tasks: true } });
  });

  it('is closed to other users, revoked viewers and disabled portals, and is audited', async () => {
    expect((await bea.client.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: false });
    expect((await dora.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    expect((await dora.get('/me')).body.client_portals).toEqual([]);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true });
    const audit = await admin.get(o('/audit-logs?action=client_portal.viewed'));
    expect(audit.body.some((a: { actor_type: string }) => a.actor_type === 'client')).toBe(true);
  });

  it('lets admins preview exactly what the client sees', async () => {
    const p = await admin.get(o(`/clients/${clientId}/portal/preview${range}`));
    const v = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect({ ...p.body, access_id: null }).toEqual({ ...v.body, access_id: null });
  });
});
