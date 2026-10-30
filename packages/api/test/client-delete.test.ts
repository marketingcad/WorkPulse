import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Deleting a client (30 October 2026): only a client that was never used can be deleted, and its
// unused projects, tasks, members, rates, budgets and portal access go with it. A client with
// invoices, payments, expenses or tracked time is refused, so past invoices, pay and reports never
// change; it can still be archived.

let t: Harness;
let admin: Client;
let worker: Client;
let orgId: string;
let adminMid: string;
let workerMid: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
let n = 0;
const newClient = async () => (await admin.post(o('/clients'), { name: `Client ${++n}` })).body.id as string;
/** Whether the client is still there, archived or not (there is no single-client endpoint). */
const exists = async (c: Client, org: string, id: string) => (await c.get<Array<{ id: string }>>(`/orgs/${org}/clients?include_archived=true`)).body.some((x) => x.id === id);
const newProject = async (clientId: string) => (await admin.post(o('/projects'), { name: `Project ${++n}`, client_id: clientId, member_ids: [adminMid, workerMid] })).body.id as string;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-02T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Dana', 'dana@delete.test'));
  adminMid = (await admin.get<Array<{ id: string }>>(o('/workers'))).body[0]!.id;
  ({ client: worker, membershipId: workerMid } = await addMember(t, admin, orgId, 'Wes', 'wes@delete.test'));
});
afterAll(async () => t.close());

describe('deleting a client', () => {
  it('deletes an unused client with everything set up for it', async () => {
    const clientId = await newClient();
    const projectId = await newProject(clientId);
    expect((await admin.post(o(`/projects/${projectId}/tasks`), { title: 'Design', assignee_ids: [workerMid] })).status).toBe(201);
    for (const rate of [
      { scope: 'CLIENT', scope_id: clientId },
      { scope: 'PROJECT', scope_id: projectId },
      { scope: 'PROJECT_WORKER', scope_id: `${projectId}:${workerMid}` },
    ])
      expect((await admin.post(o('/rates'), { kind: 'BILL', amount_minor: 10000, currency: 'USD', effective_from: '2026-01-01', ...rate })).status, rate.scope).toBe(201);
    expect((await admin.put(o('/budgets'), { subject_type: 'CLIENT', subject_id: clientId, kind: 'HOURS', amount: 36000 })).status).toBe(200);
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: projectId, kind: 'HOURS', amount: 3600 })).status).toBe(200);
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(200);
    expect((await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'viewer@client.test' })).status).toBe(201);

    expect((await admin.del(o(`/clients/${clientId}`))).status).toBe(204);

    expect(await exists(admin, orgId, clientId)).toBe(false);
    const projects = (await admin.get<Array<{ id: string }>>(o('/projects?include_archived=true'))).body;
    expect(projects.map((p) => p.id)).not.toContain(projectId);
    const rates = (await admin.get<Array<{ scope_id: string | null }>>(o('/rates'))).body;
    expect(rates.filter((r) => r.scope_id === clientId || r.scope_id?.startsWith(projectId))).toEqual([]);
    const budgets = (await admin.get<Array<{ subject_id: string }>>(o('/budgets'))).body;
    expect(budgets.filter((b) => b.subject_id === clientId || b.subject_id === projectId)).toEqual([]);
    // The worker's assignments no longer offer the deleted project.
    const mine = (await worker.get<Array<{ project_id: string }>>(o('/me/assignments'))).body;
    expect(mine.map((a) => a.project_id)).not.toContain(projectId);
    // The deletion is in the audit log, with the client's name.
    const log = (await admin.get<{ data: Array<{ action: string; target_id: string }> } | Array<{ action: string; target_id: string }>>(o('/audit-logs'))).body;
    const entries = Array.isArray(log) ? log : log.data;
    expect(entries.find((e) => e.action === 'client.deleted' && e.target_id === clientId)).toBeTruthy();
  });

  it('deletes an archived unused client too', async () => {
    const clientId = await newClient();
    await newProject(clientId);
    expect((await admin.post(o(`/clients/${clientId}/archive`))).status).toBe(204);
    expect((await admin.del(o(`/clients/${clientId}`))).status).toBe(204);
    expect(await exists(admin, orgId, clientId)).toBe(false);
  });

  it('refuses a client with tracked time, and keeps it and its project', async () => {
    const clientId = await newClient();
    const projectId = await newProject(clientId);
    const time = await admin.post(o('/manual-time'), { membership_id: workerMid, project_id: projectId, started_at: '2026-10-20T09:00:00Z', ended_at: '2026-10-20T10:00:00Z', reason: 'fixture' });
    expect(time.status, JSON.stringify(time.body)).toBe(201);
    const r = await admin.del(o(`/clients/${clientId}`));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'client_in_use', title: `Client ${n - 1} has tracked time, so it can't be deleted. Archive it instead: it disappears from lists and its history stays.` });
    expect(await exists(admin, orgId, clientId)).toBe(true);
    expect((await admin.get(o(`/projects/${projectId}`))).status).toBe(200);
  });

  it('refuses a client with an invoice, a payment or an expense', async () => {
    const invoiced = await newClient();
    const inv = await admin.post(o('/invoices'), { client_id: invoiced, period_start: '2026-10-01', period_end: '2026-10-31', issue_date: '2026-10-31', due_date: '2026-11-30', extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 5000 }] });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect((await admin.del(o(`/clients/${invoiced}`))).body).toMatchObject({ code: 'client_in_use', title: expect.stringContaining('has invoices') });

    const paid = await newClient();
    expect((await admin.post(o('/payments'), { client_id: paid, amount_minor: 100, currency: 'USD', received_on: '2026-10-01' })).status).toBe(201);
    expect((await admin.del(o(`/clients/${paid}`))).body.title).toContain('has payments');

    const spent = await newClient();
    expect((await admin.post(o('/expenses'), { client_id: spent, category: 'Travel', amount_minor: 1200, currency: 'USD', spent_on: '2026-10-01' })).status).toBe(201);
    expect((await admin.del(o(`/clients/${spent}`))).body.title).toContain('has expenses');

    for (const id of [invoiced, paid, spent]) expect(await exists(admin, orgId, id)).toBe(true);
  });

  it('only those who manage clients can delete, and only in their own organization', async () => {
    const clientId = await newClient();
    expect((await worker.del(o(`/clients/${clientId}`))).status).toBe(403);
    expect(await exists(admin, orgId, clientId)).toBe(true);
    expect((await admin.del(o('/clients/11111111-1111-4111-8111-111111111111'))).status).toBe(404);
    // Another organization's client is not found from here.
    const { client: other, orgId: otherOrg } = await signup(t, 'Olga', 'olga@delete.test');
    const theirs = (await other.post(`/orgs/${otherOrg}/clients`, { name: 'Theirs' })).body.id;
    expect([403, 404]).toContain((await admin.del(`/orgs/${otherOrg}/clients/${theirs}`)).status);
    expect(await exists(other, otherOrg, theirs)).toBe(true);
  });
});
