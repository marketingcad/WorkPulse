import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/** Desktop sign-in with email + password (POST /agent/login) and who is tracked by default. */
let t: Harness;
let admin: Client;
let orgId: string;
const PASSWORD = 'correct-horse-battery';
const DEVICE = { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0' };

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@login.test'));
  await addMember(t, admin, orgId, 'Walt Worker', 'walt@login.test');
  await addMember(t, admin, orgId, 'Mia Manager', 'mia@login.test', 'TEAM_MANAGER');
});
afterAll(() => t.close());

describe('desktop email + password sign-in', () => {
  it('registers the device and returns working device tokens', async () => {
    const c = new Client(t);
    const r = await c.post<{ device_id: string; organization_id: string; access_token: string; refresh_token: string }>('/agent/login', { email: 'walt@login.test', password: PASSWORD, device: DEVICE });
    expect(r.status).toBe(201);
    expect(r.body.organization_id).toBe(orgId);
    c.bearer = r.body.access_token;
    expect((await c.get('/agent/bootstrap')).status).toBe(200);
    expect((await new Client(t).post('/agent/token', { refresh_token: r.body.refresh_token })).status).toBe(200);
  });

  it('rejects a wrong password like the web sign-in does', async () => {
    const r = await new Client(t).post<{ code: string }>('/agent/login', { email: 'walt@login.test', password: 'wrong-password-1', device: DEVICE });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('invalid_credentials');
    expect((await new Client(t).post('/agent/login', { email: 'nobody@login.test', password: PASSWORD, device: DEVICE })).status).toBe(401);
  });

  it('asks which organization when the person belongs to several', async () => {
    const { client: other, orgId: otherOrg } = await signup(t, 'Oz', 'oz@login.test');
    // Walt already has an account, so he accepts the second invitation while signed in.
    const roles = await other.get<Array<{ id: string; key: string }>>(`/orgs/${otherOrg}/roles`);
    const inv = await other.post(`/orgs/${otherOrg}/invitations`, { email: 'walt@login.test', role_id: roles.body.find((x) => x.key === 'WORKER')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    const walt = new Client(t);
    await walt.post('/auth/login', { email: 'walt@login.test', password: PASSWORD });
    expect((await walt.post('/auth/invitations/accept', { token })).status).toBe(200);

    const pick = await new Client(t).post<{ organization_required: boolean; organizations: Array<{ id: string }> }>('/agent/login', { email: 'walt@login.test', password: PASSWORD, device: DEVICE });
    expect(pick.status).toBe(200);
    expect(pick.body.organization_required).toBe(true);
    expect(pick.body.organizations.map((o) => o.id).sort()).toEqual([orgId, otherOrg].sort());

    const r = await new Client(t).post<{ organization_id: string }>('/agent/login', { email: 'walt@login.test', password: PASSWORD, organization_id: otherOrg, device: DEVICE });
    expect(r.status).toBe(201);
    expect(r.body.organization_id).toBe(otherOrg);
  });
});

describe('who is tracked by default', () => {
  it('tracks invited Workers, but not the owner or managers', async () => {
    const w = await admin.get<Array<{ email: string; role_key: string; tracking_enabled: boolean }>>(`/orgs/${orgId}/workers`);
    const rows = Array.isArray(w.body) ? w.body : (w.body as unknown as { data: typeof w.body }).data;
    const tracked = Object.fromEntries(rows.map((r) => [r.email, r.tracking_enabled]));
    expect(tracked).toEqual({ 'ada@login.test': false, 'walt@login.test': true, 'mia@login.test': false });

    const live = await admin.get<Array<{ name: string }>>(`/orgs/${orgId}/tracking/live`);
    const people = (Array.isArray(live.body) ? live.body : (live.body as unknown as { data: typeof live.body }).data).map((p) => p.name);
    expect(people).toEqual(['Walt Worker']);
  });

  it('tells the invite page the accepted role', async () => {
    const roles = await admin.get<Array<{ id: string; key: string }>>(`/orgs/${orgId}/roles`);
    const inv = await admin.post(`/orgs/${orgId}/invitations`, { email: 'wren@login.test', role_id: roles.body.find((x) => x.key === 'WORKER')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    const acc = await new Client(t).post<{ role_key: string }>('/auth/invitations/accept', { token, name: 'Wren', password: PASSWORD });
    expect(acc.body.role_key).toBe('WORKER');
  });
});
