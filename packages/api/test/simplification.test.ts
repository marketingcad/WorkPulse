import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Audit P1: invite with projects + team role, editable/deletable drafts, payment removal,
// budget money hidden without billing access, report catalogue filters.
// Clock: Wednesday 2026-09-23 (America/New_York).
const NOW = new Date('2026-09-23T20:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let clientId: string;
let projectId: string;
let teamId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function accept(inviteUrl: string, name: string) {
  const token = new URL(inviteUrl).searchParams.get('token')!;
  const c = new Client(t);
  const r = await c.post('/auth/invitations/accept', { token, name, password: 'correct-horse-battery' });
  expect(r.status).toBe(200);
  return { client: c, membershipId: (r.body as { membership_id: string }).membership_id };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@simple.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@simple.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
  teamId = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
});
afterAll(() => t.close());

describe('invitations', () => {
  it('adds the invitee to the chosen projects and manages the chosen teams', async () => {
    const roles = (await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>;
    const manager = roles.find((r) => r.key === 'TEAM_MANAGER')!;
    const inv = await admin.post(o('/invitations'), { email: 'mia@simple.test', name: 'Mia', role_id: manager.id, team_ids: [teamId], team_role: 'MANAGER', project_ids: [projectId] });
    expect(inv.status).toBe(201);
    // The test mailer keeps messages locally, so the admin is told to share the link.
    expect(inv.body.email_sent).toBe(false);
    const { membershipId } = await accept(inv.body.invite_url, 'Mia');

    const team = ((await admin.get(o('/teams'))).body as Array<{ id: string; members: Array<{ membership_id: string; role: string }> }>).find((x) => x.id === teamId)!;
    expect(team.members.find((m) => m.membership_id === membershipId)?.role).toBe('MANAGER');
    const assignments = (await admin.get(o(`/workers/${membershipId}/assignments`))).body as { projects: Array<{ id: string }> } | Array<{ project_id?: string; id?: string }>;
    expect(JSON.stringify(assignments)).toContain(projectId);
  });

  it('rejects projects from outside the workspace', async () => {
    const roles = (await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>;
    const r = await admin.post(o('/invitations'), { email: 'x@simple.test', role_id: roles.find((x) => x.key === 'WORKER')!.id, project_ids: ['00000000-0000-7000-8000-000000000001'] });
    expect(r.status).toBe(400);
  });
});

describe('invoices and payments', () => {
  let invoiceId: string;

  it('edits the dates and notes of a draft, then deletes it', async () => {
    const s = new Date('2026-09-21T13:00:00Z');
    expect((await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 2 * 3600_000).toISOString(), reason: 'fixture' })).status).toBe(201);
    const ts = await worker.post(o('/timesheets/submit'), { date: '2026-09-21' });
    expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
    await t.flush();
    const input = { client_id: clientId, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-07' };
    const draft = await admin.post(o('/invoices'), input);
    expect(draft.status).toBe(201);

    const bad = await admin.patch(o(`/invoices/${draft.body.id}`), { due_date: '2026-09-01' });
    expect(bad.status).toBe(400);
    const ok = await admin.patch(o(`/invoices/${draft.body.id}`), { due_date: '2026-10-21', notes: 'Net 28' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ due_date: '2026-10-21', notes: 'Net 28' });

    expect((await admin.del(o(`/invoices/${draft.body.id}`))).status).toBe(204);
    // Its time is invoiceable again.
    const again = await admin.post(o('/invoices'), input);
    expect(again.status).toBe(201);
    invoiceId = again.body.id;
  });

  it('refuses to edit a sent invoice', async () => {
    expect((await admin.post(o(`/invoices/${invoiceId}/send`), {})).status).toBe(200);
    expect((await admin.patch(o(`/invoices/${invoiceId}`), { notes: 'late' })).status).toBe(422);
  });

  it('removing a payment restores the balance so the invoice can be voided', async () => {
    const inv = (await admin.get(o(`/invoices/${invoiceId}`))).body;
    const pay = await admin.post(o('/payments'), { client_id: clientId, provider: 'BANK_TRANSFER', amount_minor: 5000, currency: 'USD', received_on: '2026-09-23', allocations: [{ invoice_id: invoiceId, amount_minor: 5000 }] });
    expect(pay.status).toBe(201);
    expect((await admin.post(o(`/invoices/${invoiceId}/void`), {})).status).toBe(422);
    expect((await admin.del(o(`/payments/${pay.body.id}`))).status).toBe(204);
    expect((await admin.get(o(`/invoices/${invoiceId}`))).body.balance_minor).toBe(inv.total_minor);
    expect((await admin.post(o(`/invoices/${invoiceId}/void`), {})).status).toBe(200);
  });
});

describe('budgets and reports', () => {
  it('hides money budget amounts from people without billing access', async () => {
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: projectId, kind: 'MONEY', amount: 100000, period: 'TOTAL', warn_pct: 80, include_non_billable: false })).status).toBe(200);
    const role = await admin.post(o('/roles'), { name: 'Budget viewer', grants: { 'budgets:read': 'org', 'reports:read': 'org', 'reports:finance': 'org' } });
    const roleId = (role.body as { id: string }).id;
    const inv = await admin.post(o('/invitations'), { email: 'bea@simple.test', role_id: roleId });
    const { client: bea } = await accept(inv.body.invite_url, 'Bea');

    const seen = ((await bea.get(o('/budgets'))).body as Array<{ subject_id: string; amount: number; spent: number; pct_used: number; amounts_hidden?: boolean }>).find((b) => b.subject_id === projectId)!;
    expect(seen).toMatchObject({ amount: 0, spent: 0, amounts_hidden: true });
    expect(seen.pct_used).toBeGreaterThan(0);
    const full = ((await admin.get(o('/budgets'))).body as Array<{ subject_id: string; amount: number; amounts_hidden?: boolean }>).find((b) => b.subject_id === projectId)!;
    expect(full.amount).toBe(100000);
    expect(full.amounts_hidden).toBeUndefined();
  });

  it('describes each report’s filters and hides the ones another report covers', async () => {
    const catalog = (await admin.get(o('/reports'))).body as Array<{ key: string; filters: string[]; hidden: boolean }>;
    const byKey = new Map(catalog.map((r) => [r.key, r]));
    expect(byKey.get('time-activity')!.filters).toEqual(['dates', 'members', 'teams', 'projects', 'clients', 'billable']);
    expect(byKey.get('invoices')!.filters).toEqual(['dates']);
    expect(byKey.get('budgets')).toMatchObject({ filters: [], hidden: true });
    // Covered by another report, or exported from their own page (Payroll › Owed, Invoices, Payments received, Expenses, Budgets).
    for (const k of ['daily-totals', 'work-breaks', 'project-budgets', 'client-budgets', 'audit-log', 'amounts-owed', 'invoices', 'payments', 'expenses', 'budgets']) expect(byKey.get(k)?.hidden).toBe(true);
    // Hidden reports still run (saved and scheduled reports keep working).
    expect((await admin.post(o('/reports/daily-totals/query'), { from: '2026-09-01', to: '2026-09-30' })).status).toBe(200);
    const budgets = await admin.post(o('/reports/budgets/query'), { from: '2026-09-01', to: '2026-09-30' });
    expect(budgets.status).toBe(200);
    expect(budgets.body.rows.length).toBeGreaterThanOrEqual(1);
  });
});
