import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clock: Wednesday 2026-09-23 (America/New_York).
const NOW = new Date('2026-09-23T20:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let bea: Client;
let beaId: string;
let acme: string;
let euro: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const range = '?from=2026-09-01&to=2026-09-30';

async function addTime(membershipId: string, projectId: string, start: string, seconds: number) {
  const s = new Date(start);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}
const rate = async (body: object) => expect((await admin.post(o('/rates'), { effective_from: '2020-01-01', ...body })).status).toBe(201);

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@insights.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@insights.test'));
  ({ client: bea, membershipId: beaId } = await addMember(t, admin, orgId, 'Bea', 'bea@insights.test'));
  acme = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id;
  euro = (await admin.post(o('/clients'), { name: 'Euro GmbH', currency: 'EUR' })).body.id;
  const members = [waltId, beaId];
  const pA = (await admin.post(o('/projects'), { name: 'Site', client_id: acme, member_ids: members, billable_default: true })).body.id;
  const pB = (await admin.post(o('/projects'), { name: 'Internal', member_ids: members, billable_default: false })).body.id;
  const pC = (await admin.post(o('/projects'), { name: 'Euro work', client_id: euro, member_ids: members, billable_default: true })).body.id;
  await rate({ kind: 'PAY', scope: 'WORKER', scope_id: waltId, amount_minor: 2000, currency: 'USD' });
  await rate({ kind: 'PAY', scope: 'CLIENT', scope_id: acme, amount_minor: 1500, currency: 'USD' });
  await rate({ kind: 'BILL', scope: 'CLIENT', scope_id: acme, amount_minor: 10000, currency: 'USD' });
  await rate({ kind: 'BILL', scope: 'CLIENT', scope_id: euro, amount_minor: 5000, currency: 'EUR' });
  await addTime(waltId, pA, '2026-09-21T13:00:00Z', 2 * H);
  await addTime(waltId, pB, '2026-09-21T16:00:00Z', 1 * H);
  await addTime(beaId, pA, '2026-09-21T13:00:00Z', 1 * H);
  await addTime(beaId, pC, '2026-09-21T15:00:00Z', 1 * H);
  const pol = (await admin.post(o('/time-off/policies'), { name: 'Leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
  expect((await bea.post(o('/time-off/requests'), { policy_id: pol, start_date: '2026-09-22', end_date: '2026-09-22' })).status).toBe(201);
  await t.flush();
});
afterAll(() => t.close());

describe('insights', () => {
  it('totals time, wage and billable amount from the effective rates', async () => {
    const r = await admin.get(o(`/insights${range}`));
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({
      logged_seconds: 5 * H,
      billable_seconds: 4 * H,
      // Walt: own pay rate on all 3h. Bea: the Acme client pay rate on 1h; no rate for Euro work.
      pay_minor: 3 * 2000 + 1500,
      // Acme bill rate on 3 billable hours; the EUR-priced hour is left out.
      bill_minor: 3 * 10000,
      days_off: 1,
      people_with_time: 2,
    });
    expect(r.body.other_currency).toBe(true);
  });

  it('breaks time down per person, client, project and day', async () => {
    const r = (await admin.get(o(`/insights${range}`))).body;
    expect(r.members.find((m: { membership_id: string }) => m.membership_id === waltId)).toMatchObject({ logged_seconds: 3 * H, billable_seconds: 2 * H, pay_minor: 6000, bill_minor: 20000, days_off: 0 });
    expect(r.members.find((m: { membership_id: string }) => m.membership_id === beaId)).toMatchObject({ logged_seconds: 2 * H, pay_minor: 1500, bill_minor: 10000, days_off: 1 });
    // The admin is listed too, with no time.
    expect(r.members).toHaveLength(3);
    expect(r.by_client.find((c: { client_id: string | null }) => c.client_id === acme)).toMatchObject({ name: 'Acme', seconds: 3 * H, bill_minor: 30000 });
    expect(r.by_client.find((c: { client_id: string | null }) => c.client_id === null)).toMatchObject({ name: 'No client', seconds: H });
    expect(r.by_project).toHaveLength(3);
    expect(r.by_day).toHaveLength(30);
    expect(r.by_day.find((d: { date: string }) => d.date === '2026-09-21')).toMatchObject({ seconds: 5 * H, billable_seconds: 4 * H, pay_minor: 7500, bill_minor: 30000 });
  });

  it('shows members only their own time and no money', async () => {
    const r = await walt.get(o(`/insights${range}`));
    expect(r.status).toBe(200);
    expect(r.body.money_visible).toBe(false);
    expect(r.body.members.map((m: { membership_id: string }) => m.membership_id)).toEqual([waltId]);
    expect(r.body.totals).toMatchObject({ logged_seconds: 3 * H, pay_minor: null, bill_minor: null });
    // Asking for someone else narrows to nothing rather than leaking their time.
    const other = await walt.get(o(`/insights${range}&membership_ids=${beaId}`));
    expect(other.body.totals.logged_seconds).toBe(0);
  });

  it('feeds the month summary and hours-by-client dashboard widgets', async () => {
    const r = await admin.get(o('/dashboard/widgets?keys=month_summary,hours_by_client'));
    expect(r.status).toBe(200);
    expect(r.body.month_summary).toMatchObject({ from: '2026-09-01', to: '2026-09-30', totals: { logged_seconds: 5 * H, bill_minor: 30000 } });
    expect(r.body.hours_by_client[0]).toMatchObject({ name: 'Acme', seconds: 3 * H });
    expect((await walt.get(o('/dashboard/widgets?keys=month_summary'))).body.month_summary.totals).toMatchObject({ logged_seconds: 3 * H, pay_minor: null });
  });

  it('validates the range', async () => {
    expect((await admin.get(o('/insights?from=2026-09-30&to=2026-09-01'))).status).toBe(400);
  });

  it('prices client-level pay rates in the amounts-owed estimate too', async () => {
    const r = await admin.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'));
    expect(r.status).toBe(200);
    expect(r.body.find((w: { membership_id: string }) => w.membership_id === beaId).estimated_amount_minor).toBe(1500);
  });
});
