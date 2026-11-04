import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileObjects, rolePermissions, withSystem } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Product QA audit (28 October 2026), phase 1: permissions and security.
// A2b — budgets, invoices, payments and teams follow the grant's scope; org settings are org-only.
// A5 (SEC-6) — policy layers follow the grant's scope.
// SEC-5 — /files/:id serves only receipts and your own exports.
// SEC-7 — a team-scope teams:manage grant can't pull anyone into its team.
// A4, A6, A7, A8 — billing report money, portal re-enable, shared report recipients, foreign ids.
// T3 — idle time can't be resolved from the web while it is still going.
// BE-9 — approved time off that has started is cancelled by an approver, not the requester.
const MIN = 60_000;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const role = async (name: string, grants: Record<string, string>) => {
  const r = await admin.post(o('/roles'), { name, grants: { 'org:read': 'org', ...grants } });
  expect(r.status).toBe(201);
  return r.body.id as string;
};
const member = async (name: string, roleId?: string) => {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@p1.test`);
  if (roleId) expect((await admin.patch(o(`/workers/${m.membershipId}`), { role_id: roleId })).status).toBe(200);
  return m;
};
const team = async (name: string, people: Array<[string, 'MANAGER' | 'MEMBER']>) => {
  const id = (await admin.post(o('/teams'), { name })).body.id as string;
  for (const [m, r] of people) expect((await admin.put(o(`/teams/${id}/members/${m}`), { role: r })).status).toBe(200);
  return id;
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-21T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p1.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
}, 60_000);
afterAll(() => t.close());

describe('A2b: money follows the grant’s scope', () => {
  let clerk: Client;
  let clientA: string;
  let clientB: string;
  let projA: string;
  let projB: string;
  let invA: string;
  let invB: string;
  const invoice = async (by: Client, clientId: string, cents: number) =>
    by.post(o('/invoices'), { client_id: clientId, period_start: '2026-10-01', period_end: '2026-10-31', issue_date: '2026-10-21', due_date: '2026-11-21', extra_lines: [{ description: 'Fee', quantity: 1, unit_price_minor: cents }] });

  beforeAll(async () => {
    const rid = await role('Account clerk', {
      'clients:read': 'assigned',
      'projects:read': 'assigned',
      'invoices:read': 'assigned',
      'invoices:manage': 'assigned',
      'payments:read': 'assigned',
      'payments:manage': 'assigned',
      'budgets:read': 'assigned',
      'budgets:manage': 'assigned',
      'time:read': 'own',
    });
    const m = await member('Cleo', rid);
    clerk = m.client;
    clientA = (await admin.post(o('/clients'), { name: 'Alpha', currency: 'USD' })).body.id;
    clientB = (await admin.post(o('/clients'), { name: 'Beta', currency: 'USD' })).body.id;
    projA = (await admin.post(o('/projects'), { name: 'Alpha site', client_id: clientA })).body.id;
    projB = (await admin.post(o('/projects'), { name: 'Beta site', client_id: clientB })).body.id;
    expect((await admin.patch(o(`/projects/${projA}`), { member_ids: [m.membershipId] })).status).toBe(200);
    invA = (await invoice(admin, clientA, 10000)).body.id;
    invB = (await invoice(admin, clientB, 20000)).body.id;
    for (const id of [invA, invB]) expect((await admin.post(o(`/invoices/${id}/send`))).status).toBe(200);
  });

  it('lists, opens and counts only the invoices of its projects’ clients', async () => {
    expect(((await clerk.get(o('/invoices'))).body as Array<{ id: string }>).map((i) => i.id)).toEqual([invA]); // was both
    const page = (await clerk.get(o('/invoices?page=1&page_size=25'))).body;
    expect([page.data.length, page.summary.counts.ALL, page.summary.outstanding_minor]).toEqual([1, 1, 10000]);
    expect((await clerk.get(o(`/invoices/${invB}`))).status).toBe(404); // was 200
    const widget = (await clerk.get(o('/dashboard/widgets?keys=invoices'))).body.invoices;
    expect(widget.outstanding_minor).toBe(10000); // was 30000
    // The admin still sees everything.
    expect(((await admin.get(o('/invoices'))).body as unknown[]).length).toBe(2);
  });

  it('creates and voids invoices only for those clients', async () => {
    expect((await invoice(clerk, clientB, 500)).status).toBe(404); // was 201
    expect((await clerk.post(o(`/invoices/${invB}/void`))).status).toBe(404);
    expect((await clerk.del(o(`/invoices/${invB}`))).status).toBe(404);
    const own = await invoice(clerk, clientA, 500);
    expect(own.status).toBe(201);
    expect((await clerk.del(o(`/invoices/${own.body.id}`))).status).toBe(204);
  });

  it('records and sees payments only for those clients', async () => {
    const theirs = await admin.post(o('/payments'), { client_id: clientB, amount_minor: 2000, currency: 'USD', received_on: '2026-10-21', allocations: [{ invoice_id: invB, amount_minor: 2000 }] });
    expect(theirs.status).toBe(201);
    expect(((await clerk.get(o('/payments'))).body as unknown[]).length).toBe(0); // was 1
    expect((await clerk.del(o(`/payments/${theirs.body.id}`))).status).toBe(404);
    expect((await clerk.post(o('/payments'), { client_id: clientB, amount_minor: 100, currency: 'USD', received_on: '2026-10-21' })).status).toBe(403);
    expect((await clerk.post(o('/payments'), { amount_minor: 100, currency: 'USD', received_on: '2026-10-21' })).status).toBe(403);
    const mine = await clerk.post(o('/payments'), { client_id: clientA, amount_minor: 1000, currency: 'USD', received_on: '2026-10-21', allocations: [{ invoice_id: invA, amount_minor: 1000 }] });
    expect(mine.status).toBe(201);
    expect(((await clerk.get(o('/payments'))).body as Array<{ id: string }>).map((p) => p.id)).toEqual([mine.body.id]);
  });

  it('sets budgets only on its projects and their clients, in this organization', async () => {
    const budget = (subject_type: string, subject_id: string) => ({ subject_type, subject_id, kind: 'HOURS', amount: 100 });
    expect((await clerk.put(o('/budgets'), budget('PROJECT', projA))).status).toBe(200);
    expect((await clerk.put(o('/budgets'), budget('CLIENT', clientA))).status).toBe(200);
    expect((await clerk.put(o('/budgets'), budget('PROJECT', projB))).status).toBe(403); // was 200
    expect((await clerk.put(o('/budgets'), budget('CLIENT', clientB))).status).toBe(403);
    expect((await admin.put(o('/budgets'), budget('PROJECT', UNKNOWN))).status).toBe(404); // A8: was 200
    const all = (await admin.put(o('/budgets'), budget('PROJECT', projB))).body as Array<{ id: string; subject_id: string }>;
    expect((await clerk.del(o(`/budgets/${all.find((b) => b.subject_id === projB)!.id}`))).status).toBe(403);
  });
});

describe('A2b: organization settings need an org-wide grant', () => {
  it('a narrow grant is refused when saving a role, and ignored if one was stored before', async () => {
    expect((await admin.post(o('/roles'), { name: 'Team auditor', grants: { 'org:read': 'org', 'audit:read': 'team' } })).status).toBe(400);
    const rid = await role('Old narrow role', { 'members:read': 'own' });
    await withSystem(t.deps.db, (tx) =>
      tx.insert(rolePermissions).values(['audit:read', 'webhooks:manage', 'api_keys:manage'].map((permission) => ({ organizationId: orgId, roleId: rid, permission, scope: 'team' as const }))),
    );
    const { client: ned } = await member('Ned', rid);
    expect((await ned.get(o('/audit-logs'))).status).toBe(403); // was 200, with rate amounts
    expect((await ned.get(o('/webhooks'))).status).toBe(403);
    expect((await ned.get(o('/api-keys'))).status).toBe(403);
  });

  it('a narrow time_off:manage grant can’t change holidays or leave policies', async () => {
    const rid = await role('Team leave', { 'members:read': 'team', 'time_off:read': 'team', 'time_off:manage': 'team' });
    const { client: lia } = await member('Lia', rid);
    expect((await lia.post(o('/holidays'), { date: '2026-12-24', name: 'Eve', paid: true })).status).toBe(403);
    expect((await lia.post(o('/time-off/policies'), { name: 'Extra', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } })).status).toBe(403);
  });
});

describe('A2b and SEC-7: teams', () => {
  it('a team-scope grant edits only teams it manages and adds only people it already manages', async () => {
    const rid = await role('Team lead', { 'members:read': 'team', 'teams:read': 'team', 'teams:manage': 'team' });
    const { client: tom, membershipId: tomId } = await member('Tom', rid);
    const { membershipId: yan } = await member('Yan');
    const { membershipId: zed } = await member('Zed');
    const { membershipId: kai } = await member('Kai');
    const mine = await team('Tom’s team', [[tomId, 'MANAGER'], [kai, 'MEMBER']]);
    await team('Tom’s other team', [[tomId, 'MANAGER'], [yan, 'MEMBER']]);
    const other = await team('Someone else’s', [[zed, 'MEMBER']]);

    expect((await tom.post(o('/teams'), { name: 'New' })).status).toBe(403); // was 201
    expect((await tom.patch(o(`/teams/${mine}`), { name: 'Renamed' })).status).toBe(200);
    expect((await tom.patch(o(`/teams/${other}`), { name: 'Taken' })).status).toBe(403); // was 200
    expect((await tom.del(o(`/teams/${other}`))).status).toBe(403); // was 204
    expect((await tom.put(o(`/teams/${mine}/members/${zed}`), { role: 'MEMBER' })).status).toBe(403); // SEC-7: was 200
    expect((await tom.put(o(`/teams/${mine}/members/${yan}`), { role: 'MEMBER' })).status).toBe(200);
    expect((await tom.put(o(`/teams/${mine}/members/${kai}`), { role: 'MANAGER' })).status).toBe(200);
  });
});

describe('A5 (SEC-6): policy layers follow the grant’s scope', () => {
  it('a worker reads the org layer and its own teams, a team-scope manager writes only its teams and members', async () => {
    const { client: wes, membershipId: wesId } = await member('Wes');
    const { membershipId: ivy } = await member('Ivy');
    const rid = await role('Policy lead', { 'members:read': 'team', 'policies:read': 'team', 'policies:manage': 'team' });
    const { client: pam, membershipId: pamId } = await member('Pam', rid);
    const ta = await team('Team A', [[pamId, 'MANAGER'], [wesId, 'MEMBER']]);
    const tb = await team('Team B', [[ivy, 'MEMBER']]);

    expect((await wes.get(o(`/policies/ORG/${orgId}`))).status).toBe(200);
    expect((await wes.get(o(`/policies/TEAM/${ta}`))).status).toBe(200);
    expect((await wes.get(o(`/policies/TEAM/${tb}`))).status).toBe(403); // was 200
    expect((await wes.get(o(`/policies/WORKER/${ivy}`))).status).toBe(403); // was 200
    expect((await wes.get(o(`/policies/WORKER/${wesId}`))).status).toBe(200);

    const doc = { idle: { behavior: 'prompt' } };
    expect((await pam.put(o(`/policies/ORG/${orgId}`), doc)).status).toBe(403); // was 200
    expect((await pam.put(o(`/policies/TEAM/${tb}`), doc)).status).toBe(403);
    expect((await pam.put(o(`/policies/WORKER/${pamId}`), doc)).status).toBe(403);
    expect((await pam.put(o(`/policies/TEAM/${ta}`), doc)).status).toBe(200);
    expect((await pam.put(o(`/policies/WORKER/${wesId}`), doc)).status).toBe(200);
    expect((await admin.put(o(`/policies/WORKER/${UNKNOWN}`), doc)).status).toBe(404); // A8
    expect((await admin.put(o(`/policies/ORG/${orgId}`), doc)).status).toBe(200);
  });
});

describe('SEC-5: /files/:id is deny by default', () => {
  it('does not serve a project document to someone outside the project', async () => {
    const { client: una } = await member('Una');
    const id = newId();
    await t.storage.put(`docs/${id}`, Buffer.from('secret plan'), 'text/plain');
    await withSystem(t.deps.db, (tx) => tx.insert(fileObjects).values({ id, organizationId: orgId, purpose: 'PROJECT_DOCUMENT', storageKey: `docs/${id}`, contentType: 'text/plain' }));
    expect((await una.get(o(`/files/${id}`))).status).toBe(404); // was 200
    expect((await admin.get(o('/files/not-a-uuid'))).status).toBe(404);
  });
});

describe('A4, A6, A7, A8', () => {
  it('A4: the Billing report shows money only with billing:read or rates:read', async () => {
    const rid = await role('Finance reader', { 'reports:read': 'org', 'reports:finance': 'org', 'time:read': 'org' });
    const { client: fay } = await member('Fay', rid);
    const keys = async (c: Client) => {
      const r = await c.post(o('/reports/billing/query'), { from: '2026-10-01', to: '2026-10-31' });
      expect(r.status).toBe(200);
      return { columns: (r.body.columns as Array<{ key: string; type: string }>).filter((c) => c.type === 'money').length, summary: (r.body.summary as unknown[]).length };
    };
    expect(await keys(fay)).toEqual({ columns: 0, summary: 0 }); // was 3 money columns and 3 money figures
    expect(await keys(admin)).toEqual({ columns: 3, summary: 3 });
  });

  it('A6: switching a portal back on needs the grants for the monitoring it shares', async () => {
    const clientId = (await admin.post(o('/clients'), { name: 'Portal Co' })).body.id;
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true } })).status).toBe(200);
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: false })).status).toBe(200);
    const rid = await role('Client admin', { 'clients:read': 'org', 'clients:manage': 'org', 'activity:read': 'team' });
    const { client: cal } = await member('Cal', rid);
    expect((await cal.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(403); // was 200
    expect((await admin.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(200);
  });

  it('A7: a shared report shows its recipients to the owner only', async () => {
    const { client: wyn } = await member('Wyn');
    const r = await admin.post(o('/saved-reports'), { report_key: 'time-activity', name: 'Weekly time', params: { range: 'last_week' }, shared: true, schedule_cron: '0 8 * * 1', recipients: ['ada@p1.test'] });
    expect(r.status).toBe(201);
    const seen = ((await wyn.get(o('/saved-reports'))).body as Array<{ id: string; recipients: string[] }>).find((s) => s.id === r.body.id)!;
    expect(seen.recipients).toEqual([]); // was ['ada@p1.test']
    const own = ((await admin.get(o('/saved-reports'))).body as Array<{ id: string; recipients: string[] }>).find((s) => s.id === r.body.id)!;
    expect(own.recipients).toEqual(['ada@p1.test']);
  });

  it('A8: ids from elsewhere are refused, not stored', async () => {
    expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: UNKNOWN, amount_minor: 100, currency: 'USD', effective_from: '2026-10-01' })).status).toBe(400); // was 201
    const pto = (await admin.post(o('/time-off/policies'), { name: 'PTO A8', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null } })).body.id;
    expect((await admin.post(o('/time-off/balances/adjust'), { policy_id: pto, membership_id: UNKNOWN, hours: 8 })).status).toBe(404); // was 200
    expect((await admin.post(o('/schedules'), { membership_id: UNKNOWN, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: '2026-10-01' })).status).toBe(404); // was 201
  });
});

describe('T3: idle time is resolved once it has ended', () => {
  it('refuses to resolve from the web while the person is still away', async () => {
    const projectId = (await admin.post(o('/projects'), { name: 'Idle site' })).body.id;
    const m = await member('Ida');
    expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [m.membershipId] })).status).toBe(200);
    await admin.put(o(`/policies/WORKER/${m.membershipId}`), { idle: { behavior: 'prompt' } });
    const { verifier, challenge } = pkce();
    const code = await m.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
    t.clock.set(new Date('2026-10-22T10:00:00Z'));
    const base = '2026-10-22T09:00:00Z';
    const at = (min: number) => new Date(Date.parse(base) + min * MIN).toISOString();
    const sid = newId();
    const minutes = Array.from({ length: 20 }, (_, i) => ({ minute_start: at(i), keyboard: 30, mouse: 0, active_seconds: 50, tracked_seconds: 60 }));
    const res = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: base, project_id: projectId },
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(20), minutes },
        { event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: at(20), idle_id: newId(), started_at: at(20) },
      ],
    });
    expect(res.body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);
    const pending = (await admin.get(o(`/idle-events?from=2026-10-22&to=2026-10-22&membership_ids=${m.membershipId}&status=PENDING`))).body as Array<{ id: string }>;
    const r = await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'KEPT' });
    expect([r.status, r.body.code]).toEqual([422, 'idle_ongoing']); // was 204, and the timer resumed
    // Once the session ends there is an end, and it resolves.
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(40) }] });
    expect((await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'KEPT' })).status).toBe(204);
  });
});

describe('BE-9: cancelling approved time off', () => {
  it('the requester cancels before it starts; once started only an approver can', async () => {
    t.clock.set(new Date('2026-10-21T12:00:00Z'));
    const pto = (await admin.post(o('/time-off/policies'), { name: 'PTO BE-9', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
    const { client: bea } = await member('Bea');
    const early = await bea.post(o('/time-off/requests'), { policy_id: pto, start_date: '2026-11-02', end_date: '2026-11-02' });
    const later = await bea.post(o('/time-off/requests'), { policy_id: pto, start_date: '2026-10-26', end_date: '2026-10-27' });
    expect([early.body.status, later.body.status]).toEqual(['APPROVED', 'APPROVED']);
    t.clock.set(new Date('2026-10-26T12:00:00Z'));
    const own = await bea.post(o(`/time-off/requests/${later.body.id}/cancel`), {});
    expect([own.status, own.body.code]).toEqual([422, 'time_off_started']); // was 204, balance restored
    expect((await bea.post(o(`/time-off/requests/${early.body.id}/cancel`), {})).status).toBe(204);
    expect((await admin.post(o(`/time-off/requests/${later.body.id}/cancel`), {})).status).toBe(204);
  });
});
