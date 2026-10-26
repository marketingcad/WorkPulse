import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Time & Timesheets audit, step 4: paid breaks, paid holidays, split-shift attendance, desktop "Away".
// Organization in UTC, USD.
const H = 3600;
const MIN = 60_000;
const RATE = 2000; // $20.00 an hour

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const memberIds: string[] = [];

async function member(name: string) {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@product.test`);
  memberIds.push(m.membershipId);
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: memberIds })).status).toBe(200);
  expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: m.membershipId, amount_minor: RATE, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  return m;
}

async function adminTime(membershipId: string, startIso: string, seconds: number) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + seconds * 1000).toISOString(), reason: 'fixture' });
  expect(r.status).toBe(201);
}

const entriesOn = async (m: string, d: string) => (await admin.get(o(`/time-entries?from=${d}&to=${d}&membership_ids=${m}`))).body as Array<{ duration_seconds: number; billable: boolean; note: string | null }>;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-05T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@product.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('paid breaks', () => {
  it('a paid break is paid, non-billable time up to its maximum; an unpaid break is not counted', async () => {
    const { client: walt, membershipId: waltId } = await member('Walt');
    const coffee = (await admin.post(o('/break-types'), { name: 'Coffee', paid: true, max_minutes: 15 })).body.id;
    const lunch = (await admin.post(o('/break-types'), { name: 'Lunch', paid: false, max_minutes: 60 })).body.id;
    t.clock.set(new Date('2026-10-06T09:00:00Z'));
    expect((await walt.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
    t.clock.advance(60 * MIN); // work 09:00–10:00
    expect((await walt.post(o('/tracking/pause'), { break_type_id: coffee })).status).toBe(200);
    t.clock.advance(20 * MIN); // coffee 10:00–10:20: 15 min paid (its maximum), 5 min not
    expect((await walt.post(o('/tracking/resume'))).status).toBe(200);
    t.clock.advance(40 * MIN); // work 10:20–11:00
    expect((await walt.post(o('/tracking/pause'), { break_type_id: lunch })).status).toBe(200);
    t.clock.advance(30 * MIN); // lunch 11:00–11:30, unpaid
    expect((await walt.post(o('/tracking/resume'))).status).toBe(200);
    t.clock.advance(30 * MIN); // work 11:30–12:00
    expect((await walt.post(o('/tracking/stop'))).status).toBe(200);

    const rows = await entriesOn(waltId, '2026-10-06');
    // 60 + 40 + 30 min of work and 15 min of paid coffee. Before the fix: 130 min (breaks never counted).
    expect(rows.reduce((s, e) => s + e.duration_seconds, 0)).toBe(145 * 60);
    const paidBreak = rows.filter((e) => e.note === 'Paid break: Coffee');
    expect(paidBreak.map((e) => [e.duration_seconds, e.billable])).toEqual([[15 * 60, false]]);
  });
});

describe('paid holidays in payroll', () => {
  it('pay the hours the person is scheduled that day, or 8 h on a weekday without a schedule', async () => {
    t.clock.set(new Date('2026-10-05T12:00:00Z'));
    const { membershipId: hana } = await member('Hana'); // no schedule
    const { membershipId: sam } = await member('Sam'); // Monday–Friday 09:00–13:00
    expect((await admin.post(o('/schedules'), { membership_id: sam, timezone: 'UTC', days: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: '09:00', end: '13:00' })), effective_from: '2026-01-01' })).status).toBe(201);
    expect((await admin.post(o('/holidays'), { date: '2026-09-16', name: 'Founders day', paid: true })).status).toBe(201); // Wednesday
    expect((await admin.post(o('/holidays'), { date: '2026-09-17', name: 'Company picnic', paid: false })).status).toBe(201); // Thursday
    expect((await admin.post(o('/holidays'), { date: '2026-09-19', name: 'Saturday holiday', paid: true })).status).toBe(201); // Saturday
    await adminTime(hana, '2026-09-15T09:00:00Z', H); // so she appears in Payroll Export
    await t.flush(); // rebuild the daily rollups the report reads

    const profile = (await admin.post(o('/payroll/profiles'), { name: 'Monthly', period: { type: 'monthly' }, currency: 'USD', member_ids: [hana, sam] })).body.id;
    const run = await admin.post(o('/payroll/runs'), { profile_id: profile, date: '2026-09-15' });
    expect(run.status).toBe(201);
    const line = (m: string) => (run.body.lines as Array<{ membership_id: string; time_off_hours: number; time_off_pay_minor: number }>).find((l) => l.membership_id === m)!;
    // Wednesday only (Thursday is unpaid, Saturday is not a working day for either).
    // Before the fix holidays paid nothing.
    expect(line(hana)).toMatchObject({ time_off_hours: 8, time_off_pay_minor: 8 * RATE });
    expect(line(sam)).toMatchObject({ time_off_hours: 4, time_off_pay_minor: 4 * RATE });

    const report = (await admin.post(o('/reports/payroll/query'), { from: '2026-09-01', to: '2026-09-30' })).body.rows as Array<{ worker: string; time_off_hours: number }>;
    expect(report.find((r) => r.worker === 'Hana')?.time_off_hours).toBe(8);
  });
});

describe('attendance with split shifts', () => {
  it('scheduled time is the shifts’ own length, so the lunch gap is not scheduled', async () => {
    t.clock.set(new Date('2026-10-07T18:00:00Z'));
    const { membershipId: ola } = await member('Ola');
    expect((await admin.post(o('/schedules'), { membership_id: ola, timezone: 'UTC', days: [{ dow: 3, start: '09:00', end: '12:00' }, { dow: 3, start: '13:00', end: '17:00' }], effective_from: '2026-01-01' })).status).toBe(201);
    await adminTime(ola, '2026-10-07T09:00:00Z', 8 * H); // Wednesday 09:00–17:00, through lunch
    const [row] = (await admin.get(o(`/attendance?from=2026-10-07&to=2026-10-07&membership_ids=${ola}`))).body as Array<{ scheduled_seconds: number; overtime_seconds: number }>;
    // 3 h + 4 h scheduled; 8 h worked is 1 h of overtime. Before the fix: 8 h scheduled, no overtime.
    expect([row!.scheduled_seconds, row!.overtime_seconds]).toEqual([7 * H, H]);
  });
});

describe('desktop "Away"', () => {
  it('counts the idle periods of the day, answered or not', async () => {
    t.clock.set(new Date('2026-10-08T10:00:00Z'));
    const { client: ivy } = await member('Ivy');
    const { verifier, challenge } = pkce();
    const code = await ivy.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
    const at = (min: number) => new Date(Date.parse('2026-10-08T09:00:00Z') + min * MIN).toISOString();
    const sid = newId();
    const answered = newId();
    const minutes = Array.from({ length: 60 }, (_, i) => {
      const away = (i >= 10 && i < 20) || (i >= 40 && i < 45);
      return { minute_start: at(i), keyboard: away ? 0 : 30, mouse: away ? 0 : 20, active_seconds: away ? 0 : 50, tracked_seconds: 60 };
    });
    await agent.post('/agent/ingest/batch', {
      sent_at: at(60),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId },
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(60), minutes },
        // Away 09:10–09:20, answered "Keep".
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(10), idle_id: answered, started_at: at(10) },
        { event_id: newId(), type: 'idle.resolved', session_id: sid, occurred_at: at(21), idle_id: answered, started_at: at(10), ended_at: at(20), resolution: 'KEPT' },
        // Away 09:40–09:45, not answered: ends when input resumed.
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(40), idle_id: newId(), started_at: at(40) },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(60) },
      ],
    });
    const summary = (await agent.get('/agent/me/summary?from=2026-10-08&to=2026-10-08')).body;
    // 10 + 5 minutes. Before the fix "Away" was always 0.
    expect(summary.idle_seconds).toBe(15 * 60);
  });
});
