import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDaily } from '../src/jobs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Phase 9 gate: rates, billing, budgets, invoices, payments.
// Clock: Wednesday 2026-09-23 (America/New_York). Weekly timesheets start on Monday.
const NOW = new Date('2026-09-23T20:00:00Z');
const BILL = 12345; // $123.45/h: odd, so per-entry rounding is exercised
const PAY = 4000;

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let clientId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const amount = (secs: number, rate: number) => Math.round((secs * rate) / 3600);

async function addTime(start: string, seconds: number) {
  const s = new Date(start);
  const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}
async function approveWeek(date: string) {
  const ts = await worker.post(o('/timesheets/submit'), { date });
  expect(ts.status).toBe(200);
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
  return ts.body.id as string;
}
const report = async (key: string, body: object) => (await admin.post(o(`/reports/${key}/query`), body)).body;
const invoiceInput = (extra: object = {}) => ({ client_id: clientId, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-07', tax_rate_bps: 825, ...extra });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@fin.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@fin.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: BILL, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: workerId, amount_minor: PAY, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
});
afterAll(() => t.close());

describe('approved time reconciles: invoice = billing report = amounts owed', () => {
  const durations = [1234, 777, 3601, 59]; // odd durations: every entry rounds on its own
  let invoiceId: string;

  it('prices each billing entry at approval', async () => {
    await addTime('2026-09-08T13:00:00Z', durations[0]!);
    await addTime('2026-09-09T13:00:00Z', durations[1]!);
    await addTime('2026-09-10T13:00:00Z', durations[2]!);
    await addTime('2026-09-11T13:00:00Z', durations[3]!);
    await approveWeek('2026-09-08');
  });

  it('builds one line per rate whose amount is the exact sum of the billed entries', async () => {
    const preview = (await admin.post(o('/invoices/preview'), invoiceInput())).body;
    const expected = durations.reduce((s, d) => s + amount(d, BILL), 0);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ kind: 'TIME', unit_price_minor: BILL, amount_minor: expected, entries: 4 });
    expect(preview.lines[0].quantity).toBeCloseTo(durations.reduce((a, b) => a + b, 0) / 3600, 4);
    expect(preview.subtotal_minor).toBe(expected);
    expect(preview.tax_minor).toBe(Math.round((expected * 825) / 10000)); // tax per line, half-up
    expect(preview.other_currency_entries).toBe(0);

    const inv = await admin.post(o('/invoices'), invoiceInput());
    expect(inv.status).toBe(201);
    invoiceId = inv.body.id;
    expect(inv.body.subtotal_minor).toBe(expected);

    const billing = await report('billing', { from: '2026-09-01', to: '2026-09-30' });
    expect(billing.totals).toMatchObject({ approved: expected, invoiced: expected, approved_seconds: durations.reduce((a, b) => a + b, 0), unapproved_estimate: 0 });
    const owed = (await admin.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).body.find((r: { membership_id: string }) => r.membership_id === workerId);
    expect(owed).toMatchObject({ approved_seconds: durations.reduce((a, b) => a + b, 0), approved_amount_minor: durations.reduce((s, d) => s + amount(d, PAY), 0) });
  });

  it('bills each entry once: nothing left to invoice, and a concurrent invoice cannot double-bill', async () => {
    const again = await admin.post(o('/invoices'), invoiceInput());
    expect([again.status, again.body.code]).toEqual([422, 'nothing_to_invoice']);
    // Void → the time can be invoiced again; two invoices racing for it → exactly one wins.
    expect((await admin.post(o(`/invoices/${invoiceId}/void`), {})).status).toBe(200);
    const [a, b] = await Promise.all([admin.post(o('/invoices'), invoiceInput()), admin.post(o('/invoices'), invoiceInput())]);
    // The loser either hits the claim guard (409) or, if it ran after the winner committed, finds nothing (422).
    expect([a, b].filter((r) => r.status !== 201).map((r) => r.body.code)).toEqual([expect.stringMatching(/^(invoice_conflict|nothing_to_invoice)$/)]);
    const ok = [a, b].filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    invoiceId = ok[0]!.body.id;
    const billing = await report('billing', { from: '2026-09-01', to: '2026-09-30' });
    expect(billing.totals.invoiced).toBe(billing.totals.approved);
  });

  it('a timesheet on an invoice cannot be reopened until the invoice is voided', async () => {
    const ts = (await worker.get(o('/timesheets?date=2026-09-08'))).body.id;
    const r = await admin.post(o(`/timesheets/${ts}/reopen`), { comment: 'x' });
    expect([r.status, r.body.code]).toEqual([422, 'timesheet_invoiced']);
  });
});

describe('rates', () => {
  it('a rate change never reprices approved time; only unapproved time uses the new rate', async () => {
    const before = await report('billing', { from: '2026-09-01', to: '2026-09-30' });
    // New project rate, backdated over the approved week.
    expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 20000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
    const after = await report('billing', { from: '2026-09-01', to: '2026-09-30' });
    expect(after.totals.approved).toBe(before.totals.approved);
    expect(after.totals.invoiced).toBe(before.totals.invoiced);

    await addTime('2026-09-21T13:00:00Z', 1800); // this week, not approved yet
    await t.flush();
    const est = await report('billing', { from: '2026-09-01', to: '2026-09-30' });
    expect(est.totals.approved).toBe(before.totals.approved);
    expect(est.totals.unapproved_estimate).toBe(amount(1800, 20000));

    // The old rate is kept as history; deleting a rate that priced approved time is refused.
    const rates = (await admin.get(o('/rates'))).body as Array<{ id: string; amount_minor: number; kind: string }>;
    const old = rates.find((r) => r.kind === 'BILL' && r.amount_minor === BILL)!;
    expect(old).toBeTruthy();
    const del = await admin.del(o(`/rates/${old.id}`));
    expect([del.status, del.body.code]).toEqual([422, 'rate_in_use']);
  });

  it('resolves the most specific rate, effective-dated with an exclusive end', async () => {
    const other = (await admin.post(o('/projects'), { name: 'Other', client_id: clientId, member_ids: [workerId] })).body.id;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'CLIENT', scope_id: clientId, amount_minor: 9000, currency: 'USD', effective_from: '2020-01-01' });
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT_WORKER', scope_id: `${other}:${workerId}`, amount_minor: 15000, currency: 'USD', effective_from: '2026-09-15' });
    const mk = async (start: string) => {
      const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: other, started_at: start, ended_at: new Date(Date.parse(start) + 3600_000).toISOString(), reason: 'x' });
      expect(r.status).toBe(201);
    };
    await mk('2026-09-14T13:00:00Z'); // before the project-worker rate → client rate
    await mk('2026-09-15T13:00:00Z'); // first day of the project-worker rate
    await approveWeek('2026-09-14');
    const lines = (await admin.post(o('/invoices/preview'), invoiceInput())).body.lines as Array<{ unit_price_minor: number; amount_minor: number }>;
    expect(lines.map((l) => [l.unit_price_minor, l.amount_minor]).sort()).toEqual([
      [15000, 15000],
      [9000, 9000],
    ]);
  });
});

describe('invoice status and payments', () => {
  let inv: { id: string; total_minor: number };
  beforeAll(async () => {
    inv = (await admin.post(o('/invoices'), invoiceInput({ due_date: '2026-09-30' }))).body;
    expect((await admin.post(o(`/invoices/${inv.id}/send`), {})).body.status).toBe('SENT');
  });
  const status = async () => (await admin.get(o(`/invoices/${inv.id}`))).body.status;
  const pay = (amt: number, extra: object = {}) => admin.post(o('/payments'), { client_id: clientId, amount_minor: amt, currency: 'USD', received_on: '2026-09-24', allocations: [{ invoice_id: inv.id, amount_minor: amt }], ...extra });

  it('SENT → PARTIALLY_PAID → OVERDUE → PAID, with VOID blocked while paid', async () => {
    const half = Math.floor(inv.total_minor / 2);
    expect((await pay(half)).status).toBe(201);
    expect(await status()).toBe('PARTIALLY_PAID');
    const v = await admin.post(o(`/invoices/${inv.id}/void`), {});
    expect([v.status, v.body.code]).toEqual([422, 'invoice_has_payments']);
    t.clock.set(new Date('2026-10-02T15:00:00Z'));
    await relogin();
    expect(await status()).toBe('OVERDUE');
    expect((await pay(inv.total_minor - half)).status).toBe(201);
    expect(await status()).toBe('PAID');
    t.clock.set(NOW);
    await relogin();
  });

  it('rejects overpayment (also when two payments race), other currencies and other clients', async () => {
    const inv2 = (await (async () => {
      t.clock.set(new Date('2026-10-06T15:00:00Z'));
      await relogin();
      await addTime('2026-09-29T13:00:00Z', 3600);
      await approveWeek('2026-09-28');
      const r = await admin.post(o('/invoices'), invoiceInput({ period_start: '2026-09-28', period_end: '2026-10-04', issue_date: '2026-10-06', due_date: '2026-10-20' }));
      await admin.post(o(`/invoices/${r.body.id}/send`), {});
      return r;
    })()).body as { id: string; total_minor: number };
    const payTo = (amt: number, extra: object = {}) => admin.post(o('/payments'), { client_id: clientId, amount_minor: amt, currency: 'USD', received_on: '2026-10-06', allocations: [{ invoice_id: inv2.id, amount_minor: amt }], ...extra });
    const sixty = Math.ceil(inv2.total_minor * 0.6);
    const [a, b] = await Promise.all([payTo(sixty), payTo(sixty)]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect([a, b].find((r) => r.status === 422)!.body.code).toBe('overpayment');
    expect((await payTo(10, { currency: 'EUR' })).body.code).toBe('currency_mismatch');
    const other = (await admin.post(o('/clients'), { name: 'Other Co' })).body.id;
    expect((await payTo(10, { client_id: other })).body.code).toBe('client_mismatch');
    const current = (await admin.get(o(`/invoices/${inv2.id}`))).body;
    expect(current.paid_minor).toBe(sixty);
  });

  it('emits invoice.overdue once, even when the daily job missed the day after the due date', async () => {
    const i3 = (await admin.post(o('/invoices'), { ...invoiceInput(), extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 5000, tax_rate_bps: 0 }], period_start: '2026-11-01', period_end: '2026-11-30', due_date: '2026-10-10' })).body;
    await admin.post(o(`/invoices/${i3.id}/send`), {});
    const count = async () => {
      await t.flush();
      return ((await admin.get(o('/notifications'))).body.data as Array<{ type: string; title: string }>).filter((n) => n.type === 'invoice.overdue' && n.title.includes(i3.number)).length;
    };
    t.clock.set(new Date('2026-10-15T15:00:00Z')); // five days late: the run on the 11th was missed
    await runDaily(t.deps);
    await relogin();
    expect(await count()).toBe(1);
    await runDaily(t.deps);
    expect(await count()).toBe(1);
  });
});

describe('budgets', () => {
  let proj: string;
  const notes = async () => {
    await t.flush();
    return ((await admin.get(o('/notifications'))).body.data as Array<{ type: string; title: string }>).filter((n) => n.type.startsWith('budget.') && n.title.startsWith('Budgeted'));
  };
  const add = async (start: string, hours: number) => {
    const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: proj, started_at: start, ended_at: new Date(Date.parse(start) + hours * 3600_000).toISOString(), reason: 'x' });
    expect(r.status).toBe(201);
  };

  beforeAll(async () => {
    t.clock.set(new Date('2026-11-20T15:00:00Z'));
    await relogin();
    proj = (await admin.post(o('/projects'), { name: 'Budgeted', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
  });

  it('notifies once per threshold level', async () => {
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: proj, kind: 'HOURS', amount: 10 * 3600, warn_pct: 50 })).status).toBe(200);
    await add('2026-11-02T13:00:00Z', 6);
    expect((await notes()).map((n) => n.type)).toEqual(['budget.warning']);
    await add('2026-11-03T13:00:00Z', 1);
    expect(await notes()).toHaveLength(1);
    await add('2026-11-04T13:00:00Z', 4);
    expect((await notes()).map((n) => n.type).sort()).toEqual(['budget.exceeded', 'budget.warning']);
    await add('2026-11-05T13:00:00Z', 1);
    expect(await notes()).toHaveLength(2);
  });

  it('monthly budgets alert again in a new month', async () => {
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: proj, kind: 'HOURS', amount: 2 * 3600, period: 'MONTHLY', warn_pct: 100 })).status).toBe(200);
    const before = (await notes()).length;
    await add('2026-11-06T13:00:00Z', 1); // November: already well over 2h → exceeded once
    expect((await notes()).length).toBe(before + 1);
    t.clock.set(new Date('2026-12-10T15:00:00Z'));
    await relogin();
    await add('2026-12-01T13:00:00Z', 3); // December starts over
    expect((await notes()).length).toBe(before + 2);
  });

  it('money budgets count approved time at its billed amount (a later rate change does not move it)', async () => {
    const mb = (await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: proj, kind: 'MONEY', amount: 100_000_00, warn_pct: 100 })).body.find((b: { subject_id: string }) => b.subject_id === proj);
    const spentBefore = mb.spent;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: proj, amount_minor: 99999, currency: 'USD', effective_from: '2020-01-01' });
    const b2 = (await admin.get(o('/budgets'))).body.find((b: { subject_id: string }) => b.subject_id === proj);
    // Nothing on this project is approved yet, so the estimate follows the new rate…
    expect(b2.spent).not.toBe(spentBefore);
    // …and once approved, a further rate change leaves it alone.
    for (const d of ['2026-11-02', '2026-11-30', '2026-12-01']) {
      const ts = await worker.post(o('/timesheets/submit'), { date: d });
      if (ts.status === 200) await admin.post(o(`/timesheets/${ts.body.id}/approve`), {});
    }
    await t.flush();
    const approvedSpend = (await admin.get(o('/budgets'))).body.find((b: { subject_id: string }) => b.subject_id === proj).spent;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: proj, amount_minor: 1, currency: 'USD', effective_from: '2020-01-01' });
    expect((await admin.get(o('/budgets'))).body.find((b: { subject_id: string }) => b.subject_id === proj).spent).toBe(approvedSpend);
  });
});

describe('currency', () => {
  it('an invoice has one currency; time billed in another currency is left out and reported', async () => {
    const eur = (await admin.post(o('/clients'), { name: 'Euro GmbH', currency: 'EUR' })).body.id;
    const p = (await admin.post(o('/projects'), { name: 'EU work', client_id: eur, member_ids: [workerId], billable_default: true })).body.id;
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: p, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' }); // mistake: USD rate
    await admin.post(o('/manual-time'), { membership_id: workerId, project_id: p, started_at: '2026-12-08T13:00:00Z', ended_at: '2026-12-08T14:00:00Z', reason: 'x' });
    const ts = await worker.post(o('/timesheets/submit'), { date: '2026-12-08' });
    expect(ts.status).toBe(200);
    if (ts.status === 200) await admin.post(o(`/timesheets/${ts.body.id}/approve`), {});
    const preview = (await admin.post(o('/invoices/preview'), { client_id: eur, period_start: '2026-12-01', period_end: '2026-12-31', issue_date: '2026-12-10', due_date: '2026-12-24', tax_rate_bps: 0 })).body;
    expect({ currency: preview.currency, lines: preview.lines, other: preview.other_currency_entries }).toEqual({ currency: 'EUR', lines: [], other: 1 });
  });
});

async function relogin() {
  admin.cookie = '';
  worker.cookie = '';
  expect((await admin.post('/auth/login', { email: 'ada@fin.test', password: 'correct-horse-battery' })).status).toBe(200);
  expect((await worker.post('/auth/login', { email: 'walt@fin.test', password: 'correct-horse-battery' })).status).toBe(200);
}

describe('payment references and malformed ids', () => {
  it('a reference is unique within an organization, not across organizations', async () => {
    const pay = { amount_minor: 1000, currency: 'USD', received_on: '2026-09-20', provider: 'manual', provider_ref: 'CHK-1001' };
    expect((await admin.post(o('/payments'), pay)).status).toBe(201);
    // The same cheque number again in this organization is a clear conflict, not a server error.
    const again = await admin.post(o('/payments'), pay);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('duplicate_payment');
    // Another organization may use the same reference.
    const { client: other, orgId: otherOrg } = await signup(t, 'Olga', 'olga@fin-other.test');
    expect((await other.post(`/orgs/${otherOrg}/payments`, pay)).status).toBe(201);
  });

  it('a malformed id is a 404, not a server error', async () => {
    for (const [method, path] of [
      ['GET', '/payroll/runs/abc'],
      ['GET', '/pay-stubs/abc'],
      ['GET', '/timesheets/abc/history'],
      ['POST', '/expenses/abc/approve'],
      ['DELETE', '/payments/abc'],
    ] as const) {
      const r = method === 'GET' ? await admin.get(o(path)) : method === 'POST' ? await admin.post(o(path), {}) : await admin.del(o(path));
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});
