import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let orgId: string;
let analyst: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;

/** Invite someone into a custom role and sign them in. */
async function joinWithRole(roleId: string, name: string, email: string) {
  const inv = await admin.post(o('/invitations'), { email, name, role_id: roleId });
  expect(inv.status).toBe(201);
  const token = new URL((inv.body as { invite_url: string }).invite_url).searchParams.get('token')!;
  const c = new Client(t);
  expect((await c.post('/auth/invitations/accept', { token, name, password: 'correct-horse-battery' })).status).toBe(200);
  return c;
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@access.test'));
  // Finance reports without the data grants behind them.
  const role = await admin.post(o('/roles'), { name: 'Report reader', grants: { 'reports:read': 'org', 'reports:finance': 'org', 'time:read': 'org' } });
  expect(role.status).toBe(201);
  analyst = await joinWithRole((role.body as { id: string }).id, 'Rita', 'rita@access.test');
});
afterAll(() => t.close());

describe('report catalog', () => {
  it('lists only reports the viewer can run', async () => {
    const keys = ((await analyst.get(o('/reports'))).body as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['time-activity', 'billing', 'project-budgets']));
    for (const hidden of ['payroll', 'amounts-owed', 'invoices', 'payments', 'expenses', 'work-sessions', 'apps-urls', 'audit-log']) expect(keys).not.toContain(hidden);
  });

  it('refuses to run a report whose data the viewer cannot read', async () => {
    const r = await analyst.post(o('/reports/payroll/query'), { from: '2026-09-01', to: '2026-09-30' });
    expect(r.status).toBe(403);
  });

  it('still shows the full catalog to an admin', async () => {
    const keys = ((await admin.get(o('/reports'))).body as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['payroll', 'amounts-owed', 'invoices', 'audit-log']));
  });
});

describe('roles list', () => {
  it('requires member or role access', async () => {
    expect((await analyst.get(o('/roles'))).status).toBe(403);
    expect((await admin.get(o('/roles'))).status).toBe(200);
  });
});
