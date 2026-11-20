import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

/**
 * Clients and client folders (QA pass, feature 5).
 *
 * - BUG-78: restoring an archived client gave two active clients the same name, which creating or
 *   renaming refuses.
 * - BUG-79: a role limited to the clients of its own projects could create a client, and got an empty answer.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@client-rules.test'));
  expect((await admin.patch(o(''), { settings: { clientFolders: true } })).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

describe('deleting a client', () => {
  it('deletes its folder too', async () => {
    const client = (await admin.post<{ id: string }>(o('/clients'), { name: 'Folded Co' })).body.id;
    expect((await admin.post(o('/client-folders'), { client_id: client })).status).toBe(201);
    expect((await admin.del(o(`/clients/${client}`))).status).toBe(204);
    const left = (await withSystem(t.h.db, (tx) => tx.execute(sql`select id from client_folders where client_id = ${client}::uuid`))) as { rows: unknown[] };
    expect(left.rows).toHaveLength(0);
  });
});

describe('restoring a client (BUG-78)', () => {
  it('is refused while an active client has its name', async () => {
    const old = (await admin.post<{ id: string }>(o('/clients'), { name: 'Acme' })).body.id;
    expect((await admin.post(o(`/clients/${old}/archive`))).status).toBe(204);
    expect((await admin.post(o('/clients'), { name: 'acme ' })).status).toBe(201);
    const r = await admin.post<{ code: string }>(o(`/clients/${old}/restore`));
    expect([r.status, r.body.code]).toEqual([409, 'duplicate_name']);
    const active = (await admin.get<Array<{ name: string }>>(o('/clients'))).body.filter((c) => c.name.trim().toLowerCase() === 'acme');
    expect(active).toHaveLength(1);
  });
});

describe('a role limited to its projects’ clients (BUG-79)', () => {
  it('can’t create a client it would not be able to see', async () => {
    const role = (await admin.post<{ id: string }>(o('/roles'), { name: 'Account lead', grants: { 'clients:read': 'assigned', 'clients:manage': 'assigned', 'projects:read': 'assigned' } })).body.id;
    const inv = await admin.post<{ invite_url: string }>(o('/invitations'), { email: 'lea@client-rules.test', name: 'Lea', role_id: role });
    const lea = new Client(t);
    expect((await lea.post('/auth/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token'), name: 'Lea', password: 'correct-horse-battery' })).status).toBe(200);
    const r = await lea.post<{ id?: string }>(o('/clients'), { name: 'Lea’s new client' });
    expect(r.status).toBe(403);
  });
});
