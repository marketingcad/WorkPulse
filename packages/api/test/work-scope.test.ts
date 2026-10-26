import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clients, Projects and Tasks audit (October 2026), group 1:
// W1 — "Manage projects" / "Manage clients" at a narrower scope than org only cover the person's
//      assigned projects and their clients (they used to cover the whole organization).
// W4 — PATCH /clients/:id changes only the fields it is sent.

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

let lead: Client;
let leadId: string;
let mine: string;
let other: string;
let myClient: string;
let otherClient: string;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@scope.test'));
  const role = await admin.post(o('/roles'), {
    name: 'Project lead',
    grants: { 'projects:read': 'assigned', 'projects:manage': 'assigned', 'clients:read': 'assigned', 'clients:manage': 'assigned' },
  });
  expect(role.status).toBe(201);
  ({ client: lead, membershipId: leadId } = await addMember(t, admin, orgId, 'Lea', 'lea@scope.test'));
  expect((await admin.patch(o(`/workers/${leadId}`), { role_id: role.body.id })).status).toBe(200);
  myClient = (await admin.post(o('/clients'), { name: 'Mine Co' })).body.id;
  otherClient = (await admin.post(o('/clients'), { name: 'Other Co', email: 'ap@other.test' })).body.id;
  mine = (await admin.post(o('/projects'), { name: 'Mine', client_id: myClient, member_ids: [leadId] })).body.id;
  other = (await admin.post(o('/projects'), { name: 'Not mine', client_id: otherClient })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('W1: narrow "manage" grants stay narrow', () => {
  it('projects: the assigned project can be managed, others cannot (before the fix: renamed 200, archived 204)', async () => {
    expect((await lead.patch(o(`/projects/${mine}`), { name: 'Mine 2' })).status).toBe(200);
    expect((await lead.patch(o(`/projects/${other}`), { name: 'Renamed' })).status).toBe(404);
    expect((await lead.post(o(`/projects/${other}/archive`))).status).toBe(404);
    // Cannot add themselves to someone else's project either.
    expect((await lead.patch(o(`/projects/${other}`), { member_ids: [leadId] })).status).toBe(404);
    const after = (await admin.get(o(`/projects/${other}`))).body;
    expect([after.name, after.archived_at, after.member_ids]).toEqual(['Not mine', null, []]);
    // Documents follow the same rule.
    const form = new FormData();
    form.append('file', new File(['%PDF-1.4 test'], 'brief.pdf', { type: 'application/pdf' }));
    const upload = await t.app.request(`/api/v1${o(`/projects/${other}/documents`)}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: lead.cookie }, body: form });
    expect(upload.status).toBe(403);
  });

  it('projects: a project can only be given a client the person can already see', async () => {
    const r = await lead.patch(o(`/projects/${mine}`), { client_id: otherClient });
    expect(r.status).toBe(404);
    expect((await admin.get(o(`/projects/${mine}`))).body.client_id).toBe(myClient);
    expect((await lead.patch(o(`/projects/${mine}`), { client_id: myClient })).status).toBe(200);
  });

  it('clients: the clients of assigned projects can be managed, others cannot', async () => {
    expect((await lead.patch(o(`/clients/${myClient}`), { name: 'Mine Co 2' })).status).toBe(200);
    expect((await lead.patch(o(`/clients/${otherClient}`), { name: 'Hijacked' })).status).toBe(404);
    expect((await lead.post(o(`/clients/${otherClient}/archive`))).status).toBe(404);
    const c = ((await admin.get(o('/clients?include_archived=true'))).body as Array<{ id: string; name: string; archived_at: string | null }>).find((x) => x.id === otherClient)!;
    expect([c.name, c.archived_at]).toEqual(['Other Co', null]);
  });

  it('org scope is unchanged: an admin manages every project and client', async () => {
    expect((await admin.patch(o(`/projects/${other}`), { name: 'Not mine (admin)' })).status).toBe(200);
    expect((await admin.post(o(`/projects/${other}/archive`))).status).toBe(204);
    expect((await admin.post(o(`/projects/${other}/restore`))).status).toBe(204);
    expect((await admin.patch(o(`/clients/${otherClient}`), { notes: 'checked' })).status).toBe(200);
  });
});

describe('W4: a partial client update keeps the fields it does not send', () => {
  it('changes only what is sent; null clears a field (before the fix: email, phone and notes were wiped)', async () => {
    const c = (await admin.post(o('/clients'), { name: 'Acme', email: 'billing@acme.test', phone: '555', notes: 'VIP', currency: 'EUR' })).body;
    const r = await admin.patch(o(`/clients/${c.id}`), { name: 'Acme Inc' });
    expect(r.status).toBe(200);
    expect([r.body.name, r.body.email, r.body.phone, r.body.notes, r.body.currency]).toEqual(['Acme Inc', 'billing@acme.test', '555', 'VIP', 'EUR']);
    const cleared = await admin.patch(o(`/clients/${c.id}`), { phone: null });
    expect([cleared.body.phone, cleared.body.email]).toEqual([null, 'billing@acme.test']);
  });

  it('a rate sent alone is in the client’s saved currency', async () => {
    const c = (await admin.post(o('/clients'), { name: 'Euro Ltd', currency: 'EUR' })).body;
    expect((await admin.patch(o(`/clients/${c.id}`), { bill_rate_minor: 9000 })).status).toBe(200);
    const rates = (await admin.get(o('/rates'))).body as Array<{ scope: string; scope_id: string | null; kind: string; currency: string; amount_minor: number }>;
    const r = rates.find((x) => x.scope === 'CLIENT' && x.scope_id === c.id && x.kind === 'BILL')!;
    expect([r.amount_minor, r.currency]).toEqual([9000, 'EUR']);
  });

  it('creating a client still needs a name', async () => {
    expect((await admin.post(o('/clients'), { email: 'x@y.test' })).status).toBe(400);
  });
});
