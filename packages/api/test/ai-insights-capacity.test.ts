import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insightCache } from '../src/services/ai-insights/cache';
import { actorCtx, addMember, createHarness, signup, type Client, type Harness } from './harness';
import { executeTool, toolsFor } from '../src/services/assistant/tools';

/**
 * Workload and capacity for the next two weeks. Org: Ada (admin); Mia manages Team Alpha (Walt, on
 * an 8-hour weekday schedule, with 100 h of open estimates); Team Bravo (Bea) has no schedule.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;
const capacity = (c: Client) => c.get<any>(o('/assistant/insights/capacity?from=2026-11-10&to=2026-11-10'));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-10T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@cap.test'));
  const m = await addMember(t, ada, orgId, 'Mia Manager', 'mia@cap.test', 'TEAM_MANAGER');
  mia = m.client;
  const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@cap.test');
  const bea = await addMember(t, ada, orgId, 'Bea Bravo', 'bea@cap.test');
  const teamA = (await ada.post<any>(o('/teams'), { name: 'Team Alpha' })).body.id as string;
  const teamB = (await ada.post<any>(o('/teams'), { name: 'Team Bravo' })).body.id as string;
  await ada.put(o(`/teams/${teamA}/members/${m.membershipId}`), { role: 'MANAGER' });
  await ada.put(o(`/teams/${teamA}/members/${walt.membershipId}`), { role: 'MEMBER' });
  await ada.put(o(`/teams/${teamB}/members/${bea.membershipId}`), { role: 'MEMBER' });
  expect((await ada.post(o('/schedules'), { membership_id: walt.membershipId, name: 'Weekdays', timezone: 'America/New_York', days: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: '09:00', end: '17:00' })), effective_from: '2026-01-05' })).status).toBe(201);
  const p = (await ada.post<any>(o('/projects'), { name: 'Alpha', member_ids: [walt.membershipId], team_ids: [teamA] })).body.id as string;
  // Team Charlie: Cleo is scheduled, has no open work and has tracked nothing yet.
  const cleo = await addMember(t, ada, orgId, "Cleo Charlie", "cleo@cap.test");
  const teamC = (await ada.post<any>(o("/teams"), { name: "Team Charlie" })).body.id as string;
  await ada.put(o(`/teams/${teamC}/members/${cleo.membershipId}`), { role: "MEMBER" });
  expect((await ada.post(o("/schedules"), { membership_id: cleo.membershipId, name: "Weekdays", timezone: "America/New_York", days: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "17:00" })), effective_from: "2026-01-05" })).status).toBe(201);
  expect((await ada.post(o(`/projects/${p}/tasks`), { title: 'Rebuild the site', estimate_seconds: 100 * 3600, due_date: '2026-11-20', assignee_ids: [walt.membershipId] })).status).toBe(201);
  // Work due long after the two weeks, or with no due date, is not part of this window.
  expect((await ada.post(o(`/projects/${p}/tasks`), { title: "Next year's rewrite", estimate_seconds: 500 * 3600, due_date: "2027-03-01", assignee_ids: [walt.membershipId] })).status).toBe(201);
  expect((await ada.post(o(`/projects/${p}/tasks`), { title: "Someday", estimate_seconds: 300 * 3600, assignee_ids: [walt.membershipId] })).status).toBe(201);
});
afterAll(() => t.close());
beforeEach(() => insightCache.clear());

describe('capacity insights', () => {
  it('covers the next two weeks and flags a team whose open work exceeds its scheduled hours', async () => {
    const r = await capacity(ada);
    expect(r.status).toBe(200);
    expect(r.body.period).toEqual({ from: '2026-11-10', to: '2026-11-23' });
    const over = r.body.findings.find((f: any) => f.category === 'overloaded');
    expect(over.refs[0].name).toBe('Team Alpha');
    expect(over.metrics).toContainEqual({ label: 'Open estimates', value: 100, unit: 'hours' });
  });

  it('says when a team has no schedules instead of guessing', async () => {
    expect((await capacity(ada)).body.limitations).toContain('No schedules for Team Bravo; capacity cannot be estimated.');
  });

  it('a team manager sees only their own team', async () => {
    const text = JSON.stringify((await capacity(mia)).body);
    expect(text).toContain('Team Alpha');
    expect(text).not.toContain('Team Bravo');
  });

  it('getCapacityInsights is offered only with schedule and time access', async () => {
    const admin = await actorCtx(t, 'ada@cap.test', orgId);
    expect(toolsFor(admin.actor).map((x) => x.name)).toContain('getCapacityInsights');
    expect(toolsFor({ ...admin.actor, grants: { 'org:read': 'org', 'time:read': 'org' } }).map((x) => x.name)).not.toContain('getCapacityInsights');
    const r = await executeTool(admin, toolsFor(admin.actor), 'getCapacityInsights', { from: '2026-11-10', to: '2026-11-10' });
    expect(r.status).toBe('ok');
  });
});

describe('capacity insights, what counts', () => {
  it('counts only open work due within the two weeks (or overdue), not the whole backlog', async () => {
    const over = (await capacity(ada)).body.findings.find((f: any) => f.category === 'overloaded');
    expect(over.metrics).toContainEqual({ label: 'Open estimates', value: 100, unit: 'hours' });
  });

  it('a team with no tracked time in the last four weeks is never called underused', async () => {
    // Cleo (Team Charlie) is scheduled with no work and no tracked time: her pace is unknown, not zero.
    const r = (await capacity(ada)).body;
    expect(r.findings.filter((f: any) => f.category === 'underused' || f.category === 'redistribute')).toEqual([]);
  });
});
