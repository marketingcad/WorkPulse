import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderInvoicePdf } from '../src/lib/invoice-pdf';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

const NOW = new Date('2026-09-23T20:00:00Z');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let otherId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@staff.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@staff.test'));
  ({ membershipId: otherId } = await addMember(t, admin, orgId, 'Olga', 'olga@staff.test'));
});
afterAll(() => t.close());

describe('personal details', () => {
  it('admins read and write every field, including HR notes', async () => {
    const r = await admin.patch(o(`/workers/${workerId}/details`), { first_name: 'Walter', birth_date: '1990-04-02', emergency_contact_name: 'Wendy', emergency_contact_phone: '+1 555 0100', notes: 'Prefers mornings' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ first_name: 'Walter', birth_date: '1990-04-02', emergency_contact_name: 'Wendy', notes: 'Prefers mornings' });
  });

  it('members see and edit their own details but never the HR notes', async () => {
    const mine = await worker.get(o(`/workers/${workerId}/details`));
    expect(mine.status).toBe(200);
    expect(mine.body.first_name).toBe('Walter');
    expect(mine.body).not.toHaveProperty('notes');
    expect((await worker.patch(o(`/workers/${workerId}/details`), { phone: '+1 555 0199' })).body.phone).toBe('+1 555 0199');
    expect((await worker.patch(o(`/workers/${workerId}/details`), { notes: 'x' })).status).toBe(403);
  });

  it('members cannot read someone else’s details', async () => {
    expect((await worker.get(o(`/workers/${otherId}/details`))).status).toBe(403);
    expect((await worker.patch(o(`/workers/${otherId}/details`), { phone: '1' })).status).toBe(403);
  });

  it('keeps personal values out of the audit trail', async () => {
    const log = await admin.get(o('/audit-logs?action=worker.details_updated'));
    expect(log.status).toBe(200);
    expect(JSON.stringify(log.body)).toContain('worker.details_updated');
    expect(JSON.stringify(log.body)).not.toContain('Wendy');
  });
});

describe('employment and rates on the member profile', () => {
  it('sets personal pay and bill rates in the workspace currency', async () => {
    const r = await admin.patch(o(`/workers/${workerId}`), { pay_rate_minor: 2500, bill_rate_minor: 6000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pay_rate_minor: 2500, bill_rate_minor: 6000 });
    const rates = (await admin.get(o('/rates'))).body as Array<{ scope: string; scope_id: string }>;
    expect(rates.filter((x) => x.scope === 'WORKER' && x.scope_id === workerId)).toHaveLength(2);
  });

  it('does not let members change their own rates or end date', async () => {
    expect((await worker.patch(o(`/workers/${workerId}`), { pay_rate_minor: 99999 })).status).toBe(403);
    expect((await worker.patch(o(`/workers/${workerId}`), { end_date: '2026-10-01' })).status).toBe(403);
  });

  it('rejects an end date before the start date', async () => {
    expect((await admin.patch(o(`/workers/${otherId}`), { start_date: '2026-05-01', end_date: '2026-04-01' })).status).toBe(400);
  });

  it('records the date left when a member is removed and lists them as former', async () => {
    expect((await admin.del(o(`/workers/${otherId}`))).status).toBe(204);
    const all = (await admin.get(o('/workers?include_removed=true'))).body as Array<{ id: string; status: string; end_date: string | null }>;
    expect(all.find((w) => w.id === otherId)).toMatchObject({ status: 'REMOVED', end_date: '2026-09-23' });
  });
});

describe('company profile', () => {
  it('stores the profile shown on invoices', async () => {
    const r = await admin.patch(o(''), { brief: 'Remote staffing', tax_id: 'TX-123', address: '1 Main St\nSpringfield', phone: '+1 555 0000', email: 'billing@ada.test', logo: PNG, document_language: 'es' });
    expect(r.status).toBe(200);
    expect(r.body.organization).toMatchObject({ brief: 'Remote staffing', tax_id: 'TX-123', logo: PNG, document_language: 'es' });
  });

  it('only accepts PNG or JPEG logos, since they are embedded in PDFs', async () => {
    expect((await admin.patch(o(''), { logo: 'data:image/webp;base64,UklGRg==' })).status).toBe(400);
  });

  it('is forbidden to members without org:update', async () => {
    expect((await worker.patch(o(''), { tax_id: 'hijack' })).status).toBe(403);
  });

  it('renders an invoice PDF with the logo and company details', async () => {
    const pdf = await renderInvoicePdf(
      {
        number: 'INV-1',
        status: 'DRAFT',
        issue_date: '2026-09-23',
        due_date: '2026-10-07',
        period_start: null,
        period_end: null,
        currency: 'USD',
        subtotal_minor: 1000,
        tax_minor: 0,
        total_minor: 1000,
        paid_minor: 0,
        balance_minor: 1000,
        notes: null,
        client: { name: 'Acme', email: null, address: null, contact_name: 'Wile' },
        lines: [{ description: 'Work', quantity: 1, unit_price_minor: 1000, amount_minor: 1000, tax_minor: 0 }],
      },
      { name: 'Ada Org', logo: PNG, brief: 'Remote staffing', taxId: 'TX-123', address: '1 Main St', phone: null, email: 'billing@ada.test' },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Regression: a recorded payment (minus sign) and non-Latin-1 names used to make pdf-lib throw.
    const paid = await renderInvoicePdf(
      { number: 'INV-3', status: 'SENT', issue_date: '2026-09-01', due_date: '2026-09-15', period_start: null, period_end: null, currency: 'USD', subtotal_minor: 1000, tax_minor: 0, total_minor: 1000, paid_minor: 500, balance_minor: 500, notes: 'Dziękuję — 谢谢', client: { name: 'Łódź Studio', email: null, address: null }, lines: [{ description: 'Praca − część 1', quantity: 1, unit_price_minor: 1000, amount_minor: 1000, tax_minor: 0 }] },
      { name: 'Zażółć Ltd' },
    );
    expect(paid.subarray(0, 5).toString()).toBe('%PDF-');
    // A broken logo must not break the invoice.
    await expect(renderInvoicePdf({ number: 'INV-2', status: 'DRAFT', issue_date: '', due_date: '', period_start: null, period_end: null, currency: 'USD', subtotal_minor: 0, tax_minor: 0, total_minor: 0, paid_minor: 0, balance_minor: 0, notes: null, client: { name: 'A', email: null, address: null }, lines: [] }, { name: 'X', logo: 'data:image/png;base64,AAAA' })).resolves.toBeInstanceOf(Buffer);
  });
});

describe('erasure', () => {
  it('deletes personal details with the member’s other personal data', async () => {
    expect((await admin.post(o(`/workers/${workerId}/anonymize`), {})).status).toBe(200);
    const d = await admin.get(o(`/workers/${workerId}/details`));
    expect(d.body).toMatchObject({ first_name: null, birth_date: null, emergency_contact_name: null, notes: null });
  });

  // Live, 28 Oct 2026: erased members were listed as former members with no "Date left".
  it('records the date left, like removal; a member removed earlier keeps their removal date', async () => {
    const all = async () => (await admin.get(o('/workers?include_removed=true'))).body as Array<{ id: string; status: string; end_date: string | null }>;
    expect((await all()).find((w) => w.id === workerId)).toMatchObject({ status: 'REMOVED', end_date: '2026-09-23' });

    // Olga was removed on Sept 23 (above); erasing her a week later does not move her date.
    t.clock.set(new Date(NOW.getTime() + 7 * 86_400_000));
    expect((await admin.post(o(`/workers/${otherId}/anonymize`), {})).status).toBe(200);
    expect((await all()).find((w) => w.id === otherId)).toMatchObject({ status: 'REMOVED', end_date: '2026-09-23' });
    t.clock.set(NOW);
  });
});
