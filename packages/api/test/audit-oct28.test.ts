import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { runTick } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Product QA audit (28 October 2026), the isolated fixes:
// Q1 — a removed member left in a pay group is not paid for later paid holidays (nor before their start date).
// Q2 — time off on days a scheduled member has no shift is not charged.
// Q3 — idle time "reassigned" without a project is refused instead of being discarded.
// Q4 — a narrow rates:manage or time_off:manage grant acts only within its scope, never on your own pay or balance.
// Q5 — a scheduled report is sent only to members who may see everything in it.
const H = 3600_000;
const MIN = 60_000;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const roleId = async (key: string) => ((await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>).find((r) => r.key === key)!.id;
const policy = async (name: string) => (await admin.post(o('/time-off/policies'), { name, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id as string;
type Line = { membership_id: string; time_off_hours: number; time_off_pay_minor: number };

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-21T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@q28.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('Q1: paid holidays follow employment dates', () => {
  it('pays a holiday to current members only, not after removal or before the start date', async () => {
    const people = await Promise.all(['Rex', 'Nan', 'Kim'].map((n) => addMember(t, admin, orgId, n, `${n.toLowerCase()}@q28.test`)));
    const [rex, nan, kim] = people.map((p) => p.membershipId) as [string, string, string];
    for (const id of [rex, nan, kim]) await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: id, amount_minor: 1000, currency: 'USD', effective_from: '2020-01-01' });
    const prof = await admin.post(o('/payroll/profiles'), { name: 'Holiday pay', period: { type: 'monthly' }, currency: 'USD', member_ids: [rex, nan, kim] });
    expect((await admin.del(o(`/workers/${rex}`))).status).toBe(204); // left on 21 October
    expect((await admin.patch(o(`/workers/${nan}`), { start_date: '2026-09-20' })).status).toBe(200);
    await admin.post(o('/holidays'), { date: '2026-09-16', name: 'Before start', paid: true });
    await admin.post(o('/holidays'), { date: '2026-10-28', name: 'After removal', paid: true });

    const sep = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-09-15' });
    const sepPay = (m: string) => (sep.body.lines as Line[]).find((l) => l.membership_id === m)?.time_off_pay_minor ?? 0;
    expect([sepPay(rex), sepPay(nan), sepPay(kim)]).toEqual([8000, 0, 8000]); // Rex still worked here in September
    await admin.del(o(`/payroll/runs/${sep.body.id}`));

    const oct = await admin.post(o('/payroll/runs'), { profile_id: prof.body.id, date: '2026-10-15' });
    const octPay = (m: string) => (oct.body.lines as Line[]).find((l) => l.membership_id === m)?.time_off_pay_minor ?? 0;
    expect([octPay(rex), octPay(nan), octPay(kim)]).toEqual([0, 8000, 8000]); // was 8000 for Rex
    await admin.del(o(`/payroll/runs/${oct.body.id}`));
  });
});

describe('Q2: time off is charged on scheduled working days', () => {
  it('a Monday–Wednesday schedule has no working day on Thursday or Friday', async () => {
    const { client: sam, membershipId: sid } = await addMember(t, admin, orgId, 'Sam', 'sam@q28.test');
    expect((await admin.post(o('/schedules'), { membership_id: sid, timezone: 'UTC', days: [1, 2, 3].map((dow) => ({ dow, start: '09:00', end: '17:00' })), effective_from: '2026-10-01' })).status).toBe(201);
    const pto = await policy('PTO Sam');
    const thuFri = await sam.post(o('/time-off/requests'), { policy_id: pto, start_date: '2026-10-29', end_date: '2026-10-30' });
    expect([thuFri.status, thuFri.body.code]).toEqual([422, 'no_working_days']); // was 201 with 16 h
    const wedThu = await sam.post(o('/time-off/requests'), { policy_id: pto, start_date: '2026-11-04', end_date: '2026-11-05' });
    expect([wedThu.status, wedThu.body.hours]).toEqual([201, 8]);
  });

  it('without a schedule, Monday to Friday still counts', async () => {
    const { client: una } = await addMember(t, admin, orgId, 'Una', 'una@q28.test');
    const r = await una.post(o('/time-off/requests'), { policy_id: await policy('PTO Una'), start_date: '2026-10-29', end_date: '2026-11-01' });
    expect([r.status, r.body.hours]).toEqual([201, 16]);
  });
});

describe('Q3: reassigning idle time needs a project', () => {
  async function idleSession(name: string) {
    const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@q28.test`);
    expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [m.membershipId] })).status).toBe(200);
    await admin.put(o(`/policies/WORKER/${m.membershipId}`), { idle: { behavior: 'prompt' } });
    const { verifier, challenge } = pkce();
    const code = await m.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
    const base = '2026-10-22T09:00:00Z';
    const at = (min: number) => new Date(Date.parse(base) + min * MIN).toISOString();
    const sid = newId();
    const idleId = newId();
    const idle = (i: number) => i >= 20 && i < 40;
    const minutes = Array.from({ length: 60 }, (_, i) => ({ minute_start: at(i), keyboard: idle(i) ? 0 : 30, mouse: 0, active_seconds: idle(i) ? 0 : 50, tracked_seconds: 60 }));
    t.clock.set(new Date('2026-10-22T12:00:00Z'));
    const res = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: base, project_id: projectId },
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(60), minutes },
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(20), idle_id: idleId, started_at: at(20) },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(60) },
      ],
    });
    expect(res.body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);
    const total = async () => ((await admin.get(o(`/time-entries?from=2026-10-22&to=2026-10-22&membership_ids=${m.membershipId}`))).body as Array<{ duration_seconds: number }>).reduce((s, e) => s + e.duration_seconds, 0);
    return { ...m, agent, sid, idleId, at, total };
  }

  it('the web refuses REASSIGNED without a project and the time stays', async () => {
    const s = await idleSession('Ria');
    expect(await s.total()).toBe(3600);
    const pending = (await admin.get(o(`/idle-events?from=2026-10-22&to=2026-10-22&membership_ids=${s.membershipId}&status=PENDING`))).body as Array<{ id: string }>;
    expect((await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'REASSIGNED' })).status).toBe(400);
    expect(await s.total()).toBe(3600); // was 2400: the 20 idle minutes were removed
    // With a project it still works: the time stays and moves to that project.
    expect((await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'REASSIGNED', project_id: projectId })).status).toBe(204);
    expect(await s.total()).toBe(3600);
  });

  it('a desktop REASSIGNED without a project is rejected and the idle period stays open for an answer', async () => {
    const s = await idleSession('Rob');
    const r = await s.agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [{ event_id: newId(), type: 'idle.resolved', session_id: s.sid, occurred_at: s.at(40), idle_id: s.idleId, started_at: s.at(20), ended_at: s.at(40), resolution: 'REASSIGNED', project_id: null }],
    });
    expect(r.body.results[0].status).toBe('rejected');
    expect(await s.total()).toBe(3600);
    const pending = (await admin.get(o(`/idle-events?from=2026-10-22&to=2026-10-22&membership_ids=${s.membershipId}&status=PENDING`))).body as unknown[];
    expect(pending).toHaveLength(1);
  });
});

describe('Q4: narrow manage grants stay inside their scope', () => {
  it('own-scope rates:manage can’t set its holder’s pay, the org rate or rates of others; org scope still can', async () => {
    const role = await admin.post(o('/roles'), { name: 'Rate clerk', grants: { 'org:read': 'org', 'members:read': 'own', 'rates:read': 'own', 'rates:manage': 'own' } });
    expect(role.status).toBe(201);
    const { client: lea, membershipId: leaId } = await addMember(t, admin, orgId, 'Lea', 'lea@q28.test');
    const { membershipId: otherId } = await addMember(t, admin, orgId, 'Oto', 'oto@q28.test');
    expect((await admin.patch(o(`/workers/${leaId}`), { role_id: role.body.id })).status).toBe(200);
    const rate = (scope: string, scope_id: string | null) => ({ kind: 'PAY', scope, scope_id, amount_minor: 99900, currency: 'USD', effective_from: '2026-09-01' });
    expect((await lea.post(o('/rates'), rate('WORKER', leaId))).status).toBe(403); // was 201
    expect((await lea.post(o('/rates'), { ...rate('ORG', null), kind: 'BILL' })).status).toBe(403); // was 201
    expect((await lea.post(o('/rates'), rate('WORKER', otherId))).status).toBe(403);
    expect((await lea.patch(o(`/workers/${leaId}`), { pay_rate_minor: 1234500 })).status).toBe(403); // was 200
    const rates = (await admin.get(o('/rates'))).body as Array<{ scope_id: string | null; amount_minor: number }>;
    expect(rates.some((r) => r.amount_minor === 99900 || r.amount_minor === 1234500)).toBe(false);
    // The organization admin is unaffected.
    expect((await admin.post(o('/rates'), rate('WORKER', otherId))).status).toBe(201);
    expect((await admin.patch(o(`/workers/${otherId}`), { pay_rate_minor: 2500 })).status).toBe(200);
  });

  it('team-scope rates:manage sets a team member’s rate but not its holder’s own', async () => {
    const role = await admin.post(o('/roles'), { name: 'Team rates', grants: { 'org:read': 'org', 'members:read': 'team', 'rates:read': 'team', 'rates:manage': 'team' } });
    const { client: tia, membershipId: tiaId } = await addMember(t, admin, orgId, 'Tia', 'tia@q28.test');
    const { membershipId: memberId } = await addMember(t, admin, orgId, 'Moe', 'moe@q28.test');
    const { membershipId: outsiderId } = await addMember(t, admin, orgId, 'Out', 'out@q28.test');
    await admin.patch(o(`/workers/${tiaId}`), { role_id: role.body.id });
    const team = (await admin.post(o('/teams'), { name: 'Rates team' })).body.id;
    expect((await admin.put(o(`/teams/${team}/members/${tiaId}`), { role: 'MANAGER' })).status).toBe(200);
    expect((await admin.put(o(`/teams/${team}/members/${memberId}`), { role: 'MEMBER' })).status).toBe(200);
    const rate = (scope_id: string) => ({ kind: 'PAY', scope: 'WORKER', scope_id, amount_minor: 3000, currency: 'USD', effective_from: '2026-09-01' });
    expect((await tia.post(o('/rates'), rate(memberId))).status).toBe(201);
    expect((await tia.post(o('/rates'), rate(outsiderId))).status).toBe(403);
    expect((await tia.post(o('/rates'), rate(tiaId))).status).toBe(403);
  });

  it('own-scope time_off:manage can’t top up its holder’s balance; org scope can', async () => {
    const role = await admin.post(o('/roles'), { name: 'Leave clerk', grants: { 'org:read': 'org', 'time_off:read': 'own', 'time_off:request': 'own', 'time_off:manage': 'own' } });
    const { client: cleo, membershipId: cleoId } = await addMember(t, admin, orgId, 'Cleo', 'cleo@q28.test');
    await admin.patch(o(`/workers/${cleoId}`), { role_id: role.body.id });
    const pto = await policy('PTO Cleo');
    expect((await cleo.post(o('/time-off/balances/adjust'), { policy_id: pto, membership_id: cleoId, hours: 500 })).status).toBe(403); // was 200
    expect((await admin.post(o('/time-off/balances/adjust'), { policy_id: pto, membership_id: cleoId, hours: 8 })).status).toBe(200);
  });
});

describe('Q5: scheduled reports go only to members who may see them', () => {
  it('refuses a worker as recipient of the payroll export, and stops sending to a recipient who loses access', async () => {
    const { client: will } = await addMember(t, admin, orgId, 'Will', 'will@q28.test');
    expect((await will.post(o('/reports/payroll/query'), { from: '2026-09-01', to: '2026-09-30' })).status).toBe(403);
    const toWorker = await admin.post(o('/saved-reports'), { report_key: 'payroll', name: 'Pay', params: { range: 'yesterday', format: 'CSV' }, schedule_cron: '* * * * *', recipients: ['will@q28.test'] });
    expect([toWorker.status, toWorker.body.errors?.[0]?.field]).toEqual([400, 'recipients']); // was 201, and the worker got the file

    const { membershipId: samId } = await addMember(t, admin, orgId, 'Sia', 'sia@q28.test', 'SYSTEM_ADMIN');
    const ok = await admin.post(o('/saved-reports'), { report_key: 'payroll', name: 'Pay to admins', params: { range: 'yesterday', format: 'CSV' }, schedule_cron: '* * * * *', recipients: ['ada@q28.test', 'sia@q28.test'] });
    expect(ok.status).toBe(201);
    t.mailer.sent.length = 0;
    t.clock.advance(2 * MIN);
    await runTick(t.deps);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Pay to admins')).map((m) => m.to).sort()).toEqual(['ada@q28.test', 'sia@q28.test']);

    // Sia becomes a worker: the next run goes to the owner only.
    expect((await admin.patch(o(`/workers/${samId}`), { role_id: await roleId('WORKER') })).status).toBe(200);
    t.mailer.sent.length = 0;
    t.clock.advance(2 * MIN);
    await runTick(t.deps);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Pay to admins')).map((m) => m.to)).toEqual(['ada@q28.test']);
  });
});
