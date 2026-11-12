import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// QA audit, 11 Nov 2026 (BUG-08): rates typed into the project, client and member forms started
// "today", so time already worked (and approved) before that day was priced at $0, silently.
// Now: form rates take an effective date (a new project defaults to its start date), approved time
// that had no rate at all is priced once a rate covers it (never time an invoice or a finalized
// payroll holds, and never time that was already priced), and Summary reports unpriced time.
// Clock: Wednesday 2026-09-23, America/New_York; weekly timesheets start on Monday.
const NOW = new Date('2026-09-23T20:00:00Z');
const H = 3600_000;

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let clientId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
async function addTime(projectId: string, startIso: string, ms = H) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + ms).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}
async function approveWeek(date: string) {
  const ts = await worker.post(o('/timesheets/submit'), { date });
  expect(ts.status).toBe(200);
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
  return ts.body.id as string;
}
type RateRow = { kind: string; scope: string; scope_id: string | null; amount_minor: number; effective_from: string; effective_to: string | null };
const ratesOf = async (scopeId: string) => ((await admin.get(o('/rates'))).body as RateRow[]).filter((r) => r.scope_id === scopeId);
const summary = async (from: string, to: string) => (await admin.get(o(`/insights?from=${from}&to=${to}`))).body;
const projectRates = (projectId: string, from: string, pay: number, bill: number) => ({ rates: [ { kind: 'PAY', scope: 'PROJECT', scope_id: projectId, amount_minor: pay, currency: 'USD', effective_from: from }, { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: bill, currency: 'USD', effective_from: from } ] });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@rates-date.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@rates-date.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
});
afterAll(() => t.close());

describe('form rates take an effective date', () => {
  it('a new project’s rates start on its start date when that is in the past', async () => {
    const p = await admin.post(o('/projects'), { name: 'Started', client_id: clientId, start_date: '2026-09-01', pay_rate_minor: 2500, bill_rate_minor: 10000 });
    expect(p.status).toBe(201);
    const rates = await ratesOf(p.body.id);
    expect(rates.map((r) => [r.kind, r.amount_minor, r.effective_from]).sort()).toEqual([
      ['BILL', 10000, '2026-09-01'],
      ['PAY', 2500, '2026-09-01'],
    ]);
  });

  it('a project starting later, or with no start date, gets rates from today', async () => {
    const later = await admin.post(o('/projects'), { name: 'Later', start_date: '2026-10-01', bill_rate_minor: 9000 });
    const none = await admin.post(o('/projects'), { name: 'Undated', bill_rate_minor: 9000 });
    expect((await ratesOf(later.body.id)).map((r) => r.effective_from)).toEqual(['2026-09-23']);
    expect((await ratesOf(none.body.id)).map((r) => r.effective_from)).toEqual(['2026-09-23']);
  });

  it('rate_effective_from wins, and re-saving the same amount from an earlier date backdates it', async () => {
    const c = await admin.post(o('/clients'), { name: 'Globex', currency: 'USD', bill_rate_minor: 9000 });
    expect((await ratesOf(c.body.id)).map((r) => r.effective_from)).toEqual(['2026-09-23']);
    expect((await admin.patch(o(`/clients/${c.body.id}`), { bill_rate_minor: 9000, rate_effective_from: '2026-09-01' })).status).toBe(200);
    const open = (await ratesOf(c.body.id)).filter((r) => r.effective_to === null);
    expect(open.map((r) => [r.amount_minor, r.effective_from])).toEqual([[9000, '2026-09-01']]);
  });

  it('member rates accept an effective date too', async () => {
    // Another member: the rest of this file prices Walt's time with project rates only.
    const { membershipId: mia } = await addMember(t, admin, orgId, 'Mia', 'mia@rates-date.test');
    expect((await admin.patch(o(`/workers/${mia}`), { pay_rate_minor: 1800, rate_effective_from: '2026-09-02' })).status).toBe(200);
    expect((await ratesOf(mia)).map((r) => [r.kind, r.effective_from])).toEqual([['PAY', '2026-09-02']]);
  });

  it('an invalid effective date is refused', async () => {
    const r = await admin.post(o('/projects'), { name: 'Bad date', bill_rate_minor: 9000, rate_effective_from: '2026-02-30' });
    expect([r.status, r.body.code]).toEqual([400, 'validation_error']);
  });
});

describe('approved time that had no rate', () => {
  let projectId: string;

  it('is reported as unpriced, then priced when a rate covering it is set', async () => {
    projectId = (await admin.post(o('/projects'), { name: 'No rates yet', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
    await addTime(projectId, '2026-09-15T13:00:00Z');
    await approveWeek('2026-09-15');

    const before = await summary('2026-09-14', '2026-09-20');
    expect(before.totals).toMatchObject({ logged_seconds: 3600, pay_minor: 0, bill_minor: 0, unpriced_pay_seconds: 3600, unpriced_bill_seconds: 3600, unpriced_paid_seconds: 0 });

    // The form asks first: the preview says what saving would price, and saves nothing.
    const ask = await admin.post(o('/rates/pricing-preview'), projectRates(projectId, '2026-09-01', 2500, 10000));
    expect(ask.status).toBe(200);
    expect(ask.body).toEqual({ entries: 2, pay_seconds: 3600, pay_minor: 2500, bill_seconds: 3600, bill_minor: 10000, currency: 'USD' });
    expect((await summary('2026-09-14', '2026-09-20')).totals).toMatchObject({ pay_minor: 0, bill_minor: 0 });
    // A rate starting after the time prices none of it.
    expect((await admin.post(o('/rates/pricing-preview'), projectRates(projectId, '2026-09-16', 2500, 10000))).body.entries).toBe(0);


    expect((await admin.patch(o(`/projects/${projectId}`), { pay_rate_minor: 2500, bill_rate_minor: 10000, rate_effective_from: '2026-09-01' })).status).toBe(200);

    const after = await summary('2026-09-14', '2026-09-20');
    expect(after.totals).toMatchObject({ pay_minor: 2500, bill_minor: 10000, unpriced_pay_seconds: 0, unpriced_bill_seconds: 0 });
    // The invoice reads the same approved amounts.
    const preview = (await admin.post(o('/invoices/preview'), { client_id: clientId, period_start: '2026-09-14', period_end: '2026-09-20', issue_date: '2026-09-23', due_date: '2026-10-07' })).body;
    expect(preview.subtotal_minor).toBe(10000);
    // And the change is in the audit log.
    const logged = await asOwner<{ n: number }>(sql`select count(*)::int n from audit_logs where action = 'rate.priced_approved_time'`);
    expect(logged[0]!.n).toBeGreaterThan(0);
  });

  it('never changes time that was already priced', async () => {
    expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 20000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
    expect((await summary('2026-09-14', '2026-09-20')).totals).toMatchObject({ pay_minor: 2500, bill_minor: 10000 });
  });

  // One weekly USD pay group for Walt (a member is in one pay group per currency), paid in date order.
  let profileId: string;

  it('a draft payroll calculated before the pricing must be recalculated before it is finalized', async () => {
    const p3 = (await admin.post(o('/projects'), { name: 'Draft first', member_ids: [workerId] })).body.id;
    await addTime(p3, '2026-09-01T13:00:00Z');
    await approveWeek('2026-09-01');
    profileId = (await admin.post(o('/payroll/profiles'), { name: 'Weekly', period: { type: 'weekly' }, currency: 'USD', member_ids: [workerId] })).body.id;
    const run = await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-09-01' });
    expect(run.status).toBe(201);
    expect(run.body.gross_minor).toBe(0);
    expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'PROJECT', scope_id: p3, amount_minor: 3000, currency: 'USD', effective_from: '2026-08-01' })).status).toBe(201);
    const stale = await admin.post(o(`/payroll/runs/${run.body.id}/finalize`));
    expect([stale.status, stale.body.code]).toEqual([422, 'payroll_stale']);
    expect((await admin.post(o(`/payroll/runs/${run.body.id}/recalculate`))).status).toBe(200);
    const fin = await admin.post(o(`/payroll/runs/${run.body.id}/finalize`));
    expect(fin.status).toBe(200);
    expect(fin.body.gross_minor).toBe(3000);
  });

  it('leaves pay that a finalized payroll holds, and still prices its billing', async () => {
    const p2 = (await admin.post(o('/projects'), { name: 'Paid at zero', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
    await addTime(p2, '2026-09-08T13:00:00Z');
    const tsId = await approveWeek('2026-09-08');
    const run = await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-09-08' });
    expect((await admin.post(o(`/payroll/runs/${run.body.id}/finalize`))).status).toBe(200);

    // The preview leaves out the pay the payroll already paid.
    expect((await admin.post(o('/rates/pricing-preview'), projectRates(p2, '2026-09-01', 3000, 8000))).body).toMatchObject({ entries: 1, pay_seconds: 0, bill_seconds: 3600, bill_minor: 8000 });
    expect((await admin.patch(o(`/projects/${p2}`), { pay_rate_minor: 3000, bill_rate_minor: 8000, rate_effective_from: '2026-09-01' })).status).toBe(200);
    const [e] = await asOwner<{ pay: number; bill: number; paid: boolean }>(sql`select pay_amount_minor::int pay, bill_amount_minor::int bill, payroll_line_id is not null paid from billing_entries where timesheet_id = ${tsId} and voided_at is null`);
    expect(e).toEqual({ pay: 0, bill: 8000, paid: true });
    // Summary says it was paid at 0, which a rate can no longer change.
    expect((await summary('2026-09-07', '2026-09-13')).totals).toMatchObject({ unpriced_pay_seconds: 3600, unpriced_paid_seconds: 3600, unpriced_bill_seconds: 0 });
  });

  it('the preview needs rates:manage, and only for rates the person may set', async () => {
    const r = await worker.post(o('/rates/pricing-preview'), { rates: [{ kind: 'PAY', scope: 'ORG', amount_minor: 1000, currency: 'USD', effective_from: '2026-09-01' }] });
    expect(r.status).toBe(403);
    const other = await signup(t, 'Oz', 'oz@rates-date.test');
    const foreign = await other.client.post(`/orgs/${other.orgId}/rates/pricing-preview`, projectRates(projectId, '2026-09-01', 1, 1));
    expect([foreign.status, foreign.body.code]).toEqual([400, 'validation_error']);
  });

  it('a rate starting later does not price earlier approved time', async () => {
    const p4 = (await admin.post(o('/projects'), { name: 'Later rate', member_ids: [workerId] })).body.id;
    await addTime(p4, '2026-09-22T13:00:00Z');
    await approveWeek('2026-09-22');
    expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'PROJECT', scope_id: p4, amount_minor: 3000, currency: 'USD', effective_from: '2026-09-23' })).status).toBe(201);
    expect((await summary('2026-09-21', '2026-09-27')).totals).toMatchObject({ pay_minor: 0, unpriced_pay_seconds: 3600 });
  });

  it('time not approved yet with no rate counts as unpriced too', async () => {
    const p5 = (await admin.post(o('/projects'), { name: 'Pending', member_ids: [workerId], billable_default: false })).body.id;
    await addTime(p5, '2026-08-25T15:00:00Z');
    await t.flush();
    // Not billable, so there is no unpriced billing.
    expect((await summary('2026-08-24', '2026-08-30')).totals).toMatchObject({ logged_seconds: 3600, unpriced_pay_seconds: 3600, unpriced_bill_seconds: 0 });
  });
});
