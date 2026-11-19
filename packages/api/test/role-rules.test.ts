import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Roles and the access review (QA pass, feature 3).
 *
 * - BUG-45: anyone allowed to manage some members (one team, say) could open the access review of the
 *   whole organization: every member's email and two-factor status, every role and API key.
 * - BUG-46: a role named in any invitation, even a revoked one, could not be deleted, and the refusal
 *   said "Something this refers to no longer exists".
 * - BUG-47: a removed member could be made active again by changing their status, without being invited.
 * - BUG-48: the access review counted expired API keys as active.
 * - Role edits recorded only the new grants, so the audit log couldn't say what was taken away.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const roleId = async (key: string) => (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body.find((r) => r.key === key)!.id;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@role-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('the access review (BUG-45)', () => {
  it('is for people who manage the whole organization, not one team', async () => {
    const lead = await admin.post<{ id: string }>(o('/roles'), { name: 'Team people lead', grants: { 'members:read': 'team', 'members:manage': 'team' } });
    expect(lead.status).toBe(201);
    const pat = await addMember(t, admin, orgId, 'Pat', 'pat@role-rules.test');
    expect((await admin.patch(o(`/workers/${pat.membershipId}`), { role_id: lead.body.id })).status).toBe(200);

    const r = await pat.client.get(o('/permissions/review'));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('ada@role-rules.test');
    expect((await admin.get(o('/permissions/review'))).status).toBe(200);
  });

  it('counts only API keys that still work (BUG-48)', async () => {
    const live = await admin.post<{ id: string }>(o('/api-keys'), { name: 'Live key', scopes: ['read:projects'] });
    const old = await admin.post<{ id: string }>(o('/api-keys'), { name: 'Old key', scopes: ['read:projects'] });
    expect(live.status).toBe(201);
    await withSystem(t.h.db, (tx) => tx.execute(sql`update api_keys set expires_at = now() - interval '1 day' where id = ${old.body.id}`));
    const keys = (await admin.get<{ api_keys: Array<{ id: string }> }>(o('/permissions/review'))).body.api_keys.map((k) => k.id);
    expect(keys).toContain(live.body.id);
    expect(keys).not.toContain(old.body.id);
  });
});

describe('deleting a role named in invitations (BUG-46)', () => {
  it('is refused, saying why, while an invitation with it is pending', async () => {
    const role = (await admin.post<{ id: string }>(o('/roles'), { name: 'Contractor', grants: { 'time:read': 'own' } })).body.id;
    const inv = await admin.post<{ id: string }>(o('/invitations'), { email: 'cora@role-rules.test', name: 'Cora', role_id: role });
    expect(inv.status).toBe(201);
    expect((await admin.get<Array<{ id: string; in_use: boolean }>>(o('/roles'))).body.find((r) => r.id === role)?.in_use).toBe(true);
    const r = await admin.del(o(`/roles/${role}`));
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/invitation/i);
  });

  it('works once the invitation is revoked', async () => {
    const role = (await admin.post<{ id: string }>(o('/roles'), { name: 'Seasonal', grants: { 'time:read': 'own' } })).body.id;
    const inv = await admin.post<{ id: string }>(o('/invitations'), { email: 'sid@role-rules.test', name: 'Sid', role_id: role });
    expect((await admin.del(o(`/invitations/${inv.body.id}`))).status).toBeLessThan(300);
    expect((await admin.get<Array<{ id: string; in_use: boolean }>>(o('/roles'))).body.find((r) => r.id === role)?.in_use).toBe(false);
    expect((await admin.del(o(`/roles/${role}`))).status).toBe(204);
  });
});

describe('a removed member (BUG-47)', () => {
  it('comes back only by invitation, not by a status change', async () => {
    const lee = await addMember(t, admin, orgId, 'Lee', 'lee@role-rules.test');
    expect((await admin.del(o(`/workers/${lee.membershipId}`))).status).toBeLessThan(300);
    const r = await admin.patch(o(`/workers/${lee.membershipId}`), { status: 'ACTIVE' });
    expect(r.status).toBe(422);
    const w = await admin.get<{ status: string }>(o(`/workers/${lee.membershipId}`));
    expect(w.body.status).toBe('REMOVED');
  });
});

describe('the audit log of a role', () => {
  it('records what a role gave before an edit and before it was deleted', async () => {
    const role = (await admin.post<{ id: string }>(o('/roles'), { name: 'Auditor', grants: { 'reports:read': 'org', 'time:read': 'org' } })).body.id;
    expect((await admin.put(o(`/roles/${role}`), { name: 'Auditor', grants: { 'time:read': 'org' } })).status).toBe(200);
    expect((await admin.del(o(`/roles/${role}`))).status).toBe(204);
    type Row = { action: string; target_id: string; before: { grants?: Record<string, string> } | null };
    const rows = (await admin.get<Row[]>(o(`/audit-logs?target_id=${role}`))).body;
    const updated = rows.find((r) => r.action === 'role.updated');
    expect(updated?.before?.grants).toEqual({ 'reports:read': 'org', 'time:read': 'org' });
    const deleted = rows.find((r) => r.action === 'role.deleted');
    expect(deleted?.before?.grants).toEqual({ 'time:read': 'org' });
  });
});

it('the worker role id from another organization is not usable here', async () => {
  const other = await signup(t, 'Olga', 'olga@role-rules.test');
  const foreignRole = (await other.client.get<Array<{ id: string; key: string }>>(`/orgs/${other.orgId}/roles`)).body.find((r) => r.key === 'WORKER')!.id;
  const r = await admin.post(o('/invitations'), { email: 'x@role-rules.test', name: 'X', role_id: foreignRole });
  expect([400, 404, 422]).toContain(r.status);
  expect(await roleId('WORKER')).not.toBe(foreignRole);
});
