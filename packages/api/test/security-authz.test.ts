import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { SupabaseStorage, isSafeKey } from '../src/lib/storage';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Security audit (29 October 2026), authorization. Each test failed before its fix.
// AUTHZ-001 an "assigned" grant never reaches someone else's data; AUTHZ-002 screenshot keys can't leave
// the member's folder; AUTHZ-003 invitations stay within the inviter's reach; AUTHZ-004 nobody changes a
// member with more access than them; AUTHZ-005 task grants follow project assignment; AUTHZ-006 a device
// answers only its own idle time; AUTHZ-007 keys of members who leave are revoked; AUTHZ-008 roles are
// edited by people who hold them; TEN-001 payments take this organization's clients only.
let t: Harness;
let owner: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const roleWith = async (name: string, grants: Record<string, string>) => {
  const r = await owner.post<{ id: string }>(o('/roles'), { name, grants: { 'org:read': 'org', ...grants } });
  expect(r.status).toBe(201);
  return r.body.id;
};
const memberWith = async (name: string, grants: Record<string, string>) => {
  const roleId = await roleWith(`${name} role`, grants);
  const m = await addMember(t, owner, orgId, name, `${name.toLowerCase()}@sec-authz.test`);
  expect((await owner.patch(o(`/workers/${m.membershipId}`), { role_id: roleId })).status).toBe(200);
  return { ...m, roleId };
};
async function device(c: Client) {
  const { verifier, challenge } = pkce();
  const code = await c.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  agent.bearer = (await agent.post<{ access_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
  for (const d of ((await owner.get(o('/devices'))).body as Array<{ id: string; status: string }>).filter((x) => x.status === 'PENDING')) await owner.post(o(`/devices/${d.id}/approve`), {});
  return agent;
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-20T12:00:00Z'));
  ({ client: owner, orgId } = await signup(t, 'Owen', 'owen@sec-authz.test'));
}, 60_000);
afterAll(() => t.close());

describe('AUTHZ-001: an "assigned" grant on people means your own data', () => {
  it('cannot erase or edit a System Admin’s data', async () => {
    const admin = await addMember(t, owner, orgId, 'Adm', 'adm@sec-authz.test', 'SYSTEM_ADMIN');
    const atk = await memberWith('Nar', { 'members:read': 'assigned', 'members:manage': 'assigned', 'time:read': 'assigned', 'time:edit': 'assigned' });
    const p = (await owner.post<{ id: string }>(o('/projects'), { name: 'P1', member_ids: [admin.membershipId] })).body;
    await owner.post(o('/manual-time'), { membership_id: admin.membershipId, project_id: p.id, started_at: '2026-10-13T13:00:00Z', ended_at: '2026-10-13T14:00:00Z', reason: 'x' });
    const [entry] = (await owner.get(o(`/time-entries?from=2026-10-13&to=2026-10-13&membership_ids=${admin.membershipId}`))).body as Array<{ id: string }>;
    expect((await atk.client.patch(o(`/time-entries/${entry!.id}`), { note: 'tampered' })).status).toBeGreaterThanOrEqual(403); // was 200
    expect((await atk.client.post(o(`/workers/${admin.membershipId}/anonymize`))).status).toBeGreaterThanOrEqual(403); // was 200
    expect((await owner.get(o(`/workers/${admin.membershipId}`))).body).toMatchObject({ name: 'Adm' });
  });
});

describe('AUTHZ-002: screenshot keys', () => {
  it('refuses a key that steps out of the member’s folder, and accepts the exact shape', async () => {
    const a = await addMember(t, owner, orgId, 'Ann', 'ann@sec-authz.test');
    const b = await addMember(t, owner, orgId, 'Bea', 'bea@sec-authz.test');
    const agent = await device(a.client);
    const put = (key: string) => t.app.request(`/api/v1/agent/screenshots/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { Authorization: `Bearer ${agent.bearer}`, 'Content-Type': 'image/webp' }, body: new Uint8Array([1, 2, 3]) });
    const prefix = `org/${orgId}/screenshots/${a.membershipId}/`;
    expect((await put(`${prefix}../${b.membershipId}/2026-10-29/${newId()}.webp`)).status).toBe(403); // was 204
    expect((await put(`${prefix}../../../../org/other/screenshots/x/2026-10-29/${newId()}.webp`)).status).toBe(403);
    expect((await put(`${prefix}2026-10-29/${newId()}.webp`)).status).toBe(204);
    expect((await put(`${prefix}2026-10-29/${newId()}.webp.thumb`)).status).toBe(204);
    expect([...t.storage.objects.keys()].some((k) => k.includes('..'))).toBe(false);
  });

  it('storage refuses unsafe keys on every backend, Supabase included', async () => {
    for (const k of ['org/a/../b/x.webp', 'org/a//x.webp', 'org/a/./x.webp', 'org\\a\\x.webp', '']) expect(isSafeKey(k), k).toBe(false);
    expect(isSafeKey('org/a/screenshots/m/2026-10-29/x.webp')).toBe(true);
    const calls: string[] = [];
    const supa = new SupabaseStorage('https://x.supabase.co', 'key', 'b', (async (url: string) => {
      calls.push(String(url));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    await expect(supa.put('org/a/screenshots/m/../../../../org/b/x.webp', Buffer.from('x'), 'image/webp')).rejects.toThrow('Unsafe storage key');
    expect(calls.some((u) => new URL(u).pathname.includes('/org/b/'))).toBe(false);
  });
});

describe('AUTHZ-003: invitations', () => {
  it('a team-scope member manager invites only into teams it manages, as a member', async () => {
    const m = await memberWith('Tim', { 'members:read': 'team', 'members:manage': 'team', 'time:read': 'team' });
    const mine = (await owner.post<{ id: string }>(o('/teams'), { name: 'Tim’s team' })).body.id;
    await owner.put(o(`/teams/${mine}/members/${m.membershipId}`), { role: 'MANAGER' });
    const execs = (await owner.post<{ id: string }>(o('/teams'), { name: 'Execs' })).body.id;
    const invite = (body: object) => m.client.post(o('/invitations'), { email: `alt-${newId().slice(-6)}@sec-authz.test`, role_id: m.roleId, ...body });
    expect((await invite({ team_ids: [execs], team_role: 'MEMBER' })).status).toBe(403); // was 201
    expect((await invite({ team_ids: [mine], team_role: 'MANAGER' })).status).toBe(403); // was 201
    const p = (await owner.post<{ id: string }>(o('/projects'), { name: 'Not his' })).body.id;
    expect((await invite({ project_ids: [p] })).status).toBe(403);
    expect((await invite({ team_ids: [mine], team_role: 'MEMBER' })).status).toBe(201);
  });

  it('a narrow grant sees and revokes only the invitations it sent', async () => {
    const m = await memberWith('Ivy', { 'members:read': 'team', 'members:manage': 'team' });
    const roles = (await owner.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
    const theirs = (await owner.post<{ id: string }>(o('/invitations'), { email: 'byowner@sec-authz.test', role_id: roles.find((r) => r.key === 'WORKER')!.id })).body.id;
    const listed = (await m.client.get<Array<{ id: string }>>(o('/invitations'))).body.map((i) => i.id);
    expect(listed).not.toContain(theirs);
    expect((await m.client.del(o(`/invitations/${theirs}`))).status).toBe(404);
  });

  it('only someone who outranks a suspended member may invite them back', async () => {
    const m = await memberWith('Jo', { 'members:read': 'team', 'members:manage': 'team' });
    const team = (await owner.post<{ id: string }>(o('/teams'), { name: 'Jo’s team' })).body.id;
    await owner.put(o(`/teams/${team}/members/${m.membershipId}`), { role: 'MANAGER' });
    const admin = await addMember(t, owner, orgId, 'Sus', 'sus@sec-authz.test', 'SYSTEM_ADMIN');
    expect((await owner.patch(o(`/workers/${admin.membershipId}`), { status: 'SUSPENDED' })).status).toBe(200);
    expect((await m.client.post(o('/invitations'), { email: 'sus@sec-authz.test', role_id: m.roleId, team_ids: [team] })).status).toBe(403); // was 201: reactivated on accept
  });
});

describe('AUTHZ-004: changing a member with more access', () => {
  it('a team-scope member manager can’t suspend, remove or erase a System Admin in its team', async () => {
    const m = await memberWith('Mia', { 'members:read': 'team', 'members:manage': 'team' });
    const admin = await addMember(t, owner, orgId, 'Ada2', 'ada2@sec-authz.test', 'SYSTEM_ADMIN');
    const team = (await owner.post<{ id: string }>(o('/teams'), { name: 'T4' })).body.id;
    await owner.put(o(`/teams/${team}/members/${m.membershipId}`), { role: 'MANAGER' });
    await owner.put(o(`/teams/${team}/members/${admin.membershipId}`), { role: 'MEMBER' });
    expect((await m.client.patch(o(`/workers/${admin.membershipId}`), { status: 'SUSPENDED' })).status).toBe(403); // was 200
    expect((await m.client.del(o(`/workers/${admin.membershipId}`))).status).toBe(403);
    expect((await m.client.post(o(`/workers/${admin.membershipId}/anonymize`))).status).toBe(403);
    // A worker in the same team is still theirs to manage.
    const w = await addMember(t, owner, orgId, 'Wil', 'wil@sec-authz.test');
    await owner.put(o(`/teams/${team}/members/${w.membershipId}`), { role: 'MEMBER' });
    expect((await m.client.patch(o(`/workers/${w.membershipId}`), { status: 'SUSPENDED' })).status).toBe(200);
  });
});

describe('AUTHZ-005: task grants follow project assignment', () => {
  it('a team-scope task grant can’t delete a task on a project the member isn’t on', async () => {
    const m = await memberWith('Tas', { 'tasks:read': 'assigned', 'tasks:manage': 'team', 'projects:read': 'assigned' });
    const p = (await owner.post<{ id: string }>(o('/projects'), { name: 'Secret' })).body.id;
    const task = (await owner.post<{ id: string }>(o(`/projects/${p}/tasks`), { title: 'Real' })).body.id;
    expect((await m.client.del(o(`/tasks/${task}`))).status).toBeGreaterThanOrEqual(403); // was 204
    await owner.patch(o(`/projects/${p}`), { member_ids: [m.membershipId] });
    expect((await m.client.del(o(`/tasks/${task}`))).status).toBe(204);
  });
});

describe('AUTHZ-006: idle time is answered by its own device', () => {
  it('device A can’t resolve B’s idle period', async () => {
    const p = (await owner.post<{ id: string }>(o('/projects'), { name: 'Idle P' })).body.id;
    const a = await addMember(t, owner, orgId, 'Ida', 'ida@sec-authz.test');
    const b = await addMember(t, owner, orgId, 'Ibb', 'ibb@sec-authz.test');
    await owner.patch(o(`/projects/${p}`), { member_ids: [a.membershipId, b.membershipId] });
    for (const m of [a, b]) await owner.put(o(`/policies/WORKER/${m.membershipId}`), { idle: { behavior: 'prompt' } });
    const da = await device(a.client);
    const db = await device(b.client);
    const base = '2026-10-20T09:00:00Z';
    const at = (min: number) => new Date(Date.parse(base) + min * 60_000).toISOString();
    t.clock.set(new Date('2026-10-20T10:30:00Z'));
    const [sa, sb, idleB] = [newId(), newId(), newId()];
    await da.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.start', session_id: sa, seq: 1, occurred_at: base, project_id: p }] });
    await db.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.start', session_id: sb, seq: 1, occurred_at: base, project_id: p }, { event_id: newId(), type: 'idle.started', session_id: sb, occurred_at: at(20), idle_id: idleB, started_at: at(20) }] });
    const r = await da.post<{ results: Array<{ status: string }> }>('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'idle.resolved', session_id: sa, occurred_at: at(40), idle_id: idleB, started_at: at(20), ended_at: at(40), resolution: 'KEPT' }] });
    expect(r.body.results[0]!.status).toBe('rejected'); // was accepted
    const pending = (await owner.get<unknown[]>(o(`/idle-events?from=2026-10-20&to=2026-10-20&membership_ids=${b.membershipId}&status=PENDING`))).body;
    expect(pending).toHaveLength(1);
  });
});

describe('AUTHZ-007: API keys of a member who leaves', () => {
  it('are revoked, and stay revoked if they come back', async () => {
    const adm = await addMember(t, owner, orgId, 'Kay', 'kay@sec-authz.test', 'SYSTEM_ADMIN');
    const key = (await adm.client.post<{ key: string }>(o('/api-keys'), { name: 'k', scopes: ['read:projects'] })).body.key;
    const call = async () => (await t.app.request(`/api/v1/orgs/${orgId}/projects`, { headers: { Authorization: `Bearer ${key}` } })).status;
    expect(await call()).toBe(200);
    await owner.del(o(`/workers/${adm.membershipId}`));
    const roles = (await owner.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
    const inv = await owner.post<{ invite_url: string }>(o('/invitations'), { email: 'kay@sec-authz.test', role_id: roles.find((r) => r.key === 'SYSTEM_ADMIN')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    expect((await adm.client.post('/auth/invitations/accept', { token })).status).toBe(200);
    expect(await call()).toBe(401); // was 200 again
  });
});

describe('AUTHZ-008: editing roles', () => {
  it('an editor without payroll access can’t change or delete the payroll role', async () => {
    const payroll = await roleWith('Payroll admins', { 'payroll:read': 'org', 'payroll:manage': 'org', 'members:read': 'org' });
    const editor = await memberWith('Rol', { 'roles:manage': 'org', 'members:read': 'org' });
    expect((await editor.client.put(o(`/roles/${payroll}`), { name: 'Payroll admins', grants: { 'org:read': 'org' } })).status).toBe(403); // was 200
    expect((await editor.client.del(o(`/roles/${payroll}`))).status).toBe(403);
  });
});

describe('TEN-001: payment clients', () => {
  it('refuses another organization’s client', async () => {
    const { client: other, orgId: otherOrg } = await signup(t, 'Bob', 'bob@sec-authz-other.test');
    const foreign = (await other.post<{ id: string }>(`/orgs/${otherOrg}/clients`, { name: 'Foreign Co' })).body.id;
    expect((await owner.post(o('/payments'), { client_id: foreign, amount_minor: 100, currency: 'USD', received_on: '2026-10-01' })).status).toBe(404); // was 201
  });
});
