import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Time off (QA pass, feature 13).
 *
 * - BUG-60: an approver could cancel approved time off that a finalized payroll had already paid. The
 *   hours went back to the worker's balance and the pay stayed: paid twice for the same days.
 * - BUG-61: approving didn't check the balance again. An adjustment or another approval since the
 *   request could leave too little, and approving took the balance below zero.
 * - BUG-62: "Half day" on a request of several days was accepted and silently ignored: full days were
 *   charged.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const policy = async (name: string, members: string[], accrual: object = { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval = true) =>
  (await admin.post<{ id: string }>(o('/time-off/policies'), { name, accrual, requires_approval, applies_to_all: false, member_ids: members })).body.id;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-02T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@time-off-rules.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
}, 60_000);
afterAll(() => t.close());

describe('cancelling time off a payroll has paid (BUG-60)', () => {
  it('is refused once the payroll is finalized, and allowed before', async () => {
    const ana = await addMember(t, admin, orgId, 'Ana', 'ana@time-off-rules.test');
    expect((await admin.patch(o(`/workers/${ana.membershipId}`), { pay_rate_minor: 2000 })).status).toBe(200);
    const pol = await policy('PTO Ana', [ana.membershipId], undefined, false);
    const req = await ana.client.post<{ id: string; status: string }>(o('/time-off/requests'), { policy_id: pol, start_date: '2026-10-13', end_date: '2026-10-14' });
    expect(req.body.status).toBe('APPROVED');
    const prof = await admin.post<{ id: string }>(o('/payroll/profiles'), { name: 'Monthly', period: { type: 'monthly' }, currency: 'USD', member_ids: [ana.membershipId] });
    const run = await admin.post<{ id: string; lines: Array<{ membership_id: string; time_off_hours: number }> }>(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-10-15' });
    expect(run.status).toBe(201);
    expect(run.body.lines.find((l) => l.membership_id === ana.membershipId)?.time_off_hours).toBe(16);
    const fin = await admin.post<{ status: string }>(o(`/payroll/runs/${run.body.id}/finalize`), { confirm_unpriced: true });
    expect(fin.body.status).toBe('FINALIZED');

    const cancel = await admin.post(o(`/time-off/requests/${req.body.id}/cancel`), {});
    expect(cancel.status).toBe(422);
    expect(cancel.body.code).toBe('time_off_paid');
    const still = (await admin.get<Array<{ id: string; status: string }>>(o(`/time-off/requests?membership_ids=${ana.membershipId}`))).body;
    expect(still.find((r) => r.id === req.body.id)?.status).toBe('APPROVED');
  });

  it('is allowed when no finalized payroll has paid it', async () => {
    const bo = await addMember(t, admin, orgId, 'Bo', 'bo@time-off-rules.test');
    const pol = await policy('PTO Bo', [bo.membershipId], undefined, false);
    const req = await bo.client.post<{ id: string }>(o('/time-off/requests'), { policy_id: pol, start_date: '2026-10-20', end_date: '2026-10-20' });
    expect((await admin.post(o(`/time-off/requests/${req.body.id}/cancel`), {})).status).toBeLessThan(300);
  });
});

describe('approving (BUG-61)', () => {
  it('checks the balance again', async () => {
    const cy = await addMember(t, admin, orgId, 'Cy', 'cy@time-off-rules.test');
    const pol = await policy('Vacation Cy', [cy.membershipId], { type: 'annual', amountHours: 0, maxBalanceHours: null, carryOverHours: null });
    expect((await admin.post(o('/time-off/balances/adjust'), { policy_id: pol, membership_id: cy.membershipId, hours: 8, note: 'grant' })).status).toBeLessThan(300);
    const req = await cy.client.post<{ id: string }>(o('/time-off/requests'), { policy_id: pol, start_date: '2026-11-10', end_date: '2026-11-10' });
    expect(req.status).toBe(201);
    // The balance is taken back before the decision.
    expect((await admin.post(o('/time-off/balances/adjust'), { policy_id: pol, membership_id: cy.membershipId, hours: -8, note: 'correction' })).status).toBeLessThan(300);
    const approve = await admin.post(o(`/time-off/requests/${req.body.id}/approve`), {});
    expect(approve.status).toBe(422);
    expect(approve.body.code).toBe('insufficient_balance');
  });
});

describe('a half day (BUG-62)', () => {
  it('is one day: on a longer request it is refused, not ignored', async () => {
    const di = await addMember(t, admin, orgId, 'Di', 'di@time-off-rules.test');
    const pol = await policy('PTO Di', [di.membershipId]);
    const long = await di.client.post(o('/time-off/requests'), { policy_id: pol, start_date: '2026-11-16', end_date: '2026-11-18', half_day: true });
    expect(long.status).toBe(400);
    const one = await di.client.post<{ hours: number }>(o('/time-off/requests'), { policy_id: pol, start_date: '2026-11-16', end_date: '2026-11-16', half_day: true });
    expect(one.status).toBe(201);
    expect(one.body.hours).toBe(4);
  });
});
