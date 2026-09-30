import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWorkforceAlerts } from '../src/jobs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clock: Wednesday 2026-09-23, 16:00 in America/New_York.
const NOW = new Date('2026-09-23T20:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const settings = (s: object) => admin.patch(o(''), { settings: s });

async function manual(c: Client, start: string, seconds: number, extra: object = {}) {
  const s = new Date(start);
  return c.post(o('/manual-time'), { project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture', ...extra });
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@rules.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@rules.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [waltId], billable_default: true })).body.id;
});
afterAll(() => t.close());

describe('lock time entries', () => {
  let oldEntry: string;

  beforeAll(async () => {
    expect((await settings({ lockAfterDays: 3 })).status).toBe(200);
    // A manager may still add time on a locked day.
    const r = await manual(admin, '2026-09-18T13:00:00Z', H, { membership_id: waltId });
    expect(r.status).toBe(201);
    const entries = (await admin.get(o(`/time-entries?from=2026-09-18&to=2026-09-18&membership_ids=${waltId}`))).body;
    oldEntry = entries[0].id;
  });

  it('stops members adding time on days older than the lock', async () => {
    const r = await manual(walt, '2026-09-18T15:00:00Z', H);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.code).toBe('time_entries_locked');
    expect((await manual(walt, '2026-09-21T13:00:00Z', H)).status).toBe(201);
  });

  it('stops members editing or deleting their own locked time, and shows it as locked', async () => {
    expect((await walt.patch(o(`/time-entries/${oldEntry}`), { note: 'x' })).body.code).toBe('time_entries_locked');
    expect((await walt.post(o(`/time-entries/${oldEntry}/delete`), {})).status).toBeGreaterThanOrEqual(400);
    const mine = (await walt.get(o('/time-entries?from=2026-09-18&to=2026-09-18'))).body;
    expect(mine[0].locked).toBe(true);
    const asAdmin = (await admin.get(o(`/time-entries?from=2026-09-18&to=2026-09-18&membership_ids=${waltId}`))).body;
    expect(asAdmin[0].locked).toBe(false);
  });

  it('supports a fixed lock date', async () => {
    await settings({ lockAfterDays: null, lockBeforeDate: '2026-09-22' });
    expect((await manual(walt, '2026-09-21T16:00:00Z', 60 * 30)).body.code).toBe('time_entries_locked');
    expect((await manual(walt, '2026-09-22T13:00:00Z', 60 * 30)).status).toBe(201);
    await settings({ lockBeforeDate: null });
  });
});

describe('time types', () => {
  let overtime: string;

  beforeAll(async () => {
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: waltId, amount_minor: 2000, currency: 'USD', effective_from: '2020-01-01' });
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' });
    const r = await admin.post(o('/time-types'), { name: 'Overtime', short_name: 'O', pay_coefficient: 1.5, bill_coefficient: 2 });
    expect(r.status).toBe(201);
    overtime = r.body.id;
  });

  it('only lets admins manage time types, but everyone can list them', async () => {
    expect((await walt.post(o('/time-types'), { name: 'X', short_name: 'X', pay_coefficient: 1, bill_coefficient: 1 })).status).toBe(403);
    expect((await walt.get(o('/time-types'))).body.map((x: { name: string }) => x.name)).toContain('Overtime');
  });

  it('multiplies pay and billable amounts in estimates', async () => {
    const before = (await admin.get(o('/insights?from=2026-09-24&to=2026-09-24'))).body.totals;
    expect(before.logged_seconds).toBe(0);
    // Today's time: 1h normal + 1h overtime.
    expect((await manual(admin, '2026-09-23T13:00:00Z', H, { membership_id: waltId })).status).toBe(201);
    expect((await manual(admin, '2026-09-23T15:00:00Z', H, { membership_id: waltId, time_type_id: overtime })).status).toBe(201);
    await t.flush();
    const day = (await admin.get(o(`/insights?from=2026-09-23&to=2026-09-23&membership_ids=${waltId}`))).body.totals;
    expect(day).toMatchObject({ logged_seconds: 2 * H, pay_minor: 2000 + 3000, bill_minor: 10000 + 20000 });
  });

  it('re-weights recent estimates when a coefficient changes', async () => {
    await admin.patch(o(`/time-types/${overtime}`), { name: 'Overtime', short_name: 'O', pay_coefficient: 2, bill_coefficient: 2 });
    const day = (await admin.get(o(`/insights?from=2026-09-23&to=2026-09-23&membership_ids=${waltId}`))).body.totals;
    expect(day.pay_minor).toBe(2000 + 4000);
  });

  it('prices approved time with the coefficients', async () => {
    const ts = await walt.post(o('/timesheets/submit'), { date: '2026-09-23' });
    expect(ts.status).toBe(200);
    expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
    await t.flush();
    const owed = (await admin.get(o('/billing/amounts-owed?from=2026-09-23&to=2026-09-23'))).body.find((w: { membership_id: string }) => w.membership_id === waltId);
    expect(owed.approved_amount_minor).toBe(2000 + 4000);
  });

  it('makes time of a non-billable type non-billable', async () => {
    const internal = (await admin.post(o('/time-types'), { name: 'Training', short_name: 'T', pay_coefficient: 1, bill_coefficient: 0, not_billable: true })).body.id;
    // The week of the 23rd is approved now, so use the week before.
    const ok = await manual(admin, '2026-09-17T13:00:00Z', H, { membership_id: waltId, time_type_id: internal });
    expect(ok.status).toBe(201);
    const e = (await admin.get(o(`/time-entries?from=2026-09-17&to=2026-09-17&membership_ids=${waltId}`))).body.find((x: { time_type_id: string | null }) => x.time_type_id === internal);
    expect(e.billable).toBe(false);
  });

  it('rejects an unknown or archived time type', async () => {
    const tmp = (await admin.post(o('/time-types'), { name: 'Temp', short_name: 'Tm', pay_coefficient: 1, bill_coefficient: 1 })).body.id;
    expect((await admin.del(o(`/time-types/${tmp}`))).status).toBe(204);
    expect((await manual(admin, '2026-09-17T19:00:00Z', 60 * 10, { membership_id: waltId, time_type_id: tmp })).status).toBe(400);
  });
});

describe('missing time reminder', () => {
  beforeAll(async () => {
    expect((await settings({ minDailySeconds: 8 * H, missingTimeReminder: true, missingTimeCheckAt: '17:00' })).status).toBe(200);
  });

  it('waits for the check time', async () => {
    t.mailer.sent.length = 0;
    t.clock.set(new Date('2026-09-23T20:30:00Z')); // 16:30 local
    expect((await runWorkforceAlerts(t.deps)).missing_time).toBe(0);
  });

  it('reminds members under the daily minimum once a day', async () => {
    t.clock.set(new Date('2026-09-23T21:05:00Z')); // 17:05 local
    const first = await runWorkforceAlerts(t.deps);
    expect(first.missing_time).toBeGreaterThanOrEqual(1);
    const mail = t.mailer.sent.find((m) => m.to === 'walt@rules.test');
    expect(mail?.subject).toBe('Your timesheet is missing time');
    expect(mail?.text).toContain('the minimum is 8h 00m');
    expect((await runWorkforceAlerts(t.deps)).missing_time).toBe(0);
  });

  it('skips weekends', async () => {
    t.clock.set(new Date('2026-09-26T22:00:00Z')); // Saturday 18:00 local
    expect((await runWorkforceAlerts(t.deps)).missing_time).toBe(0);
  });
});
