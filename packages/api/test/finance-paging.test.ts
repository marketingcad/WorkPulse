import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Server-side paging for invoices, payments and expenses: every record is reachable (not only the
// newest 1000), totals cover every matching record, and lists without `page` keep their old shape.
// Clock: Wednesday 2026-09-23; the organizations are in America/New_York (today = 2026-09-23).
const NOW = new Date('2026-09-23T16:00:00Z');

let t: Harness;

interface Page<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}
interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  client_name: string;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
  currency: string;
}
type InvoicePage = Page<InvoiceRow> & { summary: { counts: Record<string, number>; open_count: number; overdue_count: number; outstanding_minor: number; overdue_minor: number; collected_minor: number; currency: string } };

/** Bulk fixtures go straight to the database (as the table owner) so the tests can pass 1000 records quickly. */
async function asOwner(q: ReturnType<typeof sql>) {
  await t.h.db.execute(sql`reset role`);
  try {
    await t.h.db.execute(q);
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
});
afterAll(() => t.close());

describe('invoices', () => {
  let admin: Client;
  let orgId: string;
  let clientId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@paging.test'));
    clientId = (await admin.post<{ id: string }>(o('/clients'), { name: 'Bulk Client' })).body.id;
    // 1050 sent invoices, B-0001 (oldest) … B-1050 (newest), each 100.00 with nothing paid and due in the future.
    await asOwner(sql`
      insert into invoices (id, organization_id, client_id, number, status, issue_date, due_date, currency, subtotal_minor, total_minor, paid_minor)
      select gen_random_uuid(), ${orgId}::uuid, ${clientId}::uuid, 'B-' || lpad(n::text, 4, '0'), 'SENT',
             to_char(date '2023-01-01' + n, 'YYYY-MM-DD'), '2027-01-01', 'USD', 10000, 10000, 0
      from generate_series(1, 1050) as n`);
  });

  it('pages through every invoice, newest first, with the total', async () => {
    const first = await admin.get<InvoicePage>(o('/invoices?page=1&page_size=50'));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 1050, page: 1, page_size: 50 });
    expect(first.body.data).toHaveLength(50);
    expect(first.body.data[0]!.number).toBe('B-1050');

    const last = await admin.get<InvoicePage>(o('/invoices?page=21&page_size=50'));
    expect(last.body.data).toHaveLength(50);
    expect(last.body.data.at(-1)!.number).toBe('B-0001');
    // Past the end: no rows, same total.
    const beyond = await admin.get<InvoicePage>(o('/invoices?page=22&page_size=50'));
    expect(beyond.body).toMatchObject({ total: 1050, data: [] });

    // Pages never overlap or skip.
    const seen = new Set<string>();
    for (let page = 1; page <= 6; page++) for (const i of (await admin.get<InvoicePage>(o(`/invoices?page=${page}&page_size=200`))).body.data) seen.add(i.id);
    expect(seen.size).toBe(1050);
  });

  it('totals cover every matching invoice, not just the page', async () => {
    const r = await admin.get<InvoicePage>(o('/invoices?page=1&page_size=25'));
    expect(r.body.summary).toMatchObject({ open_count: 1050, outstanding_minor: 1050 * 10000, overdue_count: 0, collected_minor: 0, currency: 'USD' });
    expect(r.body.summary.counts).toMatchObject({ ALL: 1050, SENT: 1050 });
  });

  it('opens an invoice older than the newest 1000 (it used to be "not found")', async () => {
    const oldest = (await admin.get<InvoicePage>(o('/invoices?page=1050&page_size=1'))).body.data[0]!;
    expect(oldest.number).toBe('B-0001');
    const r = await admin.get<InvoiceRow>(o(`/invoices/${oldest.id}`));
    expect(r.status).toBe(200);
    expect(r.body.number).toBe('B-0001');
    expect((await admin.get(o('/invoices/not-a-uuid'))).status).toBe(404);
  });

  it('searches by number or client name, treating % and _ literally', async () => {
    const byNumber = await admin.get<InvoicePage>(o('/invoices?page=1&q=B-0001'));
    expect(byNumber.body.total).toBe(1);
    expect((await admin.get<InvoicePage>(o('/invoices?page=1&q=bulk%20client'))).body.total).toBe(1050);
    expect((await admin.get<InvoicePage>(o('/invoices?page=1&q=%25'))).body.total).toBe(0);
    expect((await admin.get<InvoicePage>(o('/invoices?page=1&q=B_0001'))).body.total).toBe(0);
  });

  it('without `page`, keeps returning a plain array of the newest 1000 (unchanged for API clients)', async () => {
    const r = await admin.get<InvoiceRow[]>(o('/invoices'));
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(1000);
    expect(r.body[0]!.number).toBe('B-1050');
  });

  it('refuses page sizes over 200, and people without invoice access', async () => {
    expect((await admin.get(o('/invoices?page=1&page_size=500'))).status).toBe(400);
    const { client: walt } = await addMember(t, admin, orgId, 'Walt', 'walt@paging.test');
    expect((await walt.get(o('/invoices?page=1'))).status).toBe(403);
    expect((await walt.get(o('/invoices'))).status).toBe(403);
  });
});

describe('invoice statuses', () => {
  let admin: Client;
  let orgId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await signup(t, 'Bea', 'bea@paging.test'));
    const clientId = (await admin.post<{ id: string }>(o('/clients'), { name: 'Status Client' })).body.id;
    // One invoice per case of deriveInvoiceStatus (today is 2026-09-23), plus one in another currency.
    const rows: Array<[number: string, status: string, due: string, total: number, paid: number, currency: string]> = [
      ['S-DRAFT', 'DRAFT', '2026-01-01', 100, 0, 'USD'],
      ['S-VOID', 'VOID', '2026-01-01', 100, 0, 'USD'],
      ['S-PAID', 'SENT', '2026-01-01', 100, 100, 'USD'],
      ['S-OVERPAID', 'SENT', '2026-12-01', 100, 150, 'USD'],
      ['S-OVERDUE', 'SENT', '2026-09-22', 300, 0, 'USD'],
      ['S-DUE-TODAY', 'SENT', '2026-09-23', 200, 0, 'USD'],
      ['S-PARTIAL', 'SENT', '2026-12-01', 100, 40, 'USD'],
      ['S-SENT', 'SENT', '2026-12-01', 100, 0, 'USD'],
      ['S-ZERO-PAST', 'SENT', '2026-01-01', 0, 0, 'USD'],
      ['S-EUR', 'SENT', '2026-01-01', 500, 0, 'EUR'],
    ];
    for (const [number, status, due, total, paid, currency] of rows) {
      await asOwner(sql`insert into invoices (id, organization_id, client_id, number, status, issue_date, due_date, currency, subtotal_minor, total_minor, paid_minor)
        values (gen_random_uuid(), ${orgId}::uuid, ${clientId}::uuid, ${number}, ${status}, '2026-01-01', ${due}, ${currency}, ${total}, ${total}, ${paid})`);
    }
  });

  it('filters by the same status the rows show (SQL and the domain rule agree)', async () => {
    const all = (await admin.get<InvoicePage>(o('/invoices?page=1&page_size=200'))).body;
    const statusOf = new Map(all.data.map((i) => [i.number, i.status]));
    expect(Object.fromEntries(statusOf)).toEqual({
      'S-DRAFT': 'DRAFT',
      'S-VOID': 'VOID',
      'S-PAID': 'PAID',
      'S-OVERPAID': 'PAID',
      'S-OVERDUE': 'OVERDUE',
      'S-DUE-TODAY': 'SENT',
      'S-PARTIAL': 'PARTIALLY_PAID',
      'S-SENT': 'SENT',
      'S-ZERO-PAST': 'OVERDUE',
      'S-EUR': 'OVERDUE',
    });
    for (const status of ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'VOID']) {
      const page = (await admin.get<InvoicePage>(o(`/invoices?page=1&status=${status}`))).body;
      const expected = [...statusOf].filter(([, s]) => s === status).map(([n]) => n).sort();
      expect(page.data.map((i) => i.number).sort(), status).toEqual(expected);
      expect(page.total, status).toBe(expected.length);
      expect(all.summary.counts[status], status).toBe(expected.length);
      // The array form filters the same way.
      expect((await admin.get<InvoiceRow[]>(o(`/invoices?status=${status}`))).body.map((i) => i.number).sort(), status).toEqual(expected);
    }
  });

  it('OPEN lists every invoice still waiting for money (sent, partially paid or overdue)', async () => {
    const expected = ['S-DUE-TODAY', 'S-EUR', 'S-OVERDUE', 'S-PARTIAL', 'S-SENT', 'S-ZERO-PAST'];
    expect((await admin.get<InvoiceRow[]>(o('/invoices?status=OPEN'))).body.map((i) => i.number).sort()).toEqual(expected);
    const page = (await admin.get<InvoicePage>(o('/invoices?status=OPEN&page=1'))).body;
    expect(page.total).toBe(6);
    expect(page.summary.open_count).toBe(6);
  });

  it('adds up money in the organization’s currency only', async () => {
    const s = (await admin.get<InvoicePage>(o('/invoices?page=1'))).body.summary;
    // Open: overdue 300 + due today 200 + partial 60 + sent 100 + zero 0 (USD); the EUR invoice is counted, not summed.
    expect(s).toMatchObject({ open_count: 6, overdue_count: 3, outstanding_minor: 300 + 200 + 60 + 100, overdue_minor: 300, collected_minor: 100 + 150 + 40, currency: 'USD' });
  });
});

describe('payments', () => {
  let admin: Client;
  let orgId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await signup(t, 'Cy', 'cy@paging.test'));
    await asOwner(sql`
      insert into payments (id, organization_id, provider, provider_ref, amount_minor, currency, received_on)
      select gen_random_uuid(), ${orgId}::uuid, 'manual', 'CY-REF-' || lpad(n::text, 4, '0'), 1000, 'USD', to_char(date '2023-01-01' + n, 'YYYY-MM-DD')
      from generate_series(1, 1020) as n`);
    // One payment applied to an invoice, to search by invoice number.
    const clientId = (await admin.post<{ id: string }>(o('/clients'), { name: 'Payer' })).body.id;
    const inv = await admin.post<{ id: string; number: string }>(o('/invoices'), {
      client_id: clientId,
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      issue_date: '2026-09-01',
      due_date: '2026-10-01',
      group_by: 'project',
      tax_rate_bps: 0,
      include_expenses: false,
      notes: null,
      extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 5000, tax_rate_bps: 0 }],
    });
    expect((await admin.post(o(`/invoices/${inv.body.id}/send`), {})).status).toBe(200);
    expect((await admin.post(o('/payments'), { client_id: clientId, amount_minor: 5000, currency: 'USD', received_on: '2026-09-10', provider: 'manual', provider_ref: null, note: 'wire', allocations: [{ invoice_id: inv.body.id, amount_minor: 5000 }] })).status).toBe(201);
    (globalThis as Record<string, unknown>).__invoiceNumber = inv.body.number;
  });

  it('pages through every payment, newest first', async () => {
    const r = await admin.get<Page<{ provider_ref: string | null; received_on: string }>>(o('/payments?page=1&page_size=100'));
    expect(r.body.total).toBe(1021);
    expect(r.body.data[0]!.received_on).toBe('2026-09-10');
    const last = await admin.get<Page<{ provider_ref: string | null }>>(o('/payments?page=11&page_size=100'));
    expect(last.body.data.map((p) => p.provider_ref)).toContain('CY-REF-0001');
    // The array form is unchanged.
    expect((await admin.get<unknown[]>(o('/payments'))).body).toHaveLength(1000);
  });

  it('searches the reference and the invoices a payment was applied to', async () => {
    expect((await admin.get<Page<unknown>>(o('/payments?page=1&q=CY-REF-0001'))).body.total).toBe(1);
    const number = (globalThis as Record<string, unknown>).__invoiceNumber as string;
    const byInvoice = await admin.get<Page<{ amount_minor: number }>>(o(`/payments?page=1&q=${encodeURIComponent(number)}`));
    expect(byInvoice.body.total).toBe(1);
    expect(byInvoice.body.data[0]!.amount_minor).toBe(5000);
  });

  it('the payments report covers its whole date range, not only the newest 1000', async () => {
    const r = await admin.post<{ rows: unknown[] }>(o('/reports/payments/query'), { from: '2023-01-01', to: '2023-12-31' });
    expect(r.status).toBe(200);
    // 2023-01-02 … 2023-12-31: 364 payments, all older than the newest 1000.
    expect(r.body.rows).toHaveLength(364);
  });
});

describe('expenses', () => {
  let admin: Client;
  let orgId: string;
  let adminId: string;
  let worker: Client;
  let workerId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;

  beforeAll(async () => {
    ({ client: admin, orgId } = await signup(t, 'Dee', 'dee@paging.test'));
    adminId = (await admin.get<{ membership: { id: string } }>(o(''))).body.membership.id;
    ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Wes', 'wes@paging.test'));
    // 1010 approved expenses of 10.00 for the admin, and 12 submitted ones of 5.00 for Wes.
    await asOwner(sql`
      insert into expenses (id, organization_id, membership_id, category, description, amount_minor, currency, spent_on, status)
      select gen_random_uuid(), ${orgId}::uuid, ${adminId}::uuid, 'Travel', 'Trip ' || n, 1000, 'USD', to_char(date '2023-01-01' + n, 'YYYY-MM-DD'), 'APPROVED'
      from generate_series(1, 1010) as n`);
    await asOwner(sql`
      insert into expenses (id, organization_id, membership_id, category, description, amount_minor, currency, spent_on, status)
      select gen_random_uuid(), ${orgId}::uuid, ${workerId}::uuid, 'Meals', 'Lunch ' || n, 500, 'USD', '2026-09-0' || (1 + n % 9), 'SUBMITTED'
      from generate_series(1, 12) as n`);
  });

  it('pages through every expense with per-status counts and the total amount', async () => {
    const r = await admin.get<Page<unknown> & { summary: { counts: Record<string, number>; total_minor: number } }>(o('/expenses?page=1&page_size=50'));
    expect(r.body.total).toBe(1022);
    expect(r.body.summary.counts).toMatchObject({ ALL: 1022, APPROVED: 1010, SUBMITTED: 12, REJECTED: 0, REIMBURSED: 0 });
    expect(r.body.summary.total_minor).toBe(1010 * 1000 + 12 * 500);

    const submitted = await admin.get<Page<{ status: string }> & { summary: { counts: Record<string, number>; total_minor: number } }>(o('/expenses?page=1&status=SUBMITTED'));
    expect(submitted.body.total).toBe(12);
    expect(submitted.body.summary.total_minor).toBe(12 * 500);
    // Counts per status ignore the status filter, so every tab keeps its number.
    expect(submitted.body.summary.counts.ALL).toBe(1022);
  });

  it('searches the description, category and member name', async () => {
    const get = async (q: string) => (await admin.get<Page<unknown>>(o(`/expenses?page=1&q=${encodeURIComponent(q)}`))).body.total;
    expect(await get('Trip 1010')).toBe(1);
    expect(await get('meals')).toBe(12);
    expect(await get('Wes')).toBe(12);
  });

  it('a member only sees and counts their own expenses', async () => {
    const r = await worker.get<Page<{ membership_id: string }> & { summary: { counts: Record<string, number>; total_minor: number } }>(o('/expenses?page=1&page_size=200'));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(12);
    expect(r.body.summary.counts.ALL).toBe(12);
    expect(r.body.summary.total_minor).toBe(12 * 500);
    expect(new Set(r.body.data.map((e) => e.membership_id))).toEqual(new Set([workerId]));
  });
});
