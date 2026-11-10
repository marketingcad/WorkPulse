import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, withTenant } from '@tallywork/db';
import { insightCache } from '../src/services/ai-insights/cache';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Finance insights: payroll and billing for people with finance access only, in minor units with
 * their currency, from the existing finance services; every view is audited. Org: Ada (admin),
 * Mia (team manager, no finance), Ivy (custom role: invoices only), Walt (worker with a pay rate).
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
let ivy: Client;
let roleId: string;
const THIS = { from: '2026-11-02', to: '2026-11-08' };
const o = (p: string) => `/orgs/${orgId}${p}`;
const finance = (c: Client) => c.get<any>(o(`/assistant/insights/finance?from=${THIS.from}&to=${THIS.to}`));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-09T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@fi.test'));
  mia = (await addMember(t, ada, orgId, 'Mia Manager', 'mia@fi.test', 'TEAM_MANAGER')).client;
  const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@fi.test');
  // A custom role that may read invoices, but not payroll, rates or billing.
  const role = (roleId = (await ada.post<any>(o('/roles'), { name: 'Invoices only', grants: { 'org:read': 'org', 'invoices:read': 'org' } })).body.id as string);
  const inv = await ada.post<any>(o('/invitations'), { email: 'ivy@fi.test', name: 'Ivy Invoices', role_id: role });
  ivy = new Client(t);
  const token = new URL(inv.body.invite_url).searchParams.get('token');
  expect((await ivy.post('/auth/invitations/accept', { token, name: 'Ivy Invoices', password: 'correct-horse-battery' })).status).toBe(200);
  // Walt has a pay rate and unapproved time this pay period, so the forecast has something to price.
  expect((await ada.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: walt.membershipId, amount_minor: 2500, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  const p = (await ada.post<any>(o('/projects'), { name: 'Alpha', member_ids: [walt.membershipId] })).body.id as string;
  await ada.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: p, started_at: '2026-11-09T13:00:00Z', ended_at: '2026-11-09T15:00:00Z', reason: 'Entered by admin' });
  await t.flush();
});
afterAll(() => t.close());
beforeEach(() => insightCache.clear());

const audits = () => withTenant(t.deps.db, orgId, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.action, 'insights.finance_viewed'))));

describe('finance insights', () => {
  it('gives the admin a payroll forecast as an estimate, in minor units with its currency, and audits the view', async () => {
    const before = (await audits()).length;
    const r = await finance(ada);
    expect(r.status).toBe(200);
    const forecast = r.body.findings.find((f: any) => f.category === 'payroll_forecast');
    expect(forecast.basis).toBe('estimate');
    // 2 h at $25.00 = 5000 cents, estimated by the existing pricing (no approved time yet).
    expect(forecast.metrics).toContainEqual({ label: 'Expected pay', value: 5000, unit: 'money', currency: 'USD' });
    const rows = await audits();
    expect(rows.length).toBe(before + 1);
    expect(JSON.stringify(rows[rows.length - 1]!.metadata)).not.toMatch(/minor|5000/);
  });

  it('gives a team manager nothing about money, says why, and audits nothing', async () => {
    const before = (await audits()).length;
    const r = await finance(mia);
    expect(r.status).toBe(200);
    expect(r.status).toBe(200);
    expect(r.body.findings).toEqual([]);
    expect(r.body.limitations).toContain('Payroll insights need payroll access.');
    expect(JSON.stringify(r.body)).not.toMatch(/_minor|"money"|USD/);
    expect((await audits()).length).toBe(before);
  });

  it('a role with invoice access only sees billing, never payroll', async () => {
    const r = await finance(ivy);
    expect(r.status).toBe(200);
    expect(r.body.limitations).toContain('Payroll insights need payroll access.');
    expect(r.body.limitations).not.toContain('Invoice and payment insights need invoice or payment access.');
    expect(r.body.findings.some((f: any) => f.category.startsWith('payroll'))).toBe(false);
  });
});

describe('finance insights and the 5-minute cache', () => {
  it('audits every view, also when the answer comes from the cache', async () => {
    const before = (await audits()).length;
    await finance(ada);
    await finance(ada);
    expect((await audits()).length).toBe(before + 2);
  });

  it('never serves a cached answer after the person loses access', async () => {
    expect((await finance(ivy)).body.limitations).not.toContain('Invoice and payment insights need invoice or payment access.');
    expect((await ada.put(o(`/roles/${roleId}`), { name: 'Invoices only', grants: { 'org:read': 'org', 'projects:read': 'org' } })).status).toBe(200);
    const r = await finance(ivy);
    expect(r.status).toBe(200);
    expect(r.body.findings).toEqual([]);
    expect(r.body.limitations).toContain('Invoice and payment insights need invoice or payment access.');
    expect(JSON.stringify(r.body)).not.toMatch(/"money"|_minor/);
    // Restore the role for the tests that follow.
    expect((await ada.put(o(`/roles/${roleId}`), { name: 'Invoices only', grants: { 'org:read': 'org', 'invoices:read': 'org' } })).status).toBe(200);
  });
});

describe('getFinancialInsights tool', () => {
  it('is offered to finance roles only, and answers with money in minor units and its currency', async () => {
    const { actorCtx } = await import('./harness');
    const { executeTool, toolsFor } = await import('../src/services/assistant/tools');
    const admin = await actorCtx(t, 'ada@fi.test', orgId);
    const manager = await actorCtx(t, 'mia@fi.test', orgId);
    expect(toolsFor(manager.actor).map((x) => x.name)).not.toContain('getFinancialInsights');
    const r = await executeTool(admin, toolsFor(admin.actor), 'getFinancialInsights', THIS);
    expect(r.status).toBe('ok');
    expect(r.content).toContain('"unit":"money","currency":"USD"');
  });
});
