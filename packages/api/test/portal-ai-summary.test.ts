import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * The client's AI summary in the portal: off by default, switched on per client, written from the
 * portal's own delivery facts only (no money, hours or people's names), at most once a day per
 * client, with a plain summary when AI is off. Acme sees Website; Globex has its own project.
 */
let t: Harness;
let admin: Client;
let manager: Client;
let orgId: string;
let acme: string;
let carla: Client;
let carlaAccess: string;
let gary: Client;
let garyAccess: string;
let mobile: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const PASSWORD = 'correct-horse-battery';
const tokenOf = (url: string) => new URL(url).searchParams.get('token');
const summary = (c: Client, access: string, headers: Record<string, string> = {}) => c.req<any>('GET', `/portal/${access}/ai-summary`, undefined, headers);
const portalCalls = () => t.ai.calls.filter((c: any) => c.system.startsWith('Summarize project progress for a client of WorkPulse.'));
const system = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => ((await withSystem(t.h.db, (tx) => tx.execute(q))) as unknown as { rows: T[] }).rows;

async function invite(clientId: string, email: string): Promise<{ c: Client; access: string }> {
  const inv = await admin.post<any>(o(`/clients/${clientId}/portal/invitations`), { email });
  const c = new Client(t);
  const r = await c.post<any>('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url), name: email.split('@')[0], password: PASSWORD });
  expect(r.status).toBe(200);
  return { c, access: r.body.access_id };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-10T15:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@pas.test'));
  const walt = await addMember(t, admin, orgId, 'Walt Worker', 'walt@pas.test');
  ({ client: manager } = await addMember(t, admin, orgId, 'Mia', 'mia@pas.test', 'TEAM_MANAGER'));
  acme = (await admin.post<any>(o('/clients'), { name: 'Acme' })).body.id;
  const globex = (await admin.post<any>(o('/clients'), { name: 'Globex' })).body.id;
  const site = (await admin.post<any>(o('/projects'), { name: 'Website', client_id: acme, member_ids: [walt.membershipId] })).body.id;
  mobile = (await admin.post<any>(o('/projects'), { name: 'Mobile app', client_id: acme, member_ids: [walt.membershipId] })).body.id;
  await admin.post(o(`/projects/${mobile}/tasks`), { title: 'Login screen', assignee_ids: [walt.membershipId] });
  const plan = (await admin.post<any>(o('/projects'), { name: 'Secret Globex plan', client_id: globex, member_ids: [walt.membershipId] })).body.id;
  await admin.post(o(`/projects/${plan}/tasks`), { title: 'Draft', assignee_ids: [walt.membershipId] });
  for (let i = 0; i < 4; i++) {
    const task = (await admin.post<any>(o(`/projects/${site}/tasks`), { title: `Page ${i + 1}`, assignee_ids: [walt.membershipId] })).body.id;
    if (i < 2) expect((await admin.patch(o(`/tasks/${task}`), { project_id: site, status: 'DONE' })).status).toBe(200);
  }
  // Billable time with a rate exists, so a leak of money or hours would show.
  await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: site, amount_minor: 15000, currency: 'USD', effective_from: '2020-01-01' });
  await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: site, started_at: '2026-11-09T08:00:00Z', ended_at: '2026-11-09T12:00:00Z', reason: 'Entered by admin' });
  expect((await admin.put(o(`/clients/${acme}/portal`), { enabled: true })).status).toBe(200);
  expect((await admin.put(o(`/clients/${globex}/portal`), { enabled: true, sections: { ai_summary: true } })).status).toBe(200);
  ({ c: carla, access: carlaAccess } = await invite(acme, 'carla@acme.test'));
  ({ c: gary, access: garyAccess } = await invite(globex, 'gary@globex.test'));
  await t.flush();
});
afterAll(() => t.close());

describe('portal AI summary', () => {
  it('is off by default: refused, and nothing reaches the AI', async () => {
    const before = portalCalls().length;
    expect((await admin.get<any>(o(`/clients/${acme}/portal`))).body.sections.ai_summary).toBe(false);
    expect((await summary(carla, carlaAccess)).status).toBe(403);
    expect(portalCalls().length).toBe(before);
  });

  it('only people who manage the client portal can switch it on', async () => {
    expect((await manager.put(o(`/clients/${acme}/portal`), { sections: { ai_summary: true } })).status).toBe(403);
    const r = await admin.put<any>(o(`/clients/${acme}/portal`), { sections: { ai_summary: true } });
    expect(r.status).toBe(200);
    expect(r.body.sections.ai_summary).toBe(true);
  });

  it('writes the summary from delivery facts only: no money, hours, names or another client', async () => {
    const r = await summary(carla, carlaAccess);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: 'ai', day: '2026-11-10' });
    expect(r.body.facts).toContain('Website: 2 of 4 tasks done (50 %).');
    // What the model receives as data (the fixed instructions aside).
    const sent = JSON.stringify(portalCalls().at(-1)!.messages);
    expect(sent).toContain('Website');
    expect(sent).not.toMatch(/Walt|Secret Globex|15000|150\.00|USD|\bhours?\b|_minor/);
    expect(portalCalls().at(-1)!.tools).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/Walt|Secret Globex|_minor/);
  });

  it('is written once a day per client, then stored; a new day writes a new one', async () => {
    const before = portalCalls().length;
    const a = await summary(carla, carlaAccess);
    const { c: dora, access: doraAccess } = await invite(acme, 'dora@acme.test');
    const b = await summary(dora, doraAccess);
    expect(b.body.text).toBe(a.body.text);
    expect(portalCalls().length).toBe(before);
    t.clock.advance(86_400_000);
    const c = await summary(carla, carlaAccess);
    expect(c.body.day).toBe('2026-11-11');
    expect(portalCalls().length).toBe(before + 1);
    const rows = await system<{ day: string }>(sql`select day from portal_ai_summaries where client_id = ${acme}`);
    expect(rows.map((r) => r.day)).toEqual(['2026-11-11']);
  });

  it('falls back to a plain summary when AI is off, and stores nothing', async () => {
    t.clock.advance(86_400_000);
    const saved = t.deps.config.assistantEnabled;
    (t.deps.config as { assistantEnabled: boolean }).assistantEnabled = false;
    try {
      const r = await summary(gary, garyAccess);
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('plain');
      expect(r.body.text).toContain('Secret Globex plan');
      expect(await system(sql`select 1 from portal_ai_summaries where client_id <> ${acme}`)).toEqual([]);
    } finally {
      (t.deps.config as { assistantEnabled: boolean }).assistantEnabled = saved;
    }
  });

  it("another client's access is not found, and every view is audited", async () => {
    expect((await summary(carla, garyAccess)).status).toBe(404);
    const rows = await system<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'portal.ai_summary_viewed'`);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it('is rate limited like the rest of the portal', async () => {
    let last = 0;
    for (let i = 0; i < 125 && last !== 429; i++) last = (await summary(carla, carlaAccess, { 'x-test-rate-limit': 'on' })).status;
    expect(last).toBe(429);
  });
});

describe('portal AI summary: changes, concurrency and failures', () => {
  const lastSent = () => JSON.stringify(portalCalls().at(-1)!.messages);

  it('is rewritten when the admin narrows what the client sees, never showing hidden projects', async () => {
    t.clock.advance(86_400_000);
    await summary(carla, carlaAccess);
    expect(lastSent()).toContain('Website');
    const before = portalCalls().length;
    expect((await admin.put(o(`/clients/${acme}/portal`), { project_ids: [mobile] })).status).toBe(200);
    const r = await summary(carla, carlaAccess);
    expect(r.body.source).toBe('ai');
    expect(portalCalls().length).toBe(before + 1);
    expect(lastSent()).not.toContain('Website');
    expect(JSON.stringify(r.body.facts)).not.toContain('Website');
    // Same scope again: the stored text is served, no new call.
    await summary(carla, carlaAccess);
    expect(portalCalls().length).toBe(before + 1);
    expect((await admin.put(o(`/clients/${acme}/portal`), { project_ids: null })).status).toBe(200);
  });

  it('two first visits at the same moment make one model call', async () => {
    t.clock.advance(86_400_000);
    const before = portalCalls().length;
    const { c: erin, access: erinAccess } = await invite(acme, 'erin@acme.test');
    const [a, b] = await Promise.all([summary(carla, carlaAccess), summary(erin, erinAccess)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(portalCalls().length).toBe(before + 1);
  });

  it('after a provider error: plain summary, a 10-minute pause before trying again, then AI', async () => {
    t.clock.advance(86_400_000);
    const ai = t.ai as unknown as { streamTurn: (...a: unknown[]) => AsyncIterable<unknown> };
    const original = ai.streamTurn;
    let attempts = 0;
    ai.streamTurn = async function* () {
      attempts++;
      throw new Error('provider down');
    };
    try {
      expect((await summary(carla, carlaAccess)).body.source).toBe('plain');
      expect((await summary(carla, carlaAccess)).body.source).toBe('plain');
      expect(attempts).toBe(1);
    } finally {
      ai.streamTurn = original;
    }
    t.clock.advance(11 * 60_000);
    expect((await summary(carla, carlaAccess)).body.source).toBe('ai');
  });
});
