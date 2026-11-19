import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Invoices and approved billable time with no bill rate (QA round 6, BUG-26). That time is worth 0, so
 * it is left off the invoice; the new-invoice page said "Approve timesheets first", which sent the
 * admin to approve time that was already approved. The preview now reports how much billable time has
 * no bill rate, so the page can say what to fix.
 */
const NOW = new Date('2026-11-18T15:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let clientId: string;
let walt: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const preview = () => admin.post(o('/invoices/preview'), { client_id: clientId, period_start: '2026-11-01', period_end: '2026-11-30', issue_date: '2026-11-18', due_date: '2026-12-18' });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@invoice-unpriced.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@invoice-unpriced.test');
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  // Billable work for Acme, approved, and no bill rate anywhere.
  const projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [walt.membershipId], billable_default: true })).body.id;
  const s = new Date('2026-11-04T14:00:00Z');
  expect((await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 2 * H * 1000).toISOString(), reason: 'fixture' })).status).toBe(201);
  const ts = await walt.client.post(o('/timesheets/submit'), { date: '2026-11-04' });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
}, 60_000);
afterAll(() => t.close());

describe('approved billable time with no bill rate', () => {
  it('is reported by the preview, which has nothing to invoice', async () => {
    const r = await preview();
    expect(r.status).toBe(200);
    expect(r.body.lines).toEqual([]);
    expect(r.body.unpriced_bill_seconds).toBe(2 * H);
    expect(r.body.already_invoiced).toEqual([]);
  });

  it('is invoiced once a bill rate covers it, and is no longer reported', async () => {
    expect((await admin.patch(o(`/clients/${clientId}`), { bill_rate_minor: 9000, rate_effective_from: '2026-11-01' })).status).toBe(200);
    const r = await preview();
    expect(r.body.unpriced_bill_seconds).toBe(0);
    expect(r.body.lines).toHaveLength(1);
    expect(r.body.lines[0]).toMatchObject({ kind: 'TIME', amount_minor: 2 * 9000 });
  });

  it('only the client’s own time counts, and only for those who manage its invoices', async () => {
    const other = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
    expect((await admin.post(o('/invoices/preview'), { client_id: other, period_start: '2026-11-01', period_end: '2026-11-30', issue_date: '2026-11-18', due_date: '2026-12-18' })).body.unpriced_bill_seconds).toBe(0);
    expect((await walt.client.post(o('/invoices/preview'), { client_id: clientId, period_start: '2026-11-01', period_end: '2026-11-30', issue_date: '2026-11-18', due_date: '2026-12-18' })).status).toBe(403);
  });
});
