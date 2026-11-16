import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Finance calculations end to end (QA audit 16 Nov 2026): one week of known work, priced by hand.
 * Every figure here was worked out on paper from the documented rules: each entry priced on its own,
 * rounded half-up to the cent; rate precedence (pay: worker on project, worker, project, client, org;
 * bill: worker on project, project, worker, client, org); a time type multiplies pay; overtime is counted
 * over 40 h a week but not paid extra; paid time off at the member's own rate that day; invoice tax per line.
 * Also the regressions found that day: BUG-30 (Payroll export left out paid time off).
 *
 * Week Mon 9 – Sun 15 Nov 2026, organization in America/New_York (UTC−5).
 */
const PASSWORD = 'correct-horse-battery';
let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let W: string;
let Y: string;
let acme: string;
let beta: string;
let p1: string;
let p2: string;
let p3: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00-05:00`).toISOString();
const ok = async <T = any>(p: Promise<{ status: number; body: unknown }>, status = [200, 201]): Promise<T> => {
  const r = await p;
  expect(status, JSON.stringify(r.body).slice(0, 300)).toContain(r.status);
  return r.body as T;
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-16T15:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Olivia', 'olivia@fin.test'));
  ({ client: walt, membershipId: W } = await addMember(t, admin, orgId, 'Walt', 'walt@fin.test'));
  ({ membershipId: Y } = await addMember(t, admin, orgId, 'Wendy', 'wendy@fin.test'));
  acme = (await ok(admin.post(o('/clients'), { name: 'Acme Lab', currency: 'USD', email: 'billing@acme.test' }))).id;
  beta = (await ok(admin.post(o('/clients'), { name: 'Beta Corp', currency: 'USD' }))).id;
  p1 = (await ok(admin.post(o('/projects'), { name: 'Acme Website', client_id: acme, member_ids: [W, Y], billable_default: true }))).id;
  p2 = (await ok(admin.post(o('/projects'), { name: 'Acme Internal', client_id: acme, member_ids: [W, Y], billable_default: false }))).id;
  p3 = (await ok(admin.post(o('/projects'), { name: 'Beta App', client_id: beta, member_ids: [W, Y], billable_default: true }))).id;

  const rate = (kind: 'PAY' | 'BILL', scope: string, scope_id: string | null, minor: number, from = '2026-01-01') => ok(admin.post(o('/rates'), { kind, scope, scope_id, amount_minor: minor, currency: 'USD', effective_from: from }));
  await rate('PAY', 'ORG', null, 2000);
  await rate('PAY', 'WORKER', W, 3000);
  await rate('PAY', 'WORKER', W, 3300, '2026-11-12'); // raise from Thursday
  await rate('PAY', 'PROJECT', p3, 2500);
  await rate('PAY', 'PROJECT_WORKER', `${p3}:${W}`, 4000);
  await rate('BILL', 'ORG', null, 10000);
  await rate('BILL', 'CLIENT', acme, 15000);
  await rate('BILL', 'PROJECT', p3, 12000);
  await rate('BILL', 'WORKER', Y, 9000);
  await rate('BILL', 'PROJECT_WORKER', `${p1}:${W}`, 17500);
  const ot = (await ok(admin.post(o('/time-types'), { name: 'Overtime', short_name: 'OT', pay_coefficient: 1.5, bill_coefficient: 1 }))).id;

  const entries: Array<[string, string, string, string, string, string?]> = [
    [W, p1, '2026-11-09', '09:00', '11:20'], // 2h20m: pay $30 → $70.00, bill $175 → $408.33
    [W, p1, '2026-11-10', '13:00', '13:37'], // 37m: $18.50, $107.92
    [W, p2, '2026-11-11', '10:00', '12:05'], // 2h05m not billable: $62.50
    [W, p1, '2026-11-12', '09:00', '10:10'], // 1h10m after the raise: $38.50, $204.17
    [W, p3, '2026-11-12', '14:00', '15:45'], // 1h45m worker-on-project $40 → $70.00; project bill $120 → $210.00
    [W, p1, '2026-11-13', '18:00', '18:07', ot], // 7m ×1.5 pay: 630 s × $33 = $5.775 → $5.78; bill $20.42
    [Y, p1, '2026-11-09', '08:00', '17:00'], // 9h: org pay $20 → $180; worker bill $90 → $810
    [Y, p1, '2026-11-10', '08:00', '18:00'],
    [Y, p1, '2026-11-11', '08:00', '18:00'],
    [Y, p1, '2026-11-12', '08:00', '18:00'],
    [Y, p1, '2026-11-13', '08:00', '18:00'], // 4 × 10h: $200 each; $900 each
    [Y, p3, '2026-11-11', '18:30', '19:15'], // 45m: project pay $25 → $18.75; project bill $120 → $90
  ];
  for (const [m, p, d, a, b, tt] of entries) {
    await ok(admin.post(o('/manual-time'), { membership_id: m, project_id: p, started_at: at(d, a), ended_at: at(d, b), reason: 'fixture', ...(tt ? { time_type_id: tt } : {}) }), [201]);
  }
  for (const r of (await admin.get<Array<{ id: string }>>(o('/manual-time?status=PENDING'))).body) await ok(admin.post(o(`/manual-time/${r.id}/approve`), {}), [200, 204]);

  const vac = (await ok(admin.post(o('/time-off/policies'), { name: 'Vacation', paid: true, hours_per_day: 8, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } }))).id;
  await ok(admin.post(o('/time-off/balances/adjust'), { policy_id: vac, membership_id: W, hours: 40 }));
  const tor = (await ok(walt.post(o('/time-off/requests'), { policy_id: vac, start_date: '2026-11-13', end_date: '2026-11-13' }))).id;
  await ok(admin.post(o(`/time-off/requests/${tor}/approve`), {}), [200, 204]);

  const ex = (await ok(walt.post(o('/expenses'), { project_id: p1, category: 'Travel', description: 'Taxi', amount_minor: 4550, currency: 'USD', spent_on: '2026-11-10', billable: true, reimbursable: true }))).id;
  await ok(admin.post(o(`/expenses/${ex}/approve`), {}), [200, 204]);

  for (const m of [W, Y]) {
    const s = await ok(admin.post(o('/timesheets/submit'), { membership_id: m, date: '2026-11-09' }));
    await ok(admin.post(o(`/timesheets/${s.id}/approve`), {}));
  }
  await t.flush();
});
afterAll(() => t.close());

describe('hours', () => {
  it('timesheet totals and billable time', async () => {
    const w = (await admin.get(o(`/timesheets?membership_id=${W}&date=2026-11-09`))).body;
    const y = (await admin.get(o(`/timesheets?membership_id=${Y}&date=2026-11-09`))).body;
    expect([w.status, w.total_seconds, w.billable_seconds]).toEqual(['APPROVED', 29040, 21540]); // 8h04m, 5h59m
    expect([y.status, y.total_seconds, y.billable_seconds]).toEqual(['APPROVED', 179100, 179100]); // 49h45m
  });
});

describe('payroll', () => {
  let run: any;
  it('prices every entry at the winning rate, splits overtime, pays time off', async () => {
    const profile = await ok(admin.post(o('/payroll/profiles'), { name: 'Weekly', period: { type: 'weekly' }, currency: 'USD', is_default: true, member_ids: [W, Y] }));
    run = await ok(admin.post(o('/payroll/runs'), { profile_id: profile.id, date: '2026-11-13' }), [201]);
    expect([run.period_start, run.period_end]).toEqual(['2026-11-09', '2026-11-15']);
    const line = (m: string) => run.lines.find((l: { membership_id: string }) => l.membership_id === m);
    const w = line(W);
    expect([w.approved_seconds, w.regular_seconds, w.overtime_seconds]).toEqual([29040, 29040, 0]);
    expect([w.time_pay_minor, w.time_off_hours, w.time_off_pay_minor, w.gross_minor]).toEqual([26528, 8, 26400, 52928]);
    const y = line(Y);
    // Overtime over 40 h is counted but not paid extra (no time type chosen).
    expect([y.approved_seconds, y.regular_seconds, y.overtime_seconds]).toEqual([179100, 144000, 35100]);
    expect([y.time_pay_minor, y.time_off_pay_minor, y.gross_minor]).toEqual([99875, 0, 99875]);
  });

  it('applies bonuses and deductions to net pay', async () => {
    const line = (m: string) => run.lines.find((l: { membership_id: string }) => l.membership_id === m);
    await ok(admin.put(o(`/payroll/runs/${run.id}/lines/${line(W).id}/adjustments`), { adjustments: [{ label: 'Bonus', amount_minor: 5000 }] }));
    await ok(admin.put(o(`/payroll/runs/${run.id}/lines/${line(Y).id}/adjustments`), { adjustments: [{ label: 'Uniform', amount_minor: -1234 }] }));
    const after = (await admin.get(o(`/payroll/runs/${run.id}`))).body;
    const net = (m: string) => after.lines.find((l: { membership_id: string }) => l.membership_id === m).net_minor;
    expect([net(W), net(Y)]).toEqual([57928, 98641]);
  });

  it('Payroll export report adds up to the payroll, paid time off included (BUG-30)', async () => {
    const r = await ok(admin.post(o('/reports/payroll/query'), { from: '2026-11-09', to: '2026-11-15' }));
    const row = (name: string) => r.rows.find((x: { worker: string }) => x.worker === name);
    expect([row('Walt').approved_pay, row('Walt').time_off_hours, row('Walt').time_off_pay, row('Walt').total_pay]).toEqual([26528, 8, 26400, 52928]);
    expect([row('Wendy').approved_pay, row('Wendy').time_off_pay, row('Wendy').total_pay]).toEqual([99875, 0, 99875]);
    // The report's total is what the payroll run pays before adjustments ($1,528.03).
    expect(r.totals.total_pay).toBe(152803);
    expect(r.summary.find((s: { label: string }) => s.label === 'Total to pay').value).toBe(152803);
  });
});

describe('billing', () => {
  const preview = (client: string, tax: number) => ok(admin.post(o('/invoices/preview'), { client_id: client, period_start: '2026-11-01', period_end: '2026-11-30', issue_date: '2026-11-16', due_date: '2026-12-16', tax_rate_bps: tax }));

  it('invoices each client at the winning bill rate, with expenses and tax per line', async () => {
    const a = await preview(acme, 825);
    const lines = a.lines.map((l: any) => [l.quantity, l.unit_price_minor, l.amount_minor, l.tax_minor]);
    // Walt at $175: 15240 s = 4.2333 h → $740.83; Wendy at her $90 worker rate (not Acme's $150): 49 h; the taxi.
    expect(lines).toEqual([
      [4.2333, 17500, 74083, 6112],
      [49, 9000, 441000, 36383],
      [1, 4550, 4550, 375],
    ]);
    expect([a.subtotal_minor, a.tax_minor, a.total_minor]).toEqual([519633, 42870, 562503]);
    const b = await preview(beta, 0);
    expect([b.lines.length, b.lines[0].quantity, b.lines[0].unit_price_minor, b.total_minor]).toEqual([1, 2.5, 12000, 30000]);
  });

  it('billing report and budgets use the same per-entry amounts', async () => {
    const r = await ok(admin.post(o('/reports/billing/query'), { from: '2026-11-09', to: '2026-11-15' }));
    const amount = r.rows.reduce((s: number, x: { approved: number }) => s + x.approved, 0);
    expect(amount).toBe(545084); // Walt $950.84 + Wendy $4,500.00
    await ok(admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: p1, kind: 'MONEY', amount: 300000 }));
    await ok(admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: p2, kind: 'HOURS', amount: 36000, include_non_billable: true }));
    const budgets = (await admin.get<Array<{ subject_id: string; spent: number; pct_used: number; state: string }>>(o('/budgets'))).body;
    const b1 = budgets.find((b) => b.subject_id === p1)!;
    const b2 = budgets.find((b) => b.subject_id === p2)!;
    expect([b1.spent, b1.pct_used, b1.state]).toEqual([515084, 171.7, 'exceeded']);
    expect([b2.spent, b2.pct_used, b2.state]).toEqual([7500, 20.8, 'healthy']);
  });

  it('approved amounts keep their rates when a rate changes later', async () => {
    await ok(admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: W, amount_minor: 5000, currency: 'USD', effective_from: '2026-11-01' }));
    const r = await ok(admin.post(o('/reports/payroll/query'), { from: '2026-11-09', to: '2026-11-15' }));
    expect(r.rows.find((x: { worker: string }) => x.worker === 'Walt').approved_pay).toBe(26528);
  });
});
