import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rateLimitBuckets } from '@tallywork/db';
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
    expect((await other.get(o(`/conversations/${id}`))).status).toBeGreaterThanOrEqual(403);
    expect((await other.get(`/orgs/${otherOrgId}/assistant/conversations/${id}`)).status).toBe(404);
    // Still there for its owner.
    expect((await admin.get(o(`/conversations/${id}`))).status).toBe(200);
  });

  it('lets a team manager use it, and refuses workers', async () => {
    expect((await manager.post(o('/conversations'), {})).status).toBe(201);
    const r = await worker.get(o('/conversations'));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('assistant_forbidden');
    expect((await worker.post(o('/conversations'), {})).status).toBe(403);
  });

  it('needs a session and refuses API keys', async () => {
    expect((await new Client(t).get(o('/conversations'))).status).toBe(401);
    const key = new Client(t);
    key.bearer = (await admin.post(`/orgs/${orgId}/api-keys`, { name: 'k', scopes: ['read:projects', 'read:timesheets'] })).body.key;
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

  it('answers with rate limiting on, in the assistant:crud bucket', async () => {
    const on = { 'x-test-rate-limit': 'on' };
    for (let i = 0; i < 12; i++) expect((await admin.req('GET', o('/conversations'), undefined, on)).status).toBe(200);
    const rows = await t.deps.db.select().from(rateLimitBuckets);
    const row = rows.find((r) => r.key.startsWith('assistant:crud:'));
    expect(row?.count).toBe(12);
    expect((await admin.get(`/orgs/${orgId}`)).status).toBe(200);
  });
});
