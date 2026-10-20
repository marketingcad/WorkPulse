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
    expect(keys).toEqual(expect.arrayContaining(['time-activity', 'billing']));
    // Budget reports follow the Budgets page: no budget access, no budget report.
    for (const hidden of ['payroll', 'amounts-owed', 'invoices', 'payments', 'expenses', 'budgets', 'project-budgets', 'work-sessions', 'apps-urls', 'audit-log']) expect(keys).not.toContain(hidden);
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

describe('finance reports follow the matching pages', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };

  it('Payroll Export needs payroll access, not billing access', async () => {
    const billing = await admin.post(o('/roles'), { name: 'Billing analyst', grants: { 'reports:read': 'org', 'reports:finance': 'org', 'billing:read': 'org', 'rates:read': 'org' } });
    const payroll = await admin.post(o('/roles'), { name: 'Payroll clerk', grants: { 'reports:read': 'org', 'reports:finance': 'org', 'payroll:read': 'org' } });
    const bill = await joinWithRole((billing.body as { id: string }).id, 'Bill', 'bill@access.test');
    const pam = await joinWithRole((payroll.body as { id: string }).id, 'Pam', 'pam@access.test');

    expect(((await bill.get(o('/reports'))).body as Array<{ key: string }>).map((r) => r.key)).not.toContain('payroll');
    expect((await bill.post(o('/reports/payroll/query'), range)).status).toBe(403);
    expect((await bill.post(o('/reports/payroll/export-runs'), { ...range, format: 'CSV' })).status).toBe(403);

    expect(((await pam.get(o('/reports'))).body as Array<{ key: string }>).map((r) => r.key)).toContain('payroll');
    expect((await pam.post(o('/reports/payroll/query'), range)).status).toBe(200);
  });

  it('a report reader without expense or budget access cannot export those reports either', async () => {
    const role = await admin.post(o('/roles'), { name: 'Time reader', grants: { 'reports:read': 'org', 'time:read': 'org' } });
    const tim = await joinWithRole((role.body as { id: string }).id, 'Tim', 'tim@access.test');
    for (const key of ['expenses', 'budgets']) {
      expect((await tim.post(o(`/reports/${key}/query`), range)).status, key).toBe(403);
      expect((await tim.post(o(`/reports/${key}/export-runs`), { ...range, format: 'CSV' })).status, key).toBe(403);
    }
  });
});
