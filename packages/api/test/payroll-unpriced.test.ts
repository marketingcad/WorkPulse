import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Payroll and approved time with no pay rate (QA round 8, BUG-32), and empty pay stubs (C-28).
 * Approved time with no pay rate for its day is paid $0. That used to happen silently: Wes's stub said
 * "2h 14m · $31.06" with one unpriced hour inside. Now each line counts those hours, flags them, and
 * finalizing needs an explicit confirmation. Someone with nothing on the payroll gets no stub.
 */
const NOW = new Date('2026-10-02T15:00:00Z'); // the last completed monthly period is September
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
let profileId: string;
let runId: string;
const people: Record<'walt' | 'una' | 'ned' | 'emmy' | 'bonnie', { client: Client; membershipId: string }> = {} as never;
const o = (p: string) => `/orgs/${orgId}${p}`;
const line = (run: { lines: Array<{ membership_id: string }> }, who: keyof typeof people) => run.lines.find((l) => l.membership_id === people[who].membershipId) as Record<string, unknown> | undefined;

async function approvedHours(who: keyof typeof people, date: string, hours: number) {
  const s = new Date(`${date}T13:00:00Z`);
  expect((await admin.post(o('/manual-time'), { membership_id: people[who].membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + hours * H * 1000).toISOString(), reason: 'fixture' })).status).toBe(201);
  const ts = await people[who].client.post(o('/timesheets/submit'), { date });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@payroll-unpriced.test'));
  for (const [key, name] of [['walt', 'Walt'], ['una', 'Una'], ['ned', 'Ned'], ['emmy', 'Emmy'], ['bonnie', 'Bonnie']] as const) people[key] = await addMember(t, admin, orgId, name, `${key}@payroll-unpriced.test`);
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: Object.values(people).map((p) => p.membershipId) })).body.id;
  // Only Walt has a pay rate. Una and Ned work without one; Emmy and Bonnie do not work at all.
  await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: people.walt.membershipId, amount_minor: 2000, currency: 'USD', effective_from: '2020-01-01' });
  await approvedHours('walt', '2026-09-08', 3);
  await approvedHours('una', '2026-09-08', 2);
  await approvedHours('ned', '2026-09-15', 1);
  await t.flush();
  profileId = (await admin.post(o('/payroll/profiles'), { name: 'Monthly USD', period: { type: 'monthly' }, currency: 'USD', member_ids: Object.values(people).map((p) => p.membershipId) })).body.id;
}, 120_000);
afterAll(() => t.close());

describe('approved time with no pay rate', () => {
  it('is counted and flagged on each pay line, never silently paid $0', async () => {
    const r = await admin.post(o('/payroll/runs'), { profile_id: profileId });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect(line(r.body, 'walt')).toMatchObject({ approved_seconds: 3 * H, unpriced_seconds: 0, time_pay_minor: 6000 });
    expect(line(r.body, 'una')).toMatchObject({ approved_seconds: 2 * H, unpriced_seconds: 2 * H, time_pay_minor: 0, warnings: ['time_no_rate'] });
    expect(line(r.body, 'ned')).toMatchObject({ unpriced_seconds: 1 * H, warnings: ['time_no_rate'] });
    expect(line(r.body, 'walt')!.warnings).toEqual([]);
  });

  it('cannot be finalized without confirming, and says how many hours and whose', async () => {
    const r = await admin.post(o(`/payroll/runs/${runId}/finalize`), {});
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('payroll_unpriced_time');
    expect(r.body.title).toContain('3 h of approved time has no pay rate');
    const detail = JSON.parse(r.body.detail);
    expect(detail.unpriced_seconds).toBe(3 * H);
    expect(detail.members.map((m: { name: string }) => m.name).sort()).toEqual(['Ned', 'Una']);
    // An older caller that sends no body is refused the same way: no path around the check.
    expect((await admin.post(o(`/payroll/runs/${runId}/finalize`))).body.code).toBe('payroll_unpriced_time');
    expect((await admin.get(o(`/payroll/runs/${runId}`))).body.status).toBe('DRAFT');
  });

  it('is fixed the normal way: set the rate, recalculate, and the hours are paid', async () => {
    await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: people.una.membershipId, amount_minor: 1500, currency: 'USD', effective_from: '2020-01-01' });
    const r = await admin.post(o(`/payroll/runs/${runId}/recalculate`), {});
    expect(r.status).toBe(200);
    expect(line(r.body, 'una')).toMatchObject({ unpriced_seconds: 0, time_pay_minor: 2 * 1500, warnings: [] });
    // Ned still has none: still refused.
    const f = await admin.post(o(`/payroll/runs/${runId}/finalize`), {});
    expect(f.body.code).toBe('payroll_unpriced_time');
    expect(JSON.parse(f.body.detail).members.map((m: { name: string }) => m.name)).toEqual(['Ned']);
  });
});

describe('finalizing', () => {
  it('a bonus can still go to someone with no time while the payroll is a draft', async () => {
    const run = (await admin.get(o(`/payroll/runs/${runId}`))).body;
    const bonnie = line(run, 'bonnie')!;
    expect(bonnie).toMatchObject({ approved_seconds: 0, gross_minor: 0 });
    expect((await admin.put(o(`/payroll/runs/${runId}/lines/${bonnie.id}/adjustments`), { adjustments: [{ label: 'Referral bonus', amount_minor: 5000 }] })).status).toBe(200);
    expect(line((await admin.get(o(`/payroll/runs/${runId}`))).body, 'emmy')).toBeDefined();
  });

  it('with confirmation pays the unpriced time at $0, and drops empty stubs', async () => {
    const r = await admin.post(o(`/payroll/runs/${runId}/finalize`), { confirm_unpriced: true });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('FINALIZED');
    // Emmy had nothing on it: no stub. Bonnie's bonus keeps hers; Ned's $0 line keeps its flag.
    expect(line(r.body, 'emmy')).toBeUndefined();
    expect(line(r.body, 'bonnie')).toMatchObject({ net_minor: 5000 });
    expect(line(r.body, 'ned')).toMatchObject({ unpriced_seconds: 1 * H, time_pay_minor: 0, warnings: ['time_no_rate'] });
    expect(r.body.net_minor).toBe(6000 + 3000 + 0 + 5000);
    expect((await people.emmy.client.get(o('/me/pay-stubs'))).body).toEqual([]);
    expect(((await people.bonnie.client.get(o('/me/pay-stubs'))).body as unknown[]).length).toBe(1);
  });

  it('the finalization is in the audit log once', async () => {
    const logs = (await admin.get(o(`/audit-logs?action=payroll.finalized`))).body as Array<{ target_id: string; metadata?: Record<string, unknown> }>;
    expect(logs).toHaveLength(1);
  });
});
