import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorCtx, addMember, createHarness, signup, type Client, type Harness } from './harness';
import { executeTool, toolsFor } from '../src/services/assistant/tools';
import type { Ctx } from '../src/services/ctx';

/**
 * explainPerformance: why a Performance Center score moved, from the scores the Performance Center
 * computes. Never review notes; never someone the person may not see. Org: Ada (admin); Mia manages
 * Team Alpha (Walt); Bea is in Team Bravo.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let admin: Ctx;
let manager: Ctx;
let worker: Ctx;
const PERIOD = { from: '2026-10-01', to: '2026-10-31' };
const parse = (content: string) => JSON.parse(content.replace(/^<tool_result name="[^"]+">/, '').replace(/<\/tool_result>$/, ''));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-10T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@pt.test'));
  const o = (p: string) => `/orgs/${orgId}${p}`;
  const mia = await addMember(t, ada, orgId, 'Mia Manager', 'mia@pt.test', 'TEAM_MANAGER');
  const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@pt.test');
  const bea = await addMember(t, ada, orgId, 'Bea Bravo', 'bea@pt.test');
  const teamA = (await ada.post<any>(o('/teams'), { name: 'Team Alpha' })).body.id as string;
  const teamB = (await ada.post<any>(o('/teams'), { name: 'Team Bravo' })).body.id as string;
  await ada.put(o(`/teams/${teamA}/members/${mia.membershipId}`), { role: 'MANAGER' });
  await ada.put(o(`/teams/${teamA}/members/${walt.membershipId}`), { role: 'MEMBER' });
  await ada.put(o(`/teams/${teamB}/members/${bea.membershipId}`), { role: 'MEMBER' });
  admin = await actorCtx(t, 'ada@pt.test', orgId);
  manager = await actorCtx(t, 'mia@pt.test', orgId);
  worker = await actorCtx(t, 'walt@pt.test', orgId);
});
afterAll(() => t.close());

describe('explainPerformance', () => {
  it('explains a member the admin may see, from the Performance Center score, never review notes', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'explainPerformance', { ...PERIOD, member: 'Walt Worker' });
    expect(r.status).toBe('ok');
    const data = parse(r.content);
    expect(data.member).toBe('Walt Worker');
    expect(Array.isArray(data.findings)).toBe(true);
    // Too little measured for a new member: it says so instead of inventing a score.
    expect(data.limitations).toContain('Not enough measured this period to give a score.');
    expect(r.content).not.toMatch(/private_note|note/i);
  });

  it('a team manager cannot explain someone outside their team', async () => {
    const r = await executeTool(manager, toolsFor(manager.actor), 'explainPerformance', { ...PERIOD, member: 'Bea Bravo' });
    expect(r.status).toBe('ok');
    expect(parse(r.content).note).toBe('No matching member you can see.');
  });

  it('asks for a name rather than guessing whose score to explain', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'explainPerformance', PERIOD);
    expect(parse(r.content).note).toBe('Name the person whose score you want explained.');
  });

  it('is offered only with performance access, and a worker cannot read scores the organization does not share', async () => {
    expect(toolsFor({ ...admin.actor, grants: { 'org:read': 'org' } }).map((x) => x.name)).not.toContain('explainPerformance');
    const r = await executeTool(worker, toolsFor(worker.actor), 'explainPerformance', { ...PERIOD, member: 'Walt Worker' });
    expect(['denied', 'ok']).toContain(r.status);
    if (r.status === 'ok') expect(parse(r.content).note).toBe('No matching member you can see.');
  });
});
