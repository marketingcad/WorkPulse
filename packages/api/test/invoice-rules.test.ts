import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Invoices and payments (QA pass, feature 16).
 *
 * - BUG-49: an invoice whose total is 0 could be created and sent. It could never be paid (a payment
 *   must be at least 1), so it turned Overdue with nothing to collect.
 * - BUG-50: a reminder called an invoice overdue by the server's UTC date, a day early west of UTC.
 * - BUG-51: recording a payment answered 201 with no body once 1,000 newer payments were visible.
 * - BUG-52: sending a reminder didn't check that the sender may manage that client's invoices.
 * - Sending an invoice twice at once emailed the client twice.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const line = (unit_price_minor: number, quantity = 1) => ({ description: 'Retainer', quantity, unit_price_minor, tax_rate_bps: 0 });

async function draft(clientId: string, extra_lines: ReturnType<typeof line>[], due = '2026-11-20') {
  return admin.post<{ id: string; number: string; total_minor: number }>(o('/invoices'), {
    client_id: clientId,
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    issue_date: '2026-11-01',
    due_date: due,
    group_by: 'project',
    tax_rate_bps: 0,
    include_expenses: false,
    notes: null,
    extra_lines,
  });
}
const newClient = async (email: string | null = 'ap@client.test') => (await admin.post<{ id: string }>(o('/clients'), { name: `Client ${Math.random().toString(36).slice(2, 7)}`, ...(email ? { email } : {}) })).body.id;

beforeAll(async () => {
  t = await createHarness();
  // 7 pm on 20 November in Los Angeles is already 21 November in UTC.
  t.clock.set(new Date('2026-11-21T03:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@invoice-rules.test', 'Pacific Co'));
  expect((await admin.patch(o(''), { timezone: 'America/Los_Angeles' })).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

describe('an invoice for nothing (BUG-49)', () => {
  it('is refused: a zero total can never be paid', async () => {
    const client = await newClient();
    const r = await draft(client, [line(0)]);
    expect(r.status).toBe(422);
    expect((await draft(client, [line(5000, 0)])).status).toBe(422);
    expect((await draft(client, [line(5000)])).status).toBe(201);
  });
});

describe('a reminder (BUG-50)', () => {
  it('calls the invoice overdue only once its due date has passed where the organization is', async () => {
    // It is 7 pm on 1 January in Los Angeles (already 2 January in UTC); the invoice is due today there.
    // Before the fix the wording used the server's real UTC date instead of the organization's.
    const saved = t.clock.now;
    t.clock.set(new Date('2026-01-02T03:00:00Z'));
    try {
      const inv = (
        await admin.post<{ id: string }>(o('/invoices'), {
          client_id: await newClient(),
          period_start: '2025-11-01',
          period_end: '2025-11-30',
          issue_date: '2025-12-01',
          due_date: '2026-01-01',
          group_by: 'project',
          tax_rate_bps: 0,
          include_expenses: false,
          notes: null,
          extra_lines: [line(10000)],
        })
      ).body;
      expect((await admin.post(o(`/invoices/${inv.id}/send`), {})).status).toBe(200);
      expect((await admin.get<{ status: string }>(o(`/invoices/${inv.id}`))).body.status).toBe('SENT');
      const before = t.mailer.sent.length;
      const r = await admin.post<{ overdue: boolean }>(o(`/invoices/${inv.id}/remind`), {});
      expect(r.status).toBe(200);
      expect(r.body.overdue).toBe(false);
      expect(t.mailer.sent[before]!.subject).not.toMatch(/overdue/);
    } finally {
      t.clock.set(saved);
    }
  });

  it('is only for those who manage that client’s invoices (BUG-52)', async () => {
    const role = await admin.post<{ id: string }>(o('/roles'), { name: 'Account lead', grants: { 'invoices:read': 'org', 'invoices:manage': 'assigned', 'projects:read': 'assigned' } });
    expect(role.status).toBe(201);
    const lead = await addMember(t, admin, orgId, 'Lena', 'lena@invoice-rules.test');
    expect((await admin.patch(o(`/workers/${lead.membershipId}`), { role_id: role.body.id })).status).toBe(200);
    const inv = (await draft(await newClient(), [line(10000)], '2026-12-31')).body;
    expect((await admin.post(o(`/invoices/${inv.id}/send`), {})).status).toBe(200);
    const sent = t.mailer.sent.length;
    expect([403, 404]).toContain((await lead.client.post(o(`/invoices/${inv.id}/remind`), {})).status);
    expect(t.mailer.sent.length).toBe(sent);
  });
});

describe('sending', () => {
  it('emails the client once, even when sent twice at once', async () => {
    const inv = (await draft(await newClient('once@client.test'), [line(10000)], '2026-12-31')).body;
    const before = t.mailer.sent.filter((m) => m.to === 'once@client.test').length;
    const results = await Promise.all([admin.post(o(`/invoices/${inv.id}/send`), {}), admin.post(o(`/invoices/${inv.id}/send`), {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(t.mailer.sent.filter((m) => m.to === 'once@client.test').length - before).toBe(1);
  });
});

describe('recording a payment in a busy organization (BUG-51)', () => {
  it('answers with the new payment, even with more than 1,000 newer ones', async () => {
    const client = await newClient();
    const inv = (await draft(client, [line(10000)], '2026-12-31')).body;
    expect((await admin.post(o(`/invoices/${inv.id}/send`), {})).status).toBe(200);
    await withSystem(t.h.db, async (tx) => {
      await tx.execute(sql`
        insert into payments (id, organization_id, provider, amount_minor, currency, received_on)
        select gen_random_uuid(), ${orgId}::uuid, 'bank_transfer', 100, 'USD', '2026-11-19'
        from generate_series(1, 1005)`);
    });
    const r = await admin.post<{ id: string; amount_minor: number }>(o('/payments'), { client_id: client, provider: 'bank_transfer', amount_minor: 4000, currency: 'USD', received_on: '2026-01-15', allocations: [{ invoice_id: inv.id, amount_minor: 4000 }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ amount_minor: 4000 });
    expect(r.body.id).toBeTruthy();
  });
});
