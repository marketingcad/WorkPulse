import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insightCache } from '../src/services/ai-insights/cache';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * Forecasts in AI Insights (estimates computed in code): when a project will finish at the recent
 * pace, and this month's hours and pay at month end. Today is Tuesday 10 November 2026: six weekdays
 * of November have passed, of 21. Org: Ada (admin); Mia manages a team that is not on project Web;
 * Walt (pay rate $25.00) recorded 60 h on 2–6 and 9 November, and finished 8 of 18 tasks on Web.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;
const section = (c: Client, s: string) => c.get<any>(o(`/assistant/insights/${s}?from=2026-11-02&to=2026-11-08`));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-10T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@fc.test'));
  mia = (await addMember(t, ada, orgId, 'Mia Manager', 'mia@fc.test', 'TEAM_MANAGER')).client;
  const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@fc.test');
  expect((await ada.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: walt.membershipId, amount_minor: 2500, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  const web = (await ada.post<any>(o('/projects'), { name: 'Web', member_ids: [walt.membershipId], end_date: '2026-11-20' })).body.id as string;
  for (let i = 0; i < 18; i++) {
    const task = (await ada.post<any>(o(`/projects/${web}/tasks`), { title: `Task ${i + 1}`, assignee_ids: [walt.membershipId] })).body.id as string;
    if (i < 8) expect((await ada.patch(o(`/tasks/${task}`), { project_id: web, status: 'DONE' })).status).toBe(200);
  }
  for (const day of ['02', '03', '04', '05', '06', '09']) {
    const r = await ada.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: web, started_at: `2026-11-${day}T08:00:00Z`, ended_at: `2026-11-${day}T18:00:00Z`, reason: 'Entered by admin' });
    expect(r.status).toBe(201);
  }
  await t.flush();
});
afterAll(() => t.close());
beforeEach(() => insightCache.clear());

describe('forecasts in AI Insights', () => {
  it('estimates when a project will finish, and flags a likely late finish', async () => {
    const r = await section(ada, 'projects');
    expect(r.status).toBe(200);
    const f = r.body.findings.find((x: any) => x.category === 'finish_forecast');
    // 10 open tasks at 2 a week = 5 weeks: around 15 December, after the 20 November end date.
    expect(f).toMatchObject({ basis: 'estimate', severity: 'attention' });
    expect(f.summary).toContain('2026-12-15');
    expect(f.refs[0].name).toBe('Web');
  });

  it('projects month-end hours from the weekdays so far', async () => {
    const f = (await section(ada, 'workforce')).body.findings.find((x: any) => x.category === 'month_end_hours');
    expect(f.basis).toBe('estimate');
    expect(f.period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(f.metrics).toContainEqual({ label: 'So far', value: 60, unit: 'hours' });
    expect(f.metrics).toContainEqual({ label: 'Projected', value: 210, unit: 'hours' });
  });

  it('projects month-end pay in minor units with its currency, for finance roles', async () => {
    const f = (await section(ada, 'finance')).body.findings.find((x: any) => x.category === 'month_end_pay');
    // 60 h at $25.00 = $1,500.00 so far; × 21 / 6 = $5,250.00.
    expect(f.metrics).toContainEqual({ label: 'So far', value: 150000, unit: 'money', currency: 'USD' });
    expect(f.metrics).toContainEqual({ label: 'Projected', value: 525000, unit: 'money', currency: 'USD' });
  });

  it('a team manager gets no pay forecast and nothing about a project outside their scope', async () => {
    const fin = (await section(mia, 'finance')).body;
    expect(fin.findings.some((x: any) => x.category === 'month_end_pay')).toBe(false);
    expect(JSON.stringify(fin)).not.toMatch(/"money"|_minor/);
    const proj = JSON.stringify((await section(mia, 'projects')).body);
    expect(proj).not.toContain('Web');
  });
});
