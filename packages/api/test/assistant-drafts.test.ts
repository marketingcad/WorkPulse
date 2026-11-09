import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * Drafts: the AI writes text from facts the person may see; the person edits and sends it. Nothing is
 * stored, sent or published. Org: Ada (admin); Mia manages Team Alpha (Walt); Bea is in Team Bravo
 * on the Beta project, which Mia cannot see.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let mia: Client;
let walt: Client;
let alpha: string;
let beta: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const draft = (c: Client, body: unknown) => c.post<any>(o('/assistant/drafts'), body);

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-10T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@d.test'));
  const m = await addMember(t, ada, orgId, 'Mia Manager', 'mia@d.test', 'TEAM_MANAGER');
  mia = m.client;
  const w = await addMember(t, ada, orgId, 'Walt Worker', 'walt@d.test');
  walt = w.client;
  const b = await addMember(t, ada, orgId, 'Bea Bravo', 'bea@d.test');
  const teamA = (await ada.post<any>(o('/teams'), { name: 'Team Alpha' })).body.id as string;
  const teamB = (await ada.post<any>(o('/teams'), { name: 'Team Bravo' })).body.id as string;
  await ada.put(o(`/teams/${teamA}/members/${m.membershipId}`), { role: 'MANAGER' });
  await ada.put(o(`/teams/${teamA}/members/${w.membershipId}`), { role: 'MEMBER' });
  await ada.put(o(`/teams/${teamB}/members/${b.membershipId}`), { role: 'MEMBER' });
  alpha = (await ada.post<any>(o('/projects'), { name: 'Alpha Site', member_ids: [w.membershipId, m.membershipId], team_ids: [teamA] })).body.id as string;
  beta = (await ada.post<any>(o('/projects'), { name: 'Beta Secret', member_ids: [b.membershipId] })).body.id as string;
  // Last week both worked and neither submitted a timesheet.
  for (const [who, p] of [[w.membershipId, alpha], [b.membershipId, beta]] as const)
    await ada.post(o('/manual-time'), { membership_id: who, project_id: p, started_at: '2026-11-03T14:00:00Z', ended_at: '2026-11-03T16:00:00Z', reason: 'Entered by admin' });
});
afterAll(() => t.close());

describe('drafts', () => {
  it('drafts a project description from the project’s own facts, and says which', async () => {
    const r = await draft(ada, { kind: 'project_description', project_id: alpha });
    expect(r.status).toBe(200);
    expect(r.body.text).toMatch(/^Draft:/);
    expect(r.body.facts_used.join(' ')).toContain('Alpha Site');
    const call = t.ai.calls[t.ai.calls.length - 1]!;
    expect(call.tools).toEqual([]);
    expect(call.system).toContain('Never invent names, numbers, dates, prices or policies.');
    expect(JSON.stringify(call)).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });

  it('refuses a project the person cannot see, without calling the AI', async () => {
    const before = t.ai.calls.length;
    expect((await draft(mia, { kind: 'project_description', project_id: beta })).status).toBe(404);
    expect(t.ai.calls.length).toBe(before);
  });

  it('a reminder draft names only people in the person’s scope', async () => {
    const r = await draft(mia, { kind: 'timesheet_reminder', from: '2026-11-02', to: '2026-11-08' });
    expect(r.status).toBe(200);
    const sent = JSON.stringify(t.ai.calls[t.ai.calls.length - 1]);
    expect(sent).toContain('Walt Worker');
    expect(sent).not.toContain('Bea Bravo');
    expect(r.body.facts_used.join(' ')).toContain('Walt Worker');
  });

  it('rewrites given text, and refuses text over 4000 characters', async () => {
    const r = await draft(ada, { kind: 'rewrite', text: 'pls fix the thing asap', style: 'professional' });
    expect(r.status).toBe(200);
    expect(typeof r.body.text).toBe('string');
    expect((await draft(ada, { kind: 'rewrite', text: 'a'.repeat(4001), style: 'improve' })).status).toBe(400);
  });

  it('says the AI is unavailable, with no partial text', async () => {
    const r = await draft(ada, { kind: 'rewrite', text: 'error-test', style: 'improve' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ai_unavailable');
    expect(r.body.text).toBeUndefined();
  });

  it('refuses a worker', async () => {
    expect((await draft(walt, { kind: 'rewrite', text: 'hello', style: 'improve' })).status).toBe(403);
  });
});
