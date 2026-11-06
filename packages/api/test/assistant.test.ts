import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantConversations, assistantMessages, withSystem } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { eq } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let orgId: string;
let admin2: Client;
let manager: Client;
let worker: Client;
let other: Client;
let otherOrgId: string;
const o = (p: string) => `/orgs/${orgId}/assistant${p}`;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@t.test'));
  ({ client: admin2 } = await addMember(t, admin, orgId, 'Ben', 'ben@t.test', 'SYSTEM_ADMIN'));
  ({ client: manager } = await addMember(t, admin, orgId, 'Mia', 'mia@t.test', 'TEAM_MANAGER'));
  ({ client: worker } = await addMember(t, admin, orgId, 'Walt', 'walt@t.test'));
  ({ client: other, orgId: otherOrgId } = await signup(t, 'Zed', 'zed@o.test'));
});
afterAll(() => t.close());

describe('assistant conversations', () => {
  it('creates, lists, gets, renames and deletes', async () => {
    const created = await admin.post(o('/conversations'), {});
    expect(created.status).toBe(201);
    expect(created.body.title).toBe('New chat');
    const id = created.body.id;
    const named = await admin.post(o('/conversations'), { title: 'Hours' });
    expect(named.body.title).toBe('Hours');

    const list = await admin.get(o('/conversations?page=1&page_size=10'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.data.map((c: any) => c.id)).toContain(id);

    const got = await admin.get(o(`/conversations/${id}`));
    expect(got.status).toBe(200);
    expect(got.body.messages).toEqual([]);

    const renamed = await admin.patch(o(`/conversations/${id}`), { title: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Renamed');

    expect((await admin.req('DELETE', o(`/conversations/${id}`))).status).toBe(204);
    expect((await admin.get(o(`/conversations/${id}`))).status).toBe(404);
  });

  it('keeps conversations private to their member', async () => {
    const id = (await admin.post(o('/conversations'), {})).body.id;
    expect((await admin2.get(o(`/conversations/${id}`))).status).toBe(404);
    expect((await admin2.patch(o(`/conversations/${id}`), { title: 'x' })).status).toBe(404);
    expect((await admin2.req('DELETE', o(`/conversations/${id}`))).status).toBe(404);
    const theirs = await admin2.get(o('/conversations?page=1'));
    expect(theirs.body.data.some((c: any) => c.id === id)).toBe(false);
    // Another organization, through either path.
    expect((await other.get(o(`/conversations/${id}`))).status).toBe(404);
    expect((await other.get(`/orgs/${otherOrgId}/assistant/conversations/${id}`)).status).toBe(404);
    // Still there for its owner.
    expect((await admin.get(o(`/conversations/${id}`))).status).toBe(200);
  });

  it('lets a team manager use it, and refuses workers', async () => {
    expect((await manager.post(o('/conversations'), {})).status).toBe(201);
    expect((await worker.get(`/orgs/${orgId}`)).status).toBe(200);
    const r = await worker.get(o('/conversations'));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('assistant_forbidden');
    expect((await worker.post(o('/conversations'), {})).status).toBe(403);
  });

  it('needs a session and refuses API keys', async () => {
    expect((await new Client(t).get(o('/conversations'))).status).toBe(401);
    const key = new Client(t);
    key.bearer = (await admin.post(`/orgs/${orgId}/api-keys`, { name: 'k', scopes: ['read:projects', 'read:timesheets'] })).body.key;
    expect((await key.get(`/orgs/${orgId}/projects`)).status).toBe(200);
    expect((await key.get(o('/conversations'))).status).toBe(403);
  });

  it('treats a malformed id as not found', async () => {
    expect((await admin.get(o('/conversations/nope'))).status).toBe(404);
    expect((await admin.patch(o('/conversations/nope'), { title: 'x' })).status).toBe(404);
    expect((await admin.req('DELETE', o('/conversations/nope'))).status).toBe(404);
  });

  it('validates titles', async () => {
    const id = (await admin.post(o('/conversations'), {})).body.id;
    expect((await admin.patch(o(`/conversations/${id}`), { title: '' })).status).toBe(400);
    expect((await admin.patch(o(`/conversations/${id}`), { title: 'x'.repeat(121) })).status).toBe(400);
    expect((await admin.post(o('/conversations'), { title: '' })).status).toBe(400);
    expect((await admin.patch(o(`/conversations/${id}`), { title: 'x'.repeat(120) })).status).toBe(200);
  });

  it('caps page_size at 50', async () => {
    expect((await admin.get(o('/conversations?page=1&page_size=51'))).status).toBe(400);
    expect((await admin.get(o('/conversations?page=1&page_size=50'))).status).toBe(200);
    expect((await admin.get(o('/conversations?page=1&page_size=0'))).status).toBe(400);
  });

  it('lists the most recent activity first, falling back to created_at', async () => {
    const a = (await manager.post(o('/conversations'), { title: 'A old chat' })).body.id;
    const b = (await manager.post(o('/conversations'), { title: 'B newer chat' })).body.id;
    const c = (await manager.post(o('/conversations'), { title: 'C never messaged' })).body.id;
    const base = Date.now() + 10 * 3600_000;
    await withSystem(t.deps.db, async (tx) => {
      await tx.update(assistantConversations).set({ createdAt: new Date(base), lastMessageAt: new Date(base + 1000) }).where(eq(assistantConversations.id, a));
      await tx.update(assistantConversations).set({ createdAt: new Date(base), lastMessageAt: new Date(base + 5000) }).where(eq(assistantConversations.id, b));
      await tx.update(assistantConversations).set({ createdAt: new Date(base + 3000), lastMessageAt: null }).where(eq(assistantConversations.id, c));
    });
    const ids = (await manager.get(o('/conversations?page=1'))).body.data.map((x: any) => x.id);
    expect(ids.slice(0, 3)).toEqual([b, c, a]);
  });

  it('returns messages oldest first, capped at the oldest 200', async () => {
    const id = (await admin.post(o('/conversations'), {})).body.id;
    const base = Date.now();
    await withSystem(t.deps.db, async (tx) => {
      await tx.insert(assistantMessages).values(
        Array.from({ length: 201 }, (_, i) => ({ id: newId(), organizationId: orgId, conversationId: id, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}`, createdAt: new Date(base + i * 1000) })),
      );
    });
    const msgs = (await admin.get(o(`/conversations/${id}`))).body.messages;
    expect(msgs).toHaveLength(200);
    expect(msgs[0].content).toBe('m0');
    expect(msgs[199].content).toBe('m199');
    expect(msgs.map((m: any) => m.content)).not.toContain('m200');
  });

  it('resolves nav links on read from the reader permissions', async () => {
    const make = async (who: Client) => {
      const id = (await who.post(o('/conversations'), {})).body.id;
      await withSystem(t.deps.db, async (tx) => {
        await tx.insert(assistantMessages).values({
          id: newId(), organizationId: orgId, conversationId: id, role: 'assistant', content: 'go',
          navTargets: ['timesheets.approvals', 'finance.payroll', 'not.a.key'], toolCalls: [{ name: 'get_x', args: { secret: 1 }, status: 'ok' }],
        });
      });
      return (await who.get(o(`/conversations/${id}`))).body.messages[0];
    };
    const forAdmin = await make(admin);
    expect(forAdmin.nav.map((n: any) => n.key)).toEqual(['timesheets.approvals', 'finance.payroll']);
    expect(forAdmin.tool_calls).toEqual([{ name: 'get_x', status: 'ok' }]);
    const forManager = await make(manager);
    expect(forManager.nav).toEqual([{ key: 'timesheets.approvals', label: 'Approvals', href: `/o/${orgId}/timesheets/approvals` }]);
  });

  it('deletes a conversation together with its messages', async () => {
    const id = (await admin.post(o('/conversations'), {})).body.id;
    await withSystem(t.deps.db, async (tx) => {
      await tx.insert(assistantMessages).values({ id: newId(), organizationId: orgId, conversationId: id, role: 'user', content: 'hi' });
    });
    expect((await admin.req('DELETE', o(`/conversations/${id}`))).status).toBe(204);
    const left = await withSystem(t.deps.db, (tx) => tx.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)));
    expect(left).toEqual([]);
  });

  it('answers with rate limiting on, and returns 429 past 120 a minute', async () => {
    const on = { 'x-test-rate-limit': 'on' };
    for (let i = 0; i < 12; i++) expect((await admin.req('GET', o('/conversations?page=1'), undefined, on)).status).toBe(200);
    expect((await admin.get(`/orgs/${orgId}`)).status).toBe(200);
    // Mia's bucket is separate: 120 requests pass, the 121st is limited.
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await manager.req('GET', o('/conversations?page=1&page_size=1'), undefined, on)).status);
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
  });
});
