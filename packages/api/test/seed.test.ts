import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, Client, type Harness } from './harness';
import { seedDemo, DEMO_ADMIN, demoPeople, MAX_DEMO_WORKERS } from '../src/seed';

describe('demo people', () => {
  it('gives 100 people unique names and emails, keeping the original first 30', () => {
    const people = demoPeople(100);
    expect(people).toHaveLength(100);
    expect(new Set(people.map((p) => p.name)).size).toBe(100);
    expect(new Set(people.map((p) => p.email)).size).toBe(100);
    expect(people[0]).toEqual({ name: 'Maya Chen', email: 'maya.chen@demo.tallywork.app' });
    expect(people[24]).toEqual({ name: "Grace O'Neill", email: 'grace.oneill@demo.tallywork.app' });
    for (const p of people) expect(p.email).toMatch(/^[a-z]+\.[a-z]+@demo\.tallywork\.app$/);
  });

  it('stays unique up to the maximum and never goes past it', () => {
    const all = demoPeople(MAX_DEMO_WORKERS + 50);
    expect(all).toHaveLength(MAX_DEMO_WORKERS);
    expect(new Set(all.map((p) => p.email)).size).toBe(MAX_DEMO_WORKERS);
    expect(demoPeople(0)).toEqual([]);
    expect(demoPeople(-5)).toEqual([]);
  });
});

let t: Harness;
let orgId: string;
// A private password, as used for any database reachable from the internet.
const PASSWORD = 'a-private-demo-password-for-tests';
beforeAll(async () => {
  t = await createHarness();
  ({ organizationId: orgId } = await seedDemo(t.deps, { days: 3, workers: 8, screenshotDays: 1, password: PASSWORD }));
}, 600_000);
afterAll(() => t.close());

describe('demo seed', () => {
  it('produces a coherent, realistic workspace through the public API', async () => {
    const c = new Client(t);
    // The public local-demo password does not open a seeded workspace that was given its own.
    expect((await new Client(t).post('/auth/login', { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password })).status).toBe(401);
    const login = await c.post('/auth/login', { email: DEMO_ADMIN.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const workers = await c.get(`/orgs/${orgId}/workers`);
    expect(workers.body.length).toBe(9);
    const w = await c.get(`/orgs/${orgId}/dashboard/widgets?keys=tracked_week,hours_by_project,project_budgets,invoices`);
    expect(w.body.hours_by_project.length).toBeGreaterThan(0);
    expect(w.body.project_budgets.length).toBeGreaterThan(0);
    const r = await c.post(`/orgs/${orgId}/reports/time-activity/query`, { from: new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
    expect(r.body.totals.total).toBeGreaterThan(3600);
  }, 120_000);
});
