import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * QA audit 13 Nov 2026, round 5 (isolated environment), Phase 9:
 * - BUG-21 / C-17: the invoice email left out the tax, had no PDF, and replies went to the no-reply sender.
 * - BUG-19: a client invited while the portal is off got a bare "dashboard not found".
 * Clock: Wednesday 2026-09-23 (America/New_York).
 */
const NOW = new Date('2026-09-23T20:00:00Z');
const PASSWORD = 'correct-horse-battery';

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let clientId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p9.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@p9.test'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD', email: 'billing@acme.test' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [workerId], billable_default: true })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  const s = new Date('2026-09-08T13:00:00Z');
  expect((await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 3600_000).toISOString(), reason: 'fixture' })).status).toBe(201);
  const ts = await worker.post(o('/timesheets/submit'), { date: '2026-09-08' });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
});
afterAll(() => t.close());

const lastMailTo = (to: string) => [...t.mailer.sent].reverse().find((m) => m.to === to)!;
async function draft(extra: object = {}) {
  const r = await admin.post(o('/invoices'), { client_id: clientId, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-07', tax_rate_bps: 1000, ...extra });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string; subtotal_minor: number; tax_minor: number; total_minor: number };
}

describe('the invoice email (BUG-21, C-17)', () => {
  let inv: { id: string; number: string };

  it('shows the subtotal and the tax before the amount due, so it adds up', async () => {
    inv = await draft({ extra_lines: [{ description: 'Setup fee', quantity: 1, unit_price_minor: 5000, tax_rate_bps: 1000 }] });
    expect((await admin.post(o(`/invoices/${inv.id}/send`), {})).status).toBe(200);
    const m = lastMailTo('billing@acme.test');
    expect(m.subject).toBe(`Invoice ${inv.number} from Ada's Org`);
    // $100 of time + $50 fee = $150; 10% tax = $15; $165 due.
    expect(m.text).toContain('Subtotal: $150.00');
    expect(m.text).toContain('Tax: $15.00');
    expect(m.text).toContain('Amount due: $165.00');
    expect(m.text.indexOf('Tax: $15.00')).toBeLessThan(m.text.indexOf('Amount due'));
  });

  it('attaches the invoice as a PDF', async () => {
    const m = lastMailTo('billing@acme.test');
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0]!.filename).toBe(`${inv.number}.pdf`);
    expect(m.attachments![0]!.contentType).toBe('application/pdf');
    expect(m.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('without an organization email, says replies are not read and sets no Reply-To', () => {
    const m = lastMailTo('billing@acme.test');
    expect(m.replyTo).toBeUndefined();
    expect(m.text).toContain('replies to this email are not read');
  });

  it('with an organization email, replies go there', async () => {
    expect((await admin.patch(o(''), { email: 'accounts@adas-org.test' })).status).toBe(200);
    expect((await admin.post(o(`/invoices/${inv.id}/remind`), {})).status).toBe(200);
    const m = lastMailTo('billing@acme.test');
    expect(m.subject).toMatch(/^Reminder: invoice/);
    expect(m.replyTo).toBe('accounts@adas-org.test');
    expect(m.text).toContain('Reply to this email to reach');
    // The reminder carries the PDF too.
    expect(m.attachments?.[0]?.filename).toBe(`${inv.number}.pdf`);
  });

  it('with no tax, no subtotal or tax lines', async () => {
    const r = await admin.post(o('/clients'), { name: 'Zero Tax', currency: 'USD', email: 'zero@tax.test' });
    const inv0 = await admin.post(o('/invoices'), { client_id: r.body.id, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-09-23', due_date: '2026-10-07', tax_rate_bps: 0, extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 20000, tax_rate_bps: 0 }] });
    expect((await admin.post(o(`/invoices/${inv0.body.id}/send`), {})).status).toBe(200);
    const m = lastMailTo('zero@tax.test');
    expect(m.text).not.toContain('Subtotal');
    expect(m.text).not.toContain('Tax:');
    expect(m.text).toContain('Amount due: $200.00');
  });
});

describe('a client portal that is off (BUG-19)', () => {
  let viewer: Client;
  let accessId: string;

  it('the invited viewer is told it is not switched on yet, not "not found"', async () => {
    const off = await admin.get(o(`/clients/${clientId}/portal`));
    expect(off.body.enabled).toBe(false);
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'carla@acme.test', name: 'Carla' });
    viewer = new Client(t);
    const r = await viewer.post('/portal/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token'), name: 'Carla', password: PASSWORD });
    expect(r.status).toBe(200);
    accessId = r.body.access_id;
    const s = await viewer.get(`/portal/${accessId}/summary?from=2026-09-01&to=2026-09-30`);
    expect([s.status, s.body.code]).toEqual([404, 'portal_off']);
  });

  it('opens once the portal is switched on', async () => {
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(200);
    expect((await viewer.get(`/portal/${accessId}/summary?from=2026-09-01&to=2026-09-30`)).status).toBe(200);
  });

  it('reveals nothing to anyone without their own access', async () => {
    const stranger = new Client(t);
    await stranger.post('/auth/signup', { name: 'Sam', email: 'sam@p9.test', password: PASSWORD, organization_name: 'Sam Co', timezone: 'UTC' });
    const r = await stranger.get(`/portal/${accessId}/summary?from=2026-09-01&to=2026-09-30`);
    expect([r.status, r.body.code]).toEqual([404, 'dashboard_not_found']);
    // Off again: a stranger still gets the plain answer, the viewer the explained one.
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: false })).status).toBe(200);
    expect((await stranger.get(`/portal/${accessId}/summary`)).body.code).toBe('dashboard_not_found');
    expect((await viewer.get(`/portal/${accessId}/summary`)).body.code).toBe('portal_off');
  });
});
