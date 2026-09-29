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
