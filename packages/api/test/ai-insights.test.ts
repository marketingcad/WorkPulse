import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { timeEntries, withTenant } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * AI Insights endpoint: findings computed in code from what the person may see, served without an
 * AI key. Org: Ada (admin); Mia manages Team Alpha (Walt); Bea is in Team Bravo.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
let walt: { client: Client; membershipId: string };
let zed: Client;
let alpha: string;
const THIS = { from: '2026-11-02', to: '2026-11-08' };
const o = (p: string) => `/orgs/${orgId}${p}`;
const insights = (c: Client, section: string, q = THIS) => c.get<any>(o(`/assistant/insights/${section}?from=${q.from}&to=${q.to}`));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-09T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@i.test'));
  const m = await addMember(t, ada, orgId, 'Mia Manager', 'mia@i.test', 'TEAM_MANAGER');
  mia = m.client;
  walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@i.test');
  const bea = await addMember(t, ada, orgId, 'Bea Bravo', 'bea@i.test');
  const teamA = (await ada.post<any>(o('/teams'), { name: 'Team Alpha' })).body.id as string;
  const teamB = (await ada.post<any>(o('/teams'), { name: 'Team Bravo' })).body.id as string;
  for (const [team, id, role] of [[teamA, m.membershipId, 'MANAGER'], [teamA, walt.membershipId, 'MEMBER'], [teamB, bea.membershipId, 'MEMBER']] as const)
    expect((await ada.put(o(`/teams/${team}/members/${id}`), { role })).status).toBe(200);
  alpha = (await ada.post<any>(o('/projects'), { name: 'Alpha Site', member_ids: [walt.membershipId, m.membershipId], team_ids: [teamA] })).body.id as string;
  const beta = (await ada.post<any>(o('/projects'), { name: 'Beta Secret', member_ids: [bea.membershipId] })).body.id as string;

  const manual = (who: string, p: string, start: string, h: number) =>
    ada.post(o('/manual-time'), { membership_id: who, project_id: p, started_at: start, ended_at: new Date(Date.parse(start) + h * 3600_000).toISOString(), reason: 'Entered by admin' });
  expect((await manual(walt.membershipId, alpha, '2026-10-27T14:00:00Z', 2)).status).toBe(201); // previous period
  expect((await manual(walt.membershipId, alpha, '2026-11-03T14:00:00Z', 3)).status).toBe(201);
  expect((await manual(bea.membershipId, beta, '2026-11-04T14:00:00Z', 5)).status).toBe(201);
  // An hours budget of 6 h on Alpha (stored in seconds): 5 h used in total (83 %, near the limit).
  expect((await ada.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: alpha, kind: 'HOURS', amount: 6 * 3600, warn_pct: 80, include_non_billable: true })).status).toBe(200);

  await t.flush(); // background events build the daily totals budgets read
  zed = (await signup(t, 'Zed', 'zed@i.test', 'Other Org')).client;
});
afterAll(() => t.close());

describe('AI Insights endpoint', () => {
  it('gives an admin workforce findings computed from the recorded hours', async () => {
    const r = await insights(ada, 'workforce');
    expect(r.status).toBe(200);
    const trend = r.body.findings.find((f: any) => f.category === 'hours_trend');
    expect(trend.metrics).toContainEqual({ label: 'Hours', value: 8, unit: 'hours', previous: 2 });
    expect(trend.basis).toBe('observation');
    expect(r.body.previous).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('keeps a team manager to their own team', async () => {
    const r = await insights(mia, 'workforce');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('Bea');
    expect(text).not.toContain('Team Bravo');
    expect(r.body.findings.find((f: any) => f.category === 'hours_trend').metrics[0].value).toBe(3);
  });

  it('serves each member their own result for the same period (no shared cache)', async () => {
    const a = JSON.stringify((await insights(ada, 'overview')).body);
    const m = JSON.stringify((await insights(mia, 'overview')).body);
    expect(a).not.toBe(m);
    expect(JSON.stringify((await insights(mia, 'workforce')).body)).not.toContain('Bea');
  });

  it('finds overlapping time, which the API never lets anyone create', async () => {
    await withTenant(t.deps.db, orgId, (tx) =>
      tx.insert(timeEntries).values({
        id: newId(), organizationId: orgId, membershipId: walt.membershipId, projectId: alpha, source: 'TRACKED',
        startedAt: new Date('2026-11-03T15:00:00Z'), endedAt: new Date('2026-11-03T16:00:00Z'), durationSeconds: 3600,
        localDate: '2026-11-03', timezone: 'America/New_York', billable: true,
      }),
    );
    const r = await insights(ada, 'timesheets');
    expect(r.status).toBe(200);
    const overlap = r.body.findings.find((f: any) => f.category === 'overlap');
    expect(overlap).toMatchObject({ basis: 'fact', severity: 'warning' });
    expect(overlap.summary).toContain('Walt Worker');
    expect(overlap.metrics[0]).toMatchObject({ value: 1, unit: 'hours' });
  });

  it('notes a project near its budget', async () => {
    const r = await insights(ada, 'projects');
    expect(r.status).toBe(200);
    const near = r.body.findings.find((f: any) => (f.category === 'budget_near' || f.category === 'budget_exceeded') && f.refs[0]?.name === 'Alpha Site');
    expect(near).toBeTruthy();
    expect(near.links).toContain('finance.budgets');
  });

  it('puts the most important findings first on the overview, at most six', async () => {
    const r = await insights(ada, 'overview');
    expect(r.body.findings.length).toBeLessThanOrEqual(6);
    const rank = { warning: 0, attention: 1, info: 2 } as Record<string, number>;
    const order = r.body.findings.map((f: any) => rank[f.severity]);
    expect(order).toEqual([...order].sort((a: number, b: number) => a - b));
  });

  it('never sends emails, private notes or activity', async () => {
    for (const s of ['overview', 'workforce', 'timesheets', 'projects']) {
      const text = JSON.stringify((await insights(ada, s)).body);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
      expect(text).not.toContain('private_note');
      expect(text).not.toContain('activity');
    }
  });

  it('refuses a worker, another organization, an unknown section and a backwards period', async () => {
    expect((await insights(walt.client, 'workforce')).status).toBe(403);
    expect([403, 404]).toContain((await insights(zed, 'workforce')).status);
    expect((await insights(ada, 'payroll')).status).toBe(400);
    expect((await insights(ada, 'workforce', { from: '2026-11-08', to: '2026-11-02' })).status).toBe(400);
    expect((await insights(ada, 'workforce', { from: '2026-01-01', to: '2026-12-31' })).status).toBe(400);
  });
});

describe('AI Insights: final review fixes', () => {
  beforeEach(async () => (await import('../src/services/ai-insights/cache')).insightCache.clear());

  it('I2: a period that runs past today is cut at today, and compared with the same number of days before', async () => {
    const r = await insights(ada, 'workforce', { from: '2026-11-09', to: '2026-11-15' });
    expect(r.status).toBe(200);
    expect(r.body.period).toEqual({ from: '2026-11-09', to: '2026-11-09' });
    expect(r.body.previous).toEqual({ from: '2026-11-08', to: '2026-11-08' });
  });

  it('I3: the approved share counts only approved time inside the period', async () => {
    const sub = await walt.client.post<any>(o('/timesheets/submit'), { date: '2026-11-02' });
    expect(sub.body.status).toBe('SUBMITTED');
    expect((await ada.post(o(`/timesheets/${sub.body.id}/approve`), {})).status).toBe(200);
    // Walt's approved week has no time from 4 to 8 November; Bea's 5 h there are not approved.
    const r = await insights(ada, 'workforce', { from: '2026-11-04', to: '2026-11-08' });
    const share = r.body.findings.find((f: any) => f.category === 'approved_share');
    expect(share.metrics[0]).toMatchObject({ label: 'Approved', value: 0 });
  });

  it('I5: a manager who is also a plain member of another team never sees that team named', async () => {
    const teams = (await ada.get<any>(o('/teams'))).body as Array<{ id: string; name: string; members: Array<{ membership_id: string; role: string }> }>;
    const bravo = teams.find((x) => x.name === 'Team Bravo')!;
    const miaId = teams.find((x) => x.name === 'Team Alpha')!.members.find((m) => m.role === 'MANAGER')!.membership_id;
    expect((await ada.put(o(`/teams/${bravo.id}/members/${miaId}`), { role: 'MEMBER' })).status).toBe(200);
    // The rules only name a team when it has a trend, so check the teams they are given.
    const { workforceInputs } = await import('../src/services/ai-insights/gather');
    const { actorCtx } = await import('./harness');
    const m = await actorCtx(t, 'mia@i.test', orgId);
    const input = await withTenant(t.deps.db, orgId, (tx) => workforceInputs({ ...m, tx }, { from: '2026-11-02', to: '2026-11-08' }, { from: '2026-10-26', to: '2026-11-01' }, '2026-11-09'));
    expect(input.groups.map((g) => g.name)).toEqual(['Team Alpha']);
  });

  it('I8: project hours are summed in the database, per project, within the person’s scope', async () => {
    const { timeEntryTotalsByProject } = await import('../src/services/timesheets');
    const { actorCtx } = await import('./harness');
    const admin = await actorCtx(t, 'ada@i.test', orgId);
    const totals = await withTenant(t.deps.db, orgId, (tx) => timeEntryTotalsByProject({ ...admin, tx }, { from: '2026-11-02', to: '2026-11-08' }));
    expect(totals.get(alpha)).toBe(4 * 3600); // 3 h manual + the 1 h overlapping entry
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(9 * 3600);
  });
});
