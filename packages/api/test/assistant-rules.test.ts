import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * WorkPulse AI and AI Insights (QA pass, feature 21).
 *
 * - BUG-91: AI Insights keeps results for five minutes, keyed on the person's role but not on whom they
 *   manage. A manager whose team lost someone kept seeing that person's hours until the result expired.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-09T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@assistant-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('AI Insights after a manager’s team changes (BUG-91)', () => {
  it('stops counting someone who left the team at once', async () => {
    const m = await addMember(t, ada, orgId, 'Mia Manager', 'mia@assistant-rules.test', 'TEAM_MANAGER');
    mia = m.client;
    const walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@assistant-rules.test');
    const team = (await ada.post<{ id: string }>(o('/teams'), { name: 'Team Alpha' })).body.id;
    expect((await ada.put(o(`/teams/${team}/members/${m.membershipId}`), { role: 'MANAGER' })).status).toBe(200);
    expect((await ada.put(o(`/teams/${team}/members/${walt.membershipId}`), { role: 'MEMBER' })).status).toBe(200);
    const project = (await ada.post<{ id: string }>(o('/projects'), { name: 'Alpha Site', member_ids: [walt.membershipId] })).body.id;
    expect((await ada.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: project, started_at: '2026-11-03T14:00:00Z', ended_at: '2026-11-03T17:00:00Z', reason: 'Entered by admin' })).status).toBe(201);
    await t.flush();

    const hours = async () => {
      const r = await mia.get<{ findings: Array<{ category: string; metrics: Array<{ value: number }> }> }>(o('/assistant/insights/workforce?from=2026-11-02&to=2026-11-08'));
      expect(r.status).toBe(200);
      return r.body.findings.find((f) => f.category === 'hours_trend')?.metrics[0]?.value ?? 0;
    };
    expect(await hours()).toBe(3);
    // Walt moves off Mia's team; her role is unchanged.
    expect((await ada.del(o(`/teams/${team}/members/${walt.membershipId}`))).status).toBeLessThan(300);
    expect(await hours()).toBe(0);
  });
});
