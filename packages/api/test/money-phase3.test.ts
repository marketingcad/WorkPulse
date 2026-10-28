import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatQuantity } from '../src/lib/invoice-pdf';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Product QA audit (28 October 2026), phase 3: money integrity. Reconciliation first (figures that must
// agree across pay, pay stubs, invoices and reports), then the fixes:
// Q8 — time off across pay periods is paid exactly once, from the hours stored for each day.
// Q9 — money budgets value non-billable time at the bill rate, approved or not.
// Q10 — invoice lines use the time type multiplier the time was priced at.
// F5/F6 — totals per currency; drafts and void invoices are not in totals.
// F8 — the pay stub's overtime is part of its approved time.
// F9 — time off is paid at each day's rate; no pay rate flags the line.
// F10 — invoice lines are quantity × unit price, rounded once; the PDF shows 4 decimals.
// F11 — Summary credits approved money to the client it was billed to.
const H = 3600_000;
const BILL = 10000; // $100/h
const PAY = 2000; // $20/h

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type Line = { membership_id: string; approved_seconds: number; overtime_seconds: number; time_pay_minor: number; time_off_hours: number; time_off_pay_minor: number; gross_minor: number; warnings: string[]; id: string };
type Report = { totals?: Record<string, number>; totalsByCurrency?: Array<{ currency: string; totals: Record<string, number> }>; summary: Array<{ label: string; value: number; currency?: string }>; rows: Array<Record<string, unknown>> };

const report = async (key: string, body: object) => {
  const r = await admin.post(o(`/reports/${key}/query`), body);
  expect(r.status).toBe(200);
  return r.body as Report;
};
const addTime = async (membershipId: string, projectId: string, start: string, ms: number, extra: object = {}) => {
  const s = new Date(start);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + ms).toISOString(), reason: 'fixture', ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
};
const approve = async (who: Client, date: string) => {
  const ts = await who.post(o('/timesheets/submit'), { date });
  expect(ts.status, JSON.stringify(ts.body)).toBe(200);
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
};
const pto = async (name: string, members: string[]) =>
  (await admin.post(o('/time-off/policies'), { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false, applies_to_all: false, member_ids: members })).body.id as string;
const payroll = async (members: string[], period: object, dates: string[]) => {
  const prof = await admin.post(o('/payroll/profiles'), { name: `Pay ${Math.random()}`, period, currency: 'USD', member_ids: members });
  expect(prof.status).toBe(201);
  const runs = [];
  for (const date of dates) {
    const r = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    runs.push(r.body as { id: string; lines: Line[] });
  }
  return runs;
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-02T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p3.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
}, 60_000);
afterAll(() => t.close());

describe('Q8: time off across pay periods is paid once', () => {
  it('a 40 h request split by the semimonthly boundary, with a holiday added later, pays 40 h', async () => {
    const { client: ana, membershipId: anaId } = await addMember(t, admin, orgId, 'Ana', 'ana@p3.test');
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: anaId, amount_minor: 1000, currency: 'USD', effective_from: '2020-01-01' });
    const r = await ana.post(o('/time-off/requests'), { policy_id: await pto('PTO Ana', [anaId]), start_date: '2026-10-12', end_date: '2026-10-16' });
    expect([r.status, r.body.hours]).toEqual([201, 40]);
    // The holiday is added after the request was approved.
    await admin.post(o('/holidays'), { date: '2026-10-14', name: 'Late holiday', paid: true });
    const runs = await payroll([anaId], { type: 'semimonthly' }, ['2026-10-10', '2026-10-20']);
    const lines = runs.map((run) => run.lines.find((l) => l.membership_id === anaId)!);
    expect(lines.map((l) => l.time_off_hours)).toEqual([32, 8]); // was 24 + 8
    expect(lines.reduce((s, l) => s + l.time_off_pay_minor, 0)).toBe(40 * 1000);
  });
});

describe('F9: time off is paid at each day’s rate, and a missing rate is flagged', () => {
  it('a raise in the middle of a request is respected', async () => {
    const { client: bo, membershipId: boId } = await addMember(t, admin, orgId, 'Bo', 'bo@p3.test');
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: boId, amount_minor: 1000, currency: 'USD', effective_from: '2020-01-01' });
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: boId, amount_minor: 2000, currency: 'USD', effective_from: '2026-09-10' });
    expect((await bo.post(o('/time-off/requests'), { policy_id: await pto('PTO Bo', [boId]), start_date: '2026-09-08', end_date: '2026-09-11' })).status).toBe(201);
    const [run] = await payroll([boId], { type: 'monthly' }, ['2026-09-10']);
    expect(run!.lines.find((l) => l.membership_id === boId)!.time_off_pay_minor).toBe(16 * 1000 + 16 * 2000); // was 32 × $10
  });

  it('time off with no worker or org pay rate pays nothing and says so', async () => {
    const { client: cy, membershipId: cyId } = await addMember(t, admin, orgId, 'Cy', 'cy@p3.test');
    expect((await cy.post(o('/time-off/requests'), { policy_id: await pto('PTO Cy', [cyId]), start_date: '2026-09-22', end_date: '2026-09-22' })).status).toBe(201);
    const [run] = await payroll([cyId], { type: 'monthly' }, ['2026-09-10']);
    const line = run!.lines.find((l) => l.membership_id === cyId)!;
    expect([line.time_off_hours, line.time_off_pay_minor, line.warnings]).toEqual([8, 0, ['time_off_no_rate']]); // was no warning
  });
});

describe('invoices: Q10, F10, and reconciliation', () => {
  let clientId: string;
  let projectId: string;
  let walt: Client;
  let waltId: string;
  const invoiceInput = (extra: object = {}) => ({ client_id: clientId, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-10-01', due_date: '2026-10-31', tax_rate_bps: 1000, ...extra });

  beforeAll(async () => {
    ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@p3.test'));
    clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
    projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [waltId], billable_default: true })).body.id;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: BILL, currency: 'USD', effective_from: '2020-01-01' });
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: waltId, amount_minor: PAY, currency: 'USD', effective_from: '2020-01-01' });
  });

  it('Q10: a line keeps the multiplier the time was priced at after the time type changes', async () => {
    const ot = (await admin.post(o('/time-types'), { name: 'Overtime', short_name: 'OT', pay_coefficient: 1.5, bill_coefficient: 2 })).body.id as string;
    await addTime(waltId, projectId, '2026-09-07T09:00:00Z', H, { time_type_id: ot });
    await approve(walt, '2026-09-07');
    expect((await admin.patch(o(`/time-types/${ot}`), { name: 'Overtime', short_name: 'OT', pay_coefficient: 1.5, bill_coefficient: 3 })).status).toBe(200);
    const preview = (await admin.post(o('/invoices/preview'), invoiceInput())).body;
    expect(preview.lines.map((l: { description: string; quantity: number; unit_price_minor: number; amount_minor: number }) => [l.description, l.quantity, l.unit_price_minor, l.amount_minor])).toEqual([['Site — Overtime ×2', 1, 2 * BILL, 2 * BILL]]); // was "×3", 1 × $300 = $200
  });

  it('F10: six 10-minute entries invoice as 1 h × $100 = $100, and the Billing report shows the 2 cents', async () => {
    const days = ['2026-09-14', '2026-09-15', '2026-09-16'];
    for (const d of days) {
      await addTime(waltId, projectId, `${d}T09:00:00Z`, 10 * 60_000 + 1000); // 10:01 each: rounds up per entry
      await addTime(waltId, projectId, `${d}T10:00:00Z`, 10 * 60_000 - 1000);
    }
    await approve(walt, '2026-09-14');
    const inv = await admin.post(o('/invoices'), invoiceInput({ period_start: '2026-09-14', period_end: '2026-09-20', extra_lines: [{ description: 'Setup', quantity: 1.33333, unit_price_minor: 9999, tax_rate_bps: 0 }] }));
    expect(inv.status).toBe(201);
    const got = (await admin.get(o(`/invoices/${inv.body.id}`))).body as { subtotal_minor: number; tax_minor: number; total_minor: number; lines: Array<{ kind: string; quantity: number; unit_price_minor: number; amount_minor: number; tax_minor: number }> };
    // Every line multiplies out, and the invoice adds up.
    for (const l of got.lines) expect(l.amount_minor, JSON.stringify(l)).toBe(Math.round(l.quantity * l.unit_price_minor));
    expect(got.lines.find((l) => l.kind === 'CUSTOM')).toMatchObject({ quantity: 1.3333, amount_minor: Math.round(1.3333 * 9999) }); // was priced from 1.33333
    expect(got.subtotal_minor).toBe(got.lines.reduce((s, l) => s + l.amount_minor, 0));
    expect(got.total_minor).toBe(got.subtotal_minor + got.tax_minor);
    expect(got.tax_minor).toBe(got.lines.reduce((s, l) => s + l.tax_minor, 0));
    // What the PDF prints for a quantity is what the line was priced from.
    expect([formatQuantity(1), formatQuantity(1.3333), formatQuantity(0.1667), formatQuantity(2.5)]).toEqual(['1.00', '1.3333', '0.1667', '2.50']);
    const billing = await report('billing', { from: '2026-09-14', to: '2026-09-20' });
    const time = got.lines.filter((l) => l.kind === 'TIME').reduce((s, l) => s + l.amount_minor, 0);
    expect(billing.summary.find((s) => s.label === 'Invoice rounding')?.value ?? 0).toBe(time - billing.totals!.invoiced!);
  });

  it('reconciliation: approved pay = payroll line = pay stub, and overtime is part of approved time (F8)', async () => {
    const [run] = await payroll([waltId], { type: 'monthly' }, ['2026-09-10']);
    const line = run!.lines.find((l) => l.membership_id === waltId)!;
    const stub = (await admin.get(o(`/pay-stubs/${line.id}`))).body as Line;
    const owed = ((await admin.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).body as Array<{ membership_id: string; approved_amount_minor: number; approved_seconds: number }>).find((r) => r.membership_id === waltId)!;
    expect([line.time_pay_minor, line.approved_seconds]).toEqual([owed.approved_amount_minor, owed.approved_seconds]);
    expect([stub.time_pay_minor, stub.approved_seconds, stub.gross_minor, stub.overtime_seconds]).toEqual([line.time_pay_minor, line.approved_seconds, line.gross_minor, line.overtime_seconds]);
    expect(line.overtime_seconds).toBeLessThanOrEqual(line.approved_seconds);
  });

  it('F8: a 45 h week that is not approved shows no overtime on the stub', async () => {
    const { membershipId: oz } = await addMember(t, admin, orgId, 'Oz', 'oz@p3.test');
    await admin.patch(o(`/projects/${projectId}`), { member_ids: [waltId, oz] });
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']) await addTime(oz, projectId, `${d}T08:00:00Z`, 9 * H);
    await t.flush(); // the day rollups the old overtime split read
    const [run] = await payroll([oz], { type: 'monthly' }, ['2026-09-10']);
    const line = run!.lines.find((l) => l.membership_id === oz)!;
    expect([line.approved_seconds, line.overtime_seconds]).toEqual([0, 0]); // was 5 h of overtime on 0 h approved
  });
});

describe('F5, F6, F11: currencies and clients in reports', () => {
  it('the Invoices report totals per currency and leaves drafts and void invoices out', async () => {
    const usd = (await admin.post(o('/clients'), { name: 'Dollar Co', currency: 'USD' })).body.id as string;
    const eur = (await admin.post(o('/clients'), { name: 'Euro Co', currency: 'EUR' })).body.id as string;
    const make = async (client: string, cents: number, then?: 'send' | 'void') => {
      const r = await admin.post(o('/invoices'), { client_id: client, period_start: '2026-08-01', period_end: '2026-08-31', issue_date: '2026-08-31', due_date: '2026-12-31', extra_lines: [{ description: 'Fee', quantity: 1, unit_price_minor: cents }] });
      expect(r.status).toBe(201);
      if (then) expect((await admin.post(o(`/invoices/${r.body.id}/send`))).status).toBe(200);
      if (then === 'void') expect((await admin.post(o(`/invoices/${r.body.id}/void`), {})).status).toBe(200);
    };
    await make(usd, 10000, 'send');
    await make(usd, 70000); // draft
    await make(usd, 50000, 'void');
    await make(eur, 30000, 'send');
    const r = await report('invoices', { from: '2026-08-01', to: '2026-08-31' });
    expect(r.totalsByCurrency).toEqual([
      { currency: 'USD', totals: { total_minor: 10000, balance_minor: 10000 } },
      { currency: 'EUR', totals: { total_minor: 30000, balance_minor: 30000 } },
    ]); // was one total of 160 000, euros, draft and void included
    expect(r.summary.filter((s) => s.label.startsWith('Invoiced')).map((s) => [s.label, s.value])).toEqual([['Invoiced (USD)', 10000], ['Invoiced (EUR)', 30000]]);
    const csv = await (await t.app.request(`/api/v1/orgs/${orgId}/reports/invoices/export`, { method: 'POST', headers: { Cookie: admin.cookie!, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ from: '2026-08-01', to: '2026-08-31', format: 'CSV' }) })).text();
    expect(csv).toContain('Total (USD)');
    expect(csv).toContain('300.00 EUR');
    const widget = (await admin.get(o('/dashboard/widgets?keys=invoices'))).body.invoices;
    expect(widget.currency).toBe('USD');
  });

  it('the Billing report keeps each client’s currency apart and estimates in it', async () => {
    const { membershipId: eve } = await addMember(t, admin, orgId, 'Eve', 'eve@p3.test');
    const eur = (await admin.post(o('/clients'), { name: 'Euro Works', currency: 'EUR' })).body.id as string;
    const p = (await admin.post(o('/projects'), { name: 'Euro site', client_id: eur, member_ids: [eve], billable_default: true })).body.id as string;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: p, amount_minor: 9000, currency: 'EUR', effective_from: '2020-01-01' });
    await addTime(eve, p, '2026-08-10T09:00:00Z', H);
    await t.flush();
    const r = await report('billing', { from: '2026-08-01', to: '2026-08-31' });
    const row = r.rows.find((x) => x.project === 'Euro site')!;
    expect([row.currency, row.unapproved_estimate]).toEqual(['EUR', 9000]); // was 0: foreign currency left out
    expect(r.totalsByCurrency!.find((x) => x.currency === 'EUR')!.totals.unapproved_estimate).toBe(9000);
  });

  it('F11: Summary credits approved money to the client it was billed to', async () => {
    const { client: fay, membershipId: fayId } = await addMember(t, admin, orgId, 'Fay', 'fay@p3.test');
    const first = (await admin.post(o('/clients'), { name: 'First Client', currency: 'USD' })).body.id as string;
    const second = (await admin.post(o('/clients'), { name: 'Second Client', currency: 'USD' })).body.id as string;
    const p = (await admin.post(o('/projects'), { name: 'Moving site', client_id: first, member_ids: [fayId], billable_default: true })).body.id as string;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: p, amount_minor: BILL, currency: 'USD', effective_from: '2020-01-01' });
    await addTime(fayId, p, '2026-08-17T09:00:00Z', H);
    await approve(fay, '2026-08-17');
    expect((await admin.patch(o(`/projects/${p}`), { client_id: second })).status).toBe(200);
    const s = (await admin.get(o(`/insights?from=2026-08-17&to=2026-08-23&membership_ids=${fayId}`))).body as { by_client: Array<{ name: string; bill_minor: number | null }> };
    const by = Object.fromEntries(s.by_client.map((c) => [c.name, c.bill_minor]));
    expect(by['First Client']).toBe(BILL); // was credited to Second Client
    expect(by['Second Client'] ?? 0).toBe(0);
  });
});

describe('Q9: money budgets value non-billable time at the bill rate', () => {
  it('$200 of non-billable time stays $200 after approval', async () => {
    const { client: gil, membershipId: gilId } = await addMember(t, admin, orgId, 'Gil', 'gil@p3.test');
    const c = (await admin.post(o('/clients'), { name: 'Budget Co', currency: 'USD' })).body.id as string;
    const p = (await admin.post(o('/projects'), { name: 'Budget site', client_id: c, member_ids: [gilId], billable_default: false })).body.id as string;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: p, amount_minor: BILL, currency: 'USD', effective_from: '2020-01-01' });
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: p, kind: 'MONEY', amount: 100000, include_non_billable: true })).status).toBe(200);
    await addTime(gilId, p, '2026-08-24T09:00:00Z', 2 * H, { billable: false });
    await t.flush();
    const spent = async () => ((await admin.get(o('/budgets'))).body as Array<{ subject_id: string; spent: number }>).find((b) => b.subject_id === p)!.spent;
    expect(await spent()).toBe(2 * BILL);
    await approve(gil, '2026-08-24');
    expect(await spent()).toBe(2 * BILL); // was 0 after approval
  });
});
