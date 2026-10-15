import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

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

// Workers use the desktop app only, so their pay stubs come through the device own-data API.
describe('pay stubs on the desktop app', () => {
  async function device(member: Client, name: string): Promise<Client> {
    const { verifier, challenge } = pkce();
    const code = await member.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const c = new Client(t);
    c.bearer = (await c.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name, platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
    return c;
  }
  const pdf = (c: Client, id: string) => t.app.request(`/api/v1/agent/me/pay-stubs/${id}/pdf`, { headers: { Authorization: `Bearer ${c.bearer}` } });

  it('lists only the bound worker’s own stubs and serves the PDF', async () => {
    const waltDevice = await device(walt, 'Walt-PC');
    const mine = (await waltDevice.get('/agent/me/pay-stubs')).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ membership_id: waltId, status: 'PAID', net_minor: 6300 });
    const r = await pdf(waltDevice, mine[0].id);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('never opens another member’s stub, even from an admin’s device', async () => {
    const waltStub = (await walt.get(o('/me/pay-stubs'))).body[0].id;
    const beaDevice = await device(bea, 'Bea-PC');
    expect((await beaDevice.get('/agent/me/pay-stubs')).body.map((s: { membership_id: string }) => s.membership_id)).toEqual([beaId]);
    expect((await pdf(beaDevice, waltStub)).status).toBe(404);
    // The admin holds payroll:read on the web, but a device is narrowed to its own data.
    expect((await admin.get(o(`/pay-stubs/${waltStub}`))).status).toBe(200);
    expect((await pdf(await device(admin, 'Ada-PC'), waltStub)).status).toBe(404);
  });

  it('rejects malformed ids and requests without a device token', async () => {
    const waltDevice = await device(walt, 'Walt-Laptop');
    expect((await pdf(waltDevice, 'not-a-uuid')).status).toBe(404);
    expect((await walt.get('/agent/me/pay-stubs')).status).toBe(401);
  });
});

// Each approved entry records the pay stub that paid it, so time approved after its payroll was
// finalized is paid by the next one, and no time is paid twice (audit BE-1, BE-2).
describe('paid time is tracked per entry', () => {
  let octId: string;
  const waltLine = (run: { lines: Array<{ membership_id: string }> }) => run.lines.find((l) => l.membership_id === waltId) as unknown as Record<string, number>;

  it('time approved after its payroll was finalized is carried into the next payroll', async () => {
    // September is finalized and paid (above). October's draft starts with nothing approved for Walt.
    const oct = await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-10-15' });
    expect(oct.status).toBe(201);
    octId = oct.body.id;
    expect(oct.body.period_start).toBe('2026-10-01');
    expect(waltLine(oct.body)).toMatchObject({ approved_seconds: 0, carried_seconds: 0 });

    // Walt's last September week (1 h on 2026-09-22) is approved only now.
    const ts = await walt.post(o('/timesheets/submit'), { date: '2026-09-22' });
    expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);

    // The draft no longer matches what is approved, so it cannot be finalized as is.
    const stale = await admin.post(o(`/payroll/runs/${octId}/finalize`), {});
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('payroll_stale');

    const recalculated = await admin.post(o(`/payroll/runs/${octId}/recalculate`), {});
    expect(waltLine(recalculated.body)).toMatchObject({ approved_seconds: 1 * H, carried_seconds: 1 * H, time_pay_minor: 2000 });
    expect((await admin.post(o(`/payroll/runs/${octId}/finalize`), {})).body.status).toBe('FINALIZED');
  });

  it('never pays the same time twice', async () => {
    const nov = await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-11-15' });
    expect(nov.status).toBe(201);
    expect(waltLine(nov.body)).toMatchObject({ approved_seconds: 0, carried_seconds: 0, time_pay_minor: 0 });
    expect((await admin.del(o(`/payroll/runs/${nov.body.id}`))).status).toBe(204);
  });

  it('refuses a payroll whose period overlaps one that exists (for example after the pay period changes)', async () => {
    expect((await admin.patch(o(`/payroll/profiles/${profileId}`), { name: 'Monthly USD', period: { type: 'weekly' }, currency: 'USD', member_ids: [waltId, beaId] })).status).toBe(200);
    const r = await admin.post(o('/payroll/runs'), { profile_id: profileId, date: '2026-09-29' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('payroll_overlap');
    await admin.patch(o(`/payroll/profiles/${profileId}`), { name: 'Monthly USD', period: { type: 'monthly' }, currency: 'USD', member_ids: [waltId, beaId] });
  });

  it('a timesheet whose time was paid cannot be reopened', async () => {
    const ts = (await admin.get<{ id: string; status: string }>(o(`/timesheets?membership_id=${waltId}&date=2026-09-08`))).body;
    expect(ts.status).toBe('APPROVED');
    const r = await admin.post(o(`/timesheets/${ts.id}/reopen`), { comment: 'fix' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('timesheet_paid');
  });

  it('the migration backfill links exactly the time a finalized payroll paid', async () => {
    // Undo the links for September, then run the backfill from migration 0020.
    const run = async (q: ReturnType<typeof sql>) => withSystem(t.deps.db, (tx) => tx.execute(q));
    await run(sql`update billing_entries set payroll_line_id = null where local_date between '2026-09-01' and '2026-09-30'`);
    const file = readFileSync(new URL('../../db/migrations/0020_payroll_paid_time.sql', import.meta.url), 'utf8');
    const backfill = file.split('--> statement-breakpoint').find((s) => s.includes('UPDATE "billing_entries"'))!;
    await run(sql.raw(backfill));
    const rows = await run(sql`select local_date, (payroll_line_id is not null) as linked from billing_entries where membership_id = ${waltId} and voided_at is null order by local_date`);
    // 2026-09-08 was paid by September; 2026-09-22 was approved after September was finalized, so the
    // backfill leaves it alone (in this test it was in fact paid by October, which the backfill can't know).
    expect((rows as unknown as { rows: Array<{ local_date: string; linked: boolean }> }).rows.map((r) => [r.local_date, r.linked])).toEqual([
      ['2026-09-08', true],
      ['2026-09-22', false],
    ]);
  });
});
