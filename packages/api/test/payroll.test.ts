import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clock: Friday 2026-10-02 (America/New_York); the last completed monthly period is September.
const NOW = new Date('2026-10-02T15:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let bea: Client;
let beaId: string;
let profileId: string;
let runId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@payroll.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@payroll.test'));
  ({ client: bea, membershipId: beaId } = await addMember(t, admin, orgId, 'Bea', 'bea@payroll.test'));
  const projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [waltId, beaId], billable_default: true })).body.id;
  await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: waltId, amount_minor: 2000, currency: 'USD', effective_from: '2020-01-01' });
  await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: beaId, amount_minor: 1500, currency: 'USD', effective_from: '2020-01-01' });
  const add = async (start: string, secs: number) => {
    const s = new Date(start);
    expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + secs * 1000).toISOString(), reason: 'fixture' })).status).toBe(201);
  };
  await add('2026-09-08T13:00:00Z', 3 * H); // approved below
  await add('2026-09-22T13:00:00Z', 1 * H); // never approved
  const ts = await walt.post(o('/timesheets/submit'), { date: '2026-09-08' });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  const pol = (await admin.post(o('/time-off/policies'), { name: 'Vacation', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
  expect((await bea.post(o('/time-off/requests'), { policy_id: pol, start_date: '2026-09-15', end_date: '2026-09-15' })).status).toBe(201);
  await t.flush();
});
afterAll(() => t.close());

describe('payroll profiles and bank details', () => {
  it('creates a profile with members', async () => {
    const r = await admin.post(o('/payroll/profiles'), { name: 'Monthly USD', period: { type: 'monthly' }, currency: 'USD', member_ids: [waltId, beaId] });
    expect(r.status).toBe(201);
    profileId = r.body.id;
    expect(r.body.members.map((m: { name: string }) => m.name).sort()).toEqual(['Bea', 'Walt']);
  });

  it('allows only one profile per currency for a member', async () => {
    const r = await admin.post(o('/payroll/profiles'), { name: 'Weekly USD', period: { type: 'weekly' }, currency: 'USD', member_ids: [waltId] });
    expect(r.body.code).toBe('payroll_profile_currency');
    expect((await admin.post(o('/payroll/profiles'), { name: 'Weekly EUR', period: { type: 'weekly' }, currency: 'EUR', member_ids: [waltId] })).status).toBe(201);
  });

  it('keeps bank details private and encrypted', async () => {
    const put = await walt.put(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`), { type: 'bank', bank_name: 'First Bank', account_name: 'Walt', account_number: '1234567890', routing_number: '021000021' });
    expect(put.status).toBe(200);
    expect((await admin.get(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`))).body.account_number).toBe('1234567890');
    expect((await bea.get(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`))).status).toBe(403);
    const list = await admin.get(o('/payroll/profiles'));
    expect(JSON.stringify(list.body)).not.toContain('1234567890');
    expect(list.body.find((p: { id: string }) => p.id === profileId).members.find((m: { membership_id: string }) => m.membership_id === waltId).bank).toMatchObject({ bank_name: 'First Bank', account_last4: '7890' });
    const raw = await withSystem(t.deps.db, (tx) => tx.execute<{ enc: string }>(sql`select bank_details_enc as enc from payroll_profile_members where membership_id = ${waltId} and profile_id = ${profileId}`));
    const enc = (raw as unknown as { rows: Array<{ enc: string }> }).rows[0]!.enc;
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('1234567890');
  });
});

describe('payroll runs', () => {
  it('pays approved time and paid time off for the last completed period', async () => {
    const r = await admin.post(o('/payroll/runs'), { profile_id: profileId });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect(r.body).toMatchObject({ period_start: '2026-09-01', period_end: '2026-09-30', status: 'DRAFT', gross_minor: 3 * 2000 + 8 * 1500 });
    const w = r.body.lines.find((l: { membership_id: string }) => l.membership_id === waltId);
    expect(w).toMatchObject({ approved_seconds: 3 * H, unapproved_seconds: 1 * H, time_pay_minor: 6000, gross_minor: 6000 });
    const b = r.body.lines.find((l: { membership_id: string }) => l.membership_id === beaId);
    expect(b).toMatchObject({ time_off_hours: 8, time_off_pay_minor: 12000, gross_minor: 12000 });
  });

  it('refuses a second payroll for the same period', async () => {
    expect((await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-09-15' })).body.code).toBe('payroll_exists');
  });

  it('applies bonuses and deductions to the net', async () => {
    const run = (await admin.get(o(`/payroll/runs/${runId}`))).body;
    const line = run.lines.find((l: { membership_id: string }) => l.membership_id === waltId);
    const r = await admin.put(o(`/payroll/runs/${runId}/lines/${line.id}/adjustments`), { adjustments: [{ label: 'Bonus', amount_minor: 500 }, { label: 'Equipment', amount_minor: -200 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ adjustments_minor: 300, net_minor: 18000 + 300 });
    // Recalculating a draft keeps the adjustments.
    expect((await admin.post(o(`/payroll/runs/${runId}/recalculate`), {})).body.net_minor).toBe(18300);
  });

  it('hides draft stubs from members, then publishes them on finalize', async () => {
    expect((await walt.get(o('/me/pay-stubs'))).body).toEqual([]);
    const draftLine = (await admin.get(o(`/payroll/runs/${runId}`))).body.lines.find((l: { membership_id: string }) => l.membership_id === waltId);
    expect((await walt.get(o(`/pay-stubs/${draftLine.id}`))).status).toBe(404);
    expect((await admin.post(o(`/payroll/runs/${runId}/finalize`), {})).body.status).toBe('FINALIZED');
    const mine = (await walt.get(o('/me/pay-stubs'))).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ net_minor: 6300, adjustments: [{ label: 'Bonus', amount_minor: 500 }, { label: 'Equipment', amount_minor: -200 }] });
    const pdf = await t.app.request(`/api/v1/orgs/${orgId}/pay-stubs/${mine[0].id}/pdf`, { headers: { Cookie: walt.cookie } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    // Bea cannot open Walt's stub.
    expect((await bea.get(o(`/pay-stubs/${mine[0].id}`))).status).toBe(404);
  });

  it('locks a finalized payroll, then records payment', async () => {
    expect((await admin.post(o(`/payroll/runs/${runId}/recalculate`), {})).body.code).toBe('payroll_run_status');
    expect((await admin.del(o(`/payroll/runs/${runId}`))).body.code).toBe('payroll_run_status');
    expect((await admin.post(o(`/payroll/runs/${runId}/paid`), {})).body.status).toBe('PAID');
  });

  it('is only visible to payroll readers', async () => {
    expect((await walt.get(o('/payroll/runs'))).status).toBe(403);
    expect((await walt.post(o('/payroll/runs'), { profile_id: profileId })).status).toBe(403);
    expect((await admin.get(o('/payroll/runs?year=2026'))).body).toHaveLength(1);
  });
});
