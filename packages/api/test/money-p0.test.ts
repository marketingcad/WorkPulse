import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Money audit (October 2026), P0 fixes:
// M1 — a paid holiday inside approved time off is paid once.
// M3 — "Amounts owed" reads pay in the pay rate's currency (not the bill currency of the time).
// M4/M11 — voiding, paying and deleting payments keep paid amounts consistent.
// M5 — a reopen never voids time a payroll has paid.
// M6 — payroll permissions are org-wide only.
const H = 3600_000;

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
async function addTime(membershipId: string, projectId: string, startIso: string, ms = H) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + ms).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}
async function approveWeek(who: Client, date: string) {
  const ts = await who.post(o('/timesheets/submit'), { date });
  expect(ts.status).toBe(200);
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
  return ts.body.id as string;
}
const policy = async (name: string) => (await admin.post(o('/time-off/policies'), { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id as string;
type Line = { membership_id: string; time_off_hours: number; time_off_pay_minor: number; gross_minor: number };

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-05T20:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@moneyp0.test'));
}, 60_000);
afterAll(() => t.close());

describe('M1: a paid holiday inside approved time off is paid once', () => {
  it('holiday added after the time off: 40 h for a 5-day week, not 48 h', async () => {
    const { client: hal, membershipId: hid } = await addMember(t, admin, orgId, 'Hal', 'hal@moneyp0.test');
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: hid, amount_minor: 1000, currency: 'USD', effective_from: '2020-01-01' });
    expect((await hal.post(o('/time-off/requests'), { policy_id: await policy('PTO one'), start_date: '2026-09-14', end_date: '2026-09-18' })).status).toBe(201);
    expect((await admin.post(o('/holidays'), { date: '2026-09-16', name: 'Late holiday', paid: true })).status).toBe(201);
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Hal pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [hid] });
    const run = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-09-15' });
    const line = (run.body.lines as Line[]).find((l) => l.membership_id === hid)!;
    expect([line.time_off_hours, line.time_off_pay_minor]).toEqual([40, 40000]); // was 48 h, $480
    await admin.del(o(`/payroll/runs/${run.body.id}`));
  });

  it('time off requested after the holiday: the time off leaves the day out and the holiday pays it', async () => {
    const { client: ivy, membershipId: iid } = await addMember(t, admin, orgId, 'Ivy', 'ivy@moneyp0.test');
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: iid, amount_minor: 1000, currency: 'USD', effective_from: '2020-01-01' });
    const req = await ivy.post(o('/time-off/requests'), { policy_id: await policy('PTO two'), start_date: '2026-09-14', end_date: '2026-09-18' });
    expect([req.status, req.body.hours]).toEqual([201, 32]); // the existing holiday is not a working day
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Ivy pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [iid] });
    const run = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-09-15' });
    const line = (run.body.lines as Line[]).find((l) => l.membership_id === iid)!;
    expect([line.time_off_hours, line.time_off_pay_minor]).toEqual([40, 40000]);
  });
});

describe('M3: amounts owed reads pay in the pay rate’s currency', () => {
  it('USD pay for time billed in EUR keeps its estimate after approval and matches payroll', async () => {
    const { client: walt, membershipId: wid } = await addMember(t, admin, orgId, 'Walt', 'walt@moneyp0.test');
    const c = (await admin.post(o('/clients'), { name: 'Euro Co', currency: 'EUR' })).body.id;
    const p = (await admin.post(o('/projects'), { name: 'Euro site', client_id: c, member_ids: [wid], billable_default: true })).body.id;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'CLIENT', scope_id: c, amount_minor: 10000, currency: 'EUR', effective_from: '2020-01-01' });
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: wid, amount_minor: 4000, currency: 'USD', effective_from: '2020-01-01' });
    await addTime(wid, p, '2026-09-08T13:00:00Z');
    await t.flush();
    const owed = async () => ((await admin.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).body as Array<{ membership_id: string; approved_amount_minor: number; estimated_amount_minor: number; approved_seconds: number }>).find((r) => r.membership_id === wid)!;
    expect((await owed()).estimated_amount_minor).toBe(4000);
    await approveWeek(walt, '2026-09-08');
    const after = await owed();
    // Before the fix the estimate fell to 0 once approved (the time's currency is the EUR bill one).
    expect([after.approved_seconds, after.approved_amount_minor, after.estimated_amount_minor]).toEqual([3600, 4000, 4000]);
    // The EUR invoice still bills it, and the USD payroll pays the same 4000.
    const prev = (await admin.post(o('/invoices/preview'), { client_id: c, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-07' })).body;
    expect(prev.subtotal_minor).toBe(10000);
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Walt pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [wid] });
    const run = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-09-15' });
    expect((run.body.lines as Array<{ membership_id: string; time_pay_minor: number }>).find((l) => l.membership_id === wid)!.time_pay_minor).toBe(4000);
  });

  it('approved pay in another currency is left out of "approved", not added as if it were USD', async () => {
    const { client: eva, membershipId: eid } = await addMember(t, admin, orgId, 'Eva', 'eva@moneyp0.test');
    const p = (await admin.post(o('/projects'), { name: 'Eva site', member_ids: [eid] })).body.id;
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: eid, amount_minor: 5000, currency: 'EUR', effective_from: '2020-01-01' });
    await addTime(eid, p, '2026-09-08T13:00:00Z');
    await approveWeek(eva, '2026-09-08');
    const row = ((await admin.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).body as Array<{ membership_id: string; approved_amount_minor: number; estimated_amount_minor: number; approved_seconds: number }>).find((r) => r.membership_id === eid)!;
    // Before the fix: approved 5000 (EUR shown as USD) while estimated was 0.
    expect([row.approved_seconds, row.approved_amount_minor, row.estimated_amount_minor]).toEqual([3600, 0, 0]);
  });
});

describe('M4/M11: payments, voids and deletes keep paid amounts consistent', () => {
  let clientId: string;
  const invoice = async () => {
    const r = await admin.post(o('/invoices'), { client_id: clientId, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-23', extra_lines: [{ description: 'Fee', quantity: 1, unit_price_minor: 10000 }] });
    expect(r.status).toBe(201);
    expect((await admin.post(o(`/invoices/${r.body.id}/send`))).status).toBe(200);
    return r.body.id as string;
  };
  beforeAll(async () => {
    clientId = (await admin.post(o('/clients'), { name: 'Pay Co', currency: 'USD' })).body.id;
  });

  it('an invoice holding money cannot be voided, and a void invoice takes no payment', async () => {
    const paidInv = await invoice();
    const pay = await admin.post(o('/payments'), { client_id: clientId, amount_minor: 2500, currency: 'USD', received_on: '2026-09-25', allocations: [{ invoice_id: paidInv, amount_minor: 2500 }] });
    expect(pay.status).toBe(201);
    const v = await admin.post(o(`/invoices/${paidInv}/void`));
    expect([v.status, v.body.code]).toEqual([422, 'invoice_has_payments']);

    const voidInv = await invoice();
    expect((await admin.post(o(`/invoices/${voidInv}/void`))).status).toBe(200);
    const late = await admin.post(o('/payments'), { client_id: clientId, amount_minor: 100, currency: 'USD', received_on: '2026-09-25', allocations: [{ invoice_id: voidInv, amount_minor: 100 }] });
    expect([late.status, late.body.code]).toEqual([422, 'invoice_not_payable']);
    const [row] = await asOwner<{ status: string; paid_minor: string }>(sql`select status, paid_minor from invoices where id = ${voidInv}`);
    expect([row!.status, Number(row!.paid_minor)]).toEqual(['VOID', 0]);
    // Voiding again is a no-op.
    expect((await admin.post(o(`/invoices/${voidInv}/void`))).body.status).toBe('VOID');
  });

  it('deleting a payment takes it off the invoice once; deleting it again is a 404', async () => {
    const inv = await invoice();
    const pay = await admin.post(o('/payments'), { client_id: clientId, amount_minor: 4000, currency: 'USD', received_on: '2026-09-25', allocations: [{ invoice_id: inv, amount_minor: 4000 }] });
    await admin.post(o('/payments'), { client_id: clientId, amount_minor: 1000, currency: 'USD', received_on: '2026-09-26', allocations: [{ invoice_id: inv, amount_minor: 1000 }] });
    expect((await admin.del(o(`/payments/${pay.body.id}`))).status).toBe(204);
    expect((await admin.del(o(`/payments/${pay.body.id}`))).status).toBe(404);
    expect((await admin.get(o(`/invoices/${inv}`))).body.paid_minor).toBe(1000);
  });
});

describe('M5: a reopen never voids time a payroll has paid', () => {
  it('is refused and leaves every approved entry live', async () => {
    const { client: rex, membershipId: rid } = await addMember(t, admin, orgId, 'Rex', 'rex@moneyp0.test');
    const p = (await admin.post(o('/projects'), { name: 'Rex site', member_ids: [rid] })).body.id;
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: rid, amount_minor: 3000, currency: 'USD', effective_from: '2020-01-01' });
    await addTime(rid, p, '2026-09-08T13:00:00Z');
    const tsId = await approveWeek(rex, '2026-09-08');
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Rex pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [rid] });
    const run = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-09-15' });
    expect((await admin.post(o(`/payroll/runs/${run.body.id}/finalize`))).status).toBe(200);
    const r = await admin.post(o(`/timesheets/${tsId}/reopen`), { comment: 'fix' });
    expect([r.status, r.body.code]).toEqual([422, 'timesheet_paid']);
    const [n] = await asOwner<{ live: number; paid: number }>(sql`select count(*) filter (where voided_at is null)::int live, count(*) filter (where payroll_line_id is not null)::int paid from billing_entries where timesheet_id = ${tsId}`);
    expect([n!.live, n!.paid]).toEqual([1, 1]);
  });
});

describe('M6: payroll permissions are org-wide only', () => {
  it('a custom role cannot grant payroll at a narrower scope', async () => {
    const r = await admin.post(o('/roles'), { name: 'Team payroll', grants: { 'payroll:read': 'team', 'payroll:manage': 'team' } });
    expect([r.status, r.body.errors?.[0]?.field]).toEqual([400, 'grants.payroll:read']);
    expect((await admin.post(o('/roles'), { name: 'Payroll clerk', grants: { 'payroll:read': 'org' } })).status).toBe(201);
  });

  it('an older role holding a narrower payroll grant sees no runs and cannot touch bank details', async () => {
    const { membershipId: wid } = await addMember(t, admin, orgId, 'Wes', 'wes@moneyp0.test');
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Wes pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [wid] });
    const role = await admin.post(o('/roles'), { name: 'Legacy payroll', grants: { 'reports:read': 'team' } });
    await asOwner(sql`insert into role_permissions (organization_id, role_id, permission, scope) values (${orgId}, ${role.body.id}, 'payroll:read', 'team'), (${orgId}, ${role.body.id}, 'payroll:manage', 'team')`);
    const { client: tess, membershipId: tid } = await addMember(t, admin, orgId, 'Tess', 'tess@moneyp0.test');
    expect((await admin.patch(o(`/workers/${tid}`), { role_id: role.body.id })).status).toBe(200);
    // Before the fix: 200 on all of these, and the bank details were rewritten.
    expect((await tess.get(o('/payroll/runs?page=1&page_size=50'))).status).toBe(403);
    expect((await tess.get(o('/payroll/profiles'))).status).toBe(403);
    expect((await tess.get(o(`/payroll/profiles/${prof.body.id}/members/${wid}/bank`))).status).toBe(403);
    expect((await tess.put(o(`/payroll/profiles/${prof.body.id}/members/${wid}/bank`), { type: 'bank', account_number: '000123' })).status).toBe(403);
    // An org-wide payroll manager still can.
    expect((await admin.put(o(`/payroll/profiles/${prof.body.id}/members/${wid}/bank`), { type: 'bank', account_number: '000999' })).status).toBe(200);
  });
});
