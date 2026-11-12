import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * QA audit 11 Nov 2026, Phase 6: who a submission notification names (BUG-12), why a new invoice finds
 * nothing (BUG-13), the period it starts on (C-10), and re-inviting a pending address (C-8).
 * Clock: Wednesday 2026-09-23 (America/New_York). Weekly timesheets start on Monday.
 */
const NOW = new Date('2026-09-23T20:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let clientId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function addTime(start: string, seconds: number) {
  const s = new Date(start);
  const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}
const submittedTitles = async () => ((await admin.get(o('/notifications'))).body.data as Array<{ type: string; title: string }>).filter((n) => n.type === 'timesheet.submitted').map((n) => n.title);
const invoiceInput = (from: string, to: string) => ({ client_id: clientId, period_start: from, period_end: to, issue_date: '2026-09-23', due_date: '2026-10-07', tax_rate_bps: 0 });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p6.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@p6.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
});
afterAll(() => t.close());

describe('BUG-12: the submitted notification names who submitted', () => {
  it('a worker submitting their own timesheet is named as before', async () => {
    await addTime('2026-09-01T13:00:00Z', 3600);
    expect((await worker.post(o('/timesheets/submit'), { date: '2026-09-01' })).status).toBe(200);
    await t.flush();
    expect(await submittedTitles()).toContain('Walt submitted a timesheet');
  });

  it('an admin submitting for the worker is named, with the worker', async () => {
    await addTime('2026-09-08T13:00:00Z', 3600);
    expect((await admin.post(o('/timesheets/submit'), { membership_id: workerId, date: '2026-09-08' })).status).toBe(200);
    await t.flush();
    const titles = await submittedTitles();
    expect(titles).toContain("Ada submitted Walt's timesheet");
    // The regression: it said the worker submitted it.
    expect(titles.filter((x) => x === 'Walt submitted a timesheet')).toHaveLength(1);
  });
});

describe('BUG-13 and C-10: what a new invoice finds, and when', () => {
  let invoice: { id: string; number: string };

  it('the unbilled range spans the approved time not yet invoiced', async () => {
    for (const d of ['2026-09-01', '2026-09-08']) {
      const ts = (await admin.get(o(`/timesheets?membership_id=${workerId}&date=${d}`))).body;
      expect((await admin.post(o(`/timesheets/${ts.id}/approve`), {})).status).toBe(200);
    }
    await t.flush();
    expect((await admin.get(o(`/invoices/unbilled?client_id=${clientId}`))).body).toEqual({ from: '2026-09-01', to: '2026-09-08' });
  });

  it('a preview with time to invoice lists no other invoices', async () => {
    const p = (await admin.post(o('/invoices/preview'), invoiceInput('2026-09-01', '2026-09-30'))).body;
    expect(p.lines.length).toBeGreaterThan(0);
    expect(p.already_invoiced).toEqual([]);
  });

  it('a second invoice for an invoiced period names the invoice that holds the time', async () => {
    const r = await admin.post(o('/invoices'), invoiceInput('2026-09-01', '2026-09-30'));
    expect(r.status).toBe(201);
    invoice = { id: r.body.id, number: r.body.number };
    const p = (await admin.post(o('/invoices/preview'), invoiceInput('2026-09-01', '2026-09-30'))).body;
    expect(p.lines).toEqual([]);
    expect(p.already_invoiced).toEqual([invoice]);
    // A period with no time at all names nothing.
    expect((await admin.post(o('/invoices/preview'), invoiceInput('2026-08-01', '2026-08-31'))).body.already_invoiced).toEqual([]);
    // And nothing is left unbilled.
    expect((await admin.get(o(`/invoices/unbilled?client_id=${clientId}`))).body).toEqual({ from: null, to: null });
  });

  it('removing the invoice releases its time again', async () => {
    expect((await admin.del(o(`/invoices/${invoice.id}`))).status).toBeLessThan(300);
    const p = (await admin.post(o('/invoices/preview'), invoiceInput('2026-09-01', '2026-09-30'))).body;
    expect(p.lines.length).toBeGreaterThan(0);
    expect(p.already_invoiced).toEqual([]);
    expect((await admin.get(o(`/invoices/unbilled?client_id=${clientId}`))).body).toEqual({ from: '2026-09-01', to: '2026-09-08' });
  });

  it('the unbilled range is only for people who manage invoices, and only for this organization’s clients', async () => {
    expect((await worker.get(o(`/invoices/unbilled?client_id=${clientId}`))).status).toBe(403);
    expect((await admin.get(o('/invoices/unbilled?client_id=00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await admin.get(o('/invoices/unbilled?client_id=nope'))).status).toBe(400);
    const { client: other, orgId: otherOrg } = await signup(t, 'Olga', 'olga@p6.test');
    expect((await other.get(`/orgs/${otherOrg}/invoices/unbilled?client_id=${clientId}`)).status).toBe(404);
  });
});

describe('C-8: re-inviting a pending address says it replaces the earlier invitation', () => {
  it('the first invitation replaces nothing; the second replaces the first, whose link stops working', async () => {
    const roles = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
    const role_id = roles.find((r) => r.key === 'WORKER')!.id;
    const first = await admin.post(o('/invitations'), { email: 'Pat@p6.test', name: 'Pat', role_id });
    expect([first.status, first.body.replaced_pending]).toEqual([201, false]);
    const second = await admin.post(o('/invitations'), { email: 'pat@p6.test', name: 'Pat', role_id });
    expect([second.status, second.body.replaced_pending]).toEqual([201, true]);
    const token = (r: typeof first) => new URL(r.body.invite_url).searchParams.get('token');
    const accept = (r: typeof first) => new Client(t).post('/auth/invitations/accept', { token: token(r), name: 'Pat', password: 'correct-horse-battery' });
    const refused = await accept(first);
    expect([refused.status, refused.body.code]).toEqual([422, 'invalid_invitation']);
    expect((await accept(second)).status).toBe(200);
  });

  it('an expired invitation is past use already, so it does not count as replaced', async () => {
    const roles = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
    const role_id = roles.find((r) => r.key === 'WORKER')!.id;
    expect((await admin.post(o('/invitations'), { email: 'quin@p6.test', role_id })).status).toBe(201);
    // Expiry is wall-clock time, not the test clock: age the invitation in the database.
    await t.h.db.execute(sql`reset role`);
    try {
      await t.h.db.execute(sql`update invitations set expires_at = now() - interval '1 day' where email = 'quin@p6.test'`);
    } finally {
      await t.h.db.execute(sql`set role tallywork_app`);
    }
    const again = await admin.post(o('/invitations'), { email: 'quin@p6.test', role_id });
    expect([again.status, again.body.replaced_pending]).toEqual([201, false]);
  });
});
