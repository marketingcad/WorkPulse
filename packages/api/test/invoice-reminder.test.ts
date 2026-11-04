import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Sending a reminder about an invoice already sent (UX remediation, phase 4: chasing an overdue
 * invoice had to happen outside the app). It emails the client what is still due, changes nothing
 * on the invoice, and is audited. Only people who manage invoices can send one.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function invoice(clientEmail: string | null, due: string, send = true) {
  const clientId = (await admin.post<{ id: string }>(o('/clients'), { name: `Client ${Math.random().toString(36).slice(2, 7)}`, ...(clientEmail ? { email: clientEmail } : {}) })).body.id;
  // An invoice already overdue was issued before its due date (the due date cannot come first).
  const overdue = due < '2026-09-01';
  const inv = await admin.post<{ id: string; number: string }>(o('/invoices'), {
    client_id: clientId,
    period_start: overdue ? '2019-12-01' : '2026-08-01',
    period_end: overdue ? '2019-12-31' : '2026-08-31',
    issue_date: overdue ? '2019-12-31' : '2026-09-01',
    due_date: due,
    group_by: 'project',
    tax_rate_bps: 0,
    include_expenses: false,
    notes: null,
    extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 10000, tax_rate_bps: 0 }],
  });
  expect(inv.status).toBe(201);
  if (send) expect((await admin.post(o(`/invoices/${inv.body.id}/send`), {})).status).toBe(200);
  return { id: inv.body.id, number: inv.body.number, clientId };
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@remind.test', 'Remind Co'));
}, 60_000);
afterAll(() => t.close());

describe('invoice reminders', () => {
  it('emails the client what is still due, and changes nothing on the invoice', async () => {
    const inv = await invoice('ap@client.test', '2020-01-01');
    const before = (await admin.get<{ status: string; sent_at: string }>(o(`/invoices/${inv.id}`))).body;
    const sent = t.mailer.sent.length;
    const r = await admin.post<{ sent_to: string; overdue: boolean }>(o(`/invoices/${inv.id}/remind`), {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sent_to: 'ap@client.test', overdue: true });
    const mail = t.mailer.sent[sent]!;
    expect(mail.to).toBe('ap@client.test');
    expect(mail.subject).toBe(`Reminder: invoice ${inv.number} from Remind Co is overdue`);
    expect(mail.text).toContain('$100.00');
    const after = (await admin.get<{ status: string; sent_at: string }>(o(`/invoices/${inv.id}`))).body;
    expect(after.sent_at).toBe(before.sent_at);
    const logs = (await admin.get<{ data: Array<{ action: string; target_id: string }> } | Array<{ action: string; target_id: string }>>(o('/audit-logs'))).body;
    expect((Array.isArray(logs) ? logs : logs.data).some((l) => l.action === 'invoice.reminder_sent' && l.target_id === inv.id)).toBe(true);
  });

  it('asks for only the balance once part is paid', async () => {
    const inv = await invoice('pay@client.test', '2099-01-01');
    expect((await admin.post(o('/payments'), { client_id: inv.clientId, amount_minor: 4000, currency: 'USD', received_on: '2026-09-10', provider: 'manual', provider_ref: null, note: null, allocations: [{ invoice_id: inv.id, amount_minor: 4000 }] })).status).toBe(201);
    const sent = t.mailer.sent.length;
    expect((await admin.post<{ overdue: boolean }>(o(`/invoices/${inv.id}/remind`), {})).body.overdue).toBe(false);
    expect(t.mailer.sent[sent]!.text).toContain('$60.00');
  });

  it('explains when it cannot be sent: no client email, or not sent yet', async () => {
    const noEmail = await invoice(null, '2099-01-01');
    const r = await admin.post<{ code: string; title: string }>(o(`/invoices/${noEmail.id}/remind`), {});
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('client_no_email');
    const draft = await invoice('draft@client.test', '2099-01-01', false);
    expect((await admin.post<{ code: string }>(o(`/invoices/${draft.id}/remind`), {})).body.code).toBe('invoice_not_open');
  });

  it('sends at most 3 reminders a day per invoice, saying why the 4th is refused', async () => {
    const inv = await invoice('busy@client.test', '2099-01-01');
    const other = await invoice('calm@client.test', '2099-01-01');
    for (let i = 0; i < 3; i++) expect((await admin.post(o(`/invoices/${inv.id}/remind`), {})).status).toBe(200);
    const sent = t.mailer.sent.length;
    const fourth = await admin.post<{ code: string; title: string }>(o(`/invoices/${inv.id}/remind`), {});
    expect(fourth.status).toBe(422);
    expect(fourth.body.code).toBe('reminder_limit');
    expect(t.mailer.sent.length).toBe(sent);
    // Per invoice: another client's invoice is not affected.
    expect((await admin.post(o(`/invoices/${other.id}/remind`), {})).status).toBe(200);
  });

  it('is refused to people who do not manage invoices, and across organizations', async () => {
    const inv = await invoice('x@client.test', '2099-01-01');
    const { client: worker } = await addMember(t, admin, orgId, 'Walt', 'walt@remind.test');
    expect((await worker.post(o(`/invoices/${inv.id}/remind`), {})).status).toBe(403);
    const other = await signup(t, 'Olga', 'olga@remind-other.test');
    expect([403, 404]).toContain((await other.client.post(`/orgs/${other.orgId}/invoices/${inv.id}/remind`, {})).status);
  });
});
