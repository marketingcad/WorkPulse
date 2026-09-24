import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, Client, type Harness } from './harness';
import { seedDemo, DEMO_ADMIN } from '../src/seed';

let t: Harness;
let orgId: string;
beforeAll(async () => {
  t = await createHarness();
  ({ organizationId: orgId } = await seedDemo(t.deps, { days: 3, workers: 8, screenshotDays: 1 }));
}, 600_000);
afterAll(() => t.close());

describe('demo seed', () => {
  it('produces a coherent, realistic workspace through the public API', async () => {
    const c = new Client(t);
    const login = await c.post('/auth/login', { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password });
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
