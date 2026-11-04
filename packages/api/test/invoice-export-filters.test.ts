import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

/**
 * Exporting the invoice list gives the invoices the list shows (UX remediation, phase 4): the
 * client and search filters used to be dropped, so the file held every client's invoices.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function invoice(clientName: string) {
  const clientId = (await admin.post<{ id: string }>(o('/clients'), { name: clientName })).body.id;
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
    extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 10000, tax_rate_bps: 0 }],
  });
  expect(inv.status).toBe(201);
  return { id: inv.body.id, number: inv.body.number, clientId };
}

const numbers = async (params: Record<string, unknown>) => {
  const r = await admin.post<{ rows: Array<{ number: string }> }>(o('/reports/invoices/query'), { from: '2026-09-01', to: '2026-09-30', ...params });
  expect(r.status).toBe(200);
  return r.body.rows.map((x) => x.number).sort();
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@export.test', 'Export Co'));
}, 60_000);
afterAll(() => t.close());

describe('invoice export filters', () => {
  it('keeps only the chosen client, and only invoices matching the search', async () => {
    const acme = await invoice('Acme Ltd');
    const globex = await invoice('Globex');
    expect(await numbers({})).toEqual([acme.number, globex.number].sort());
    expect(await numbers({ client_ids: [acme.clientId] })).toEqual([acme.number]);
    expect(await numbers({ q: 'glob' })).toEqual([globex.number]);
    expect(await numbers({ q: globex.number })).toEqual([globex.number]);
    expect(await numbers({ client_ids: [acme.clientId], q: 'glob' })).toEqual([]);

    // The downloaded file is built from the same filtered rows.
    const csv = await admin.post<string>(o('/reports/invoices/export'), { from: '2026-09-01', to: '2026-09-30', client_ids: [acme.clientId], format: 'CSV' });
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('Acme Ltd');
    expect(String(csv.body)).not.toContain('Globex');
  });
});
