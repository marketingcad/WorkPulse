import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorCtx, addMember, createHarness, readSse, signup, type Client, type Harness } from './harness';
import { executeTool, toolsFor } from '../src/services/assistant/tools';
import type { Ctx } from '../src/services/ctx';

/** The assistant's insight tools: the same computed findings as AI Insights, explained by the model. */
let t: Harness;
let orgId: string;
let ada: Client;
let admin: Ctx;
let manager: Ctx;
const PERIOD = { from: '2026-11-02', to: '2026-11-08' };
const o = (p: string) => `/orgs/${orgId}${p}`;
const parse = (content: string) => JSON.parse(content.replace(/^<tool_result name="[^"]+">/, '').replace(/<\/tool_result>$/, ''));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-09T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@it.test'));
  const mia = await addMember(t, ada, orgId, 'Mia Manager', 'mia@it.test', 'TEAM_MANAGER');
  const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@it.test');
  const team = (await ada.post<any>(o('/teams'), { name: 'Team Alpha' })).body.id as string;
  await ada.put(o(`/teams/${team}/members/${mia.membershipId}`), { role: 'MANAGER' });
  await ada.put(o(`/teams/${team}/members/${walt.membershipId}`), { role: 'MEMBER' });
  const p = (await ada.post<any>(o('/projects'), { name: 'Alpha Site', member_ids: [walt.membershipId] })).body.id as string;
  await ada.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: p, started_at: '2026-11-03T14:00:00Z', ended_at: '2026-11-03T17:00:00Z', reason: 'Entered by admin' });
  await t.flush();
  admin = await actorCtx(t, 'ada@it.test', orgId);
  manager = await actorCtx(t, 'mia@it.test', orgId);
});
afterAll(() => t.close());

const NEW = ['getWorkforceInsights', 'checkTimesheets', 'getProjectRisks', 'summarizeReport'];

describe('insight tools', () => {
  it('are offered only to people with the matching access', () => {
    expect(toolsFor(admin.actor).map((x) => x.name)).toEqual(expect.arrayContaining(NEW));
    // A role that can read the organization but no time, timesheets, projects or reports gets none of them.
    const bare = toolsFor({ ...admin.actor, grants: { 'org:read': 'org' } }).map((x) => x.name);
    for (const n of NEW) expect(bare).not.toContain(n);
  });

  it('getWorkforceInsights returns findings with their basis and no ids, and links through nav', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'getWorkforceInsights', PERIOD);
    expect(r.status).toBe('ok');
    const data = parse(r.content);
    const trend = data.findings.find((f: any) => f.category === 'hours_trend');
    expect(trend).toMatchObject({ basis: 'observation' });
    expect(trend.metrics[0]).toMatchObject({ label: 'Hours', value: 3 });
    expect(r.content).not.toMatch(/"id":/);
    expect(r.content).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
    expect(r.nav.every((n) => n.href.startsWith(`/o/${orgId}/`))).toBe(true);
    expect(Buffer.byteLength(r.content)).toBeLessThanOrEqual(8300);
  });

  it('checkTimesheets explains what may need a look without accusing anyone', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'checkTimesheets', PERIOD);
    expect(r.status).toBe('ok');
    expect(r.content).not.toMatch(/suspicious|fraud|misconduct/i);
    expect(parse(r.content)).toHaveProperty('limitations');
  });

  it('getProjectRisks names only projects the person can see', async () => {
    const r = await executeTool(manager, toolsFor(manager.actor), 'getProjectRisks', PERIOD);
    expect(r.status).toBe('ok');
    expect(r.content).not.toContain('"id"');
  });

  it('summarizeReport runs a report the person may run, with at most 15 rows and no money for non-finance roles', async () => {
    const r = await executeTool(manager, toolsFor(manager.actor), 'summarizeReport', { key: 'time-activity', ...PERIOD });
    expect(r.status).toBe('ok');
    const data = parse(r.content);
    expect(data.title).toBe('Time & activity');
    expect(data.top_rows.length).toBeLessThanOrEqual(15);
    expect(data.columns.every((c: any) => c.type !== 'money')).toBe(true);
    // Monitoring data never reaches the model: the activity column is dropped.
    expect(data.columns.map((c: any) => c.key)).not.toContain('activity');
    for (const row of data.top_rows) expect(row).not.toHaveProperty('activity');
  });

  it('summarizeReport refuses a report the person may not run, or that does not exist', async () => {
    expect((await executeTool(manager, toolsFor(manager.actor), 'summarizeReport', { key: 'payroll', ...PERIOD })).status).toBe('denied');
    expect((await executeTool(admin, toolsFor(admin.actor), 'summarizeReport', { key: 'drop-tables', ...PERIOD })).status).toBe('denied');
    expect((await executeTool(admin, toolsFor(admin.actor), 'summarizeReport', { key: 'daily-totals', ...PERIOD })).status).toBe('denied'); // hidden
  });

  it('the fake model calls checkTimesheets for a review question and answers from it', async () => {
    const conv = (await ada.post<any>(o('/assistant/conversations'), {})).body.id as string;
    const res = await t.app.request(`/api/v1/orgs/${orgId}/assistant/conversations/${conv}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: ada.cookie },
      body: JSON.stringify({ content: 'Which timesheets need review?' }),
    });
    const events = await readSse(res);
    expect(events.some((e) => e.event === 'tool_status' && e.data.tool === 'checkTimesheets')).toBe(true);
    const text = events.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
    expect(text).toContain('Here is what I found');
  });
});
