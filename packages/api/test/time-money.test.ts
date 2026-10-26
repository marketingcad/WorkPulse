import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Time & Timesheets audit, step 3: approved pay (rounded per entry) is the official figure, and the
// estimates, Payroll Export overtime and invoice lines follow it. Organization in UTC, USD.
const H = 3600;
const PAY = 1000; // $10.00 an hour
const BILL = 10000; // $100.00 an hour

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
let clientId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const memberIds: string[] = [];

async function member(name: string) {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@money.test`);
  memberIds.push(m.membershipId);
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: memberIds })).status).toBe(200);
  expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: m.membershipId, amount_minor: PAY, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  return m;
}

async function adminTime(membershipId: string, startIso: string, seconds: number, extra: object = {}) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture', ...extra });
  expect(r.status).toBe(201);
}

async function approveWeekOf(worker: Client, date: string) {
  const ts = await worker.post(o('/timesheets/submit'), { date });
  expect(ts.status).toBe(200);
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
}

const owedFor = async (m: string, from: string, to: string) => ((await admin.get(o(`/billing/amounts-owed?from=${from}&to=${to}`))).body as Array<{ membership_id: string; estimated_amount_minor: number; approved_amount_minor: number }>).find((r) => r.membership_id === m)!;
const summaryPay = async (m: string, from: string, to: string) => ((await admin.get(o(`/insights?from=${from}&to=${to}&membership_ids=${m}`))).body as { totals: { pay_minor: number; bill_minor: number } }).totals;
const payrollRow = async (name: string, from: string, to: string) => ((await admin.post(o('/reports/payroll/query'), { from, to })).body.rows as Array<{ worker: string; regular: number; overtime: number; approved_pay: number; earnings: number }>).find((r) => r.worker === name)!;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-23T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@money.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, billable_default: true })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: BILL, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
}, 60_000);
afterAll(() => t.close());

describe('estimates are rounded per entry, like approved pay', () => {
  it('three 20-minute entries at $10/h: $9.99 estimated, approved, in Summary and in Owed', async () => {
    const { client: walt, membershipId: waltId } = await member('Walt');
    for (const hour of ['09', '10', '11']) await adminTime(waltId, `2026-10-19T${hour}:00:00Z`, 20 * 60);
    await t.flush();
    // 1200 s × $10/h = 333.33¢ → 333¢ per entry. Before the fix the estimates rounded the day: $10.00.
    expect((await owedFor(waltId, '2026-10-19', '2026-10-19')).estimated_amount_minor).toBe(999);
    expect(await summaryPay(waltId, '2026-10-19', '2026-10-19')).toMatchObject({ pay_minor: 999, bill_minor: 3 * 3333 });

    await approveWeekOf(walt, '2026-10-19');
    expect(await owedFor(waltId, '2026-10-19', '2026-10-19')).toMatchObject({ approved_amount_minor: 999, estimated_amount_minor: 999 });
    expect(await summaryPay(waltId, '2026-10-19', '2026-10-19')).toMatchObject({ pay_minor: 999, bill_minor: 9999 });
  });

  it('Payroll Export shows the approved pay (official) next to the estimate including time not approved yet', async () => {
    const { membershipId: waltId } = { membershipId: memberIds[0]! };
    await adminTime(waltId, '2026-10-13T09:00:00Z', H); // not submitted: $10.00 estimated
    await t.flush();
    const row = await payrollRow('Walt', '2026-10-01', '2026-10-31');
    expect([row.approved_pay, row.earnings]).toEqual([999, 999 + 1000]);
  });
});

describe('overtime for a week split between two pay periods', () => {
  it('is worked out on the whole week and counted on the days it was worked', async () => {
    const { membershipId: olaId } = await member('Ola');
    // 10 h a day, Monday 12 – Friday 16 October: 50 h, so 10 h of weekly overtime, on Friday.
    for (const d of ['12', '13', '14', '15', '16']) await adminTime(olaId, `2026-10-${d}T08:00:00Z`, 10 * H);
    await t.flush();
    // Semimonthly halves: 1–15 holds Mon–Thu (40 h, no overtime), 16–31 holds Friday (10 h, all overtime).
    // Before the fix each half saw a short week: 40 h and 10 h, so 0 h of overtime in total.
    expect(await payrollRow('Ola', '2026-10-01', '2026-10-15')).toMatchObject({ regular: 40 * H, overtime: 0 });
    expect(await payrollRow('Ola', '2026-10-16', '2026-10-31')).toMatchObject({ regular: 0, overtime: 10 * H });
    // The whole week at once: unchanged.
    expect(await payrollRow('Ola', '2026-10-12', '2026-10-18')).toMatchObject({ regular: 40 * H, overtime: 10 * H });
  });
});

describe('invoice lines', () => {
  it('a time type with a bill coefficient gets its own line, priced at the adjusted rate', async () => {
    const { client: ivy, membershipId: ivyId } = await member('Ivy');
    const double = (await admin.post(o('/time-types'), { name: 'Weekend', short_name: 'W', pay_coefficient: 1.5, bill_coefficient: 2 })).body.id;
    await adminTime(ivyId, '2026-10-06T09:00:00Z', H, { time_type_id: double });
    await adminTime(ivyId, '2026-10-06T11:00:00Z', 2 * H);
    await approveWeekOf(ivy, '2026-10-06');
    const lines = (await admin.post(o('/invoices/preview'), { client_id: clientId, period_start: '2026-10-05', period_end: '2026-10-11', issue_date: '2026-10-23', due_date: '2026-11-06' })).body.lines as Array<{ description: string; quantity: number; unit_price_minor: number; amount_minor: number }>;
    // Before the fix: one line, 3 h × $100 = "$300" with an amount of $400.
    expect(lines.map((l) => [l.description, l.quantity, l.unit_price_minor, l.amount_minor]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['Site', 2, BILL, 2 * BILL],
      ['Site — Weekend ×2', 1, 2 * BILL, 2 * BILL],
    ]);
    for (const l of lines) expect(Math.round(l.quantity * l.unit_price_minor)).toBe(l.amount_minor);
  });
});
