import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Members and invitations (QA pass, feature 4).
 *
 * - BUG-71: an invitation could name an archived team; it was accepted, then silently dropped.
 * - BUG-72: an admin could suspend or remove themselves through the API (the page hides both).
 * - BUG-73: revoking an invitation already revoked answered 204 and wrote another audit row.
 * - BUG-74: an invitation naming a project deleted since (with its client) could not be accepted.
 * - BUG-75: accepting an old invitation after being reactivated replaced the member's current role.
 */
const PW = 'correct-horse-battery';
let t: Harness;
let admin: Client;
let orgId: string;
let roles: Array<{ id: string; key: string }>;
const o = (p: string) => `/orgs/${orgId}${p}`;
const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
const tokenOf = (url: string) => new URL(url).searchParams.get('token');
type AuditRow = { action: string; target_id: string };
const auditFor = async (id: string) => {
  const b = (await admin.get<{ data: AuditRow[] } | AuditRow[]>(o(`/audit-logs?page=1&page_size=100`))).body;
  return (Array.isArray(b) ? b : b.data).filter((r) => r.target_id === id);
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@member-rules.test'));
  roles = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
}, 60_000);
afterAll(() => t.close());

describe('an invitation to an archived team (BUG-71)', () => {
  it('is refused when it is sent', async () => {
    const team = (await admin.post<{ id: string }>(o('/teams'), { name: 'Archived crew' })).body.id;
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    const r = await admin.post(o('/invitations'), { email: 'ari@member-rules.test', role_id: roleId('WORKER'), team_ids: [team] });
    expect(r.status).toBe(400);
  });
});

describe('an admin’s own access (BUG-72)', () => {
  it('can’t be suspended or removed by themselves', async () => {
    const { client: sam, membershipId } = await addMember(t, admin, orgId, 'Sam', 'sam@member-rules.test', 'SYSTEM_ADMIN');
    expect((await sam.patch(o(`/workers/${membershipId}`), { status: 'SUSPENDED' })).status).toBe(422);
    expect((await sam.del(o(`/workers/${membershipId}`))).status).toBe(422);
    expect((await sam.get(o('/workers'))).status).toBe(200);
    // Their own title and time zone still change.
    expect((await sam.patch(o(`/workers/${membershipId}`), { title: 'Ops lead' })).status).toBe(200);
  });
});

describe('revoking an invitation (BUG-73)', () => {
  it('works once: again is 404 with no second audit row', async () => {
    const inv = await admin.post<{ id: string }>(o('/invitations'), { email: 'rex@member-rules.test', role_id: roleId('WORKER') });
    expect((await admin.del(o(`/invitations/${inv.body.id}`))).status).toBe(204);
    expect((await admin.del(o(`/invitations/${inv.body.id}`))).status).toBe(404);
    expect((await auditFor(inv.body.id)).filter((r) => r.action === 'invitation.revoked')).toHaveLength(1);
  });
});

describe('an invitation naming a project deleted since (BUG-74)', () => {
  it('can still be accepted', async () => {
    const client = (await admin.post<{ id: string }>(o('/clients'), { name: 'Short-lived client' })).body.id;
    const project = (await admin.post<{ id: string }>(o('/projects'), { name: 'Short-lived project', client_id: client })).body.id;
    const inv = await admin.post<{ invite_url: string }>(o('/invitations'), { email: 'pia@member-rules.test', name: 'Pia', role_id: roleId('WORKER'), project_ids: [project] });
    expect(inv.status).toBe(201);
    expect((await admin.del(o(`/clients/${client}`))).status).toBe(204);
    const r = await new Client(t).post('/auth/invitations/accept', { token: tokenOf(inv.body.invite_url), name: 'Pia', password: PW });
    expect(r.status).toBe(200);
  });
});

describe('an old invitation accepted after being reactivated (BUG-75)', () => {
  it('doesn’t replace the role they have now', async () => {
    const { client: kim, membershipId } = await addMember(t, admin, orgId, 'Kim', 'kim@member-rules.test');
    expect((await admin.patch(o(`/workers/${membershipId}`), { status: 'SUSPENDED' })).status).toBe(200);
    const inv = await admin.post<{ invite_url: string }>(o('/invitations'), { email: 'kim@member-rules.test', role_id: roleId('WORKER') });
    expect(inv.status).toBe(201);
    // Reactivated and promoted instead.
    expect((await admin.patch(o(`/workers/${membershipId}`), { status: 'ACTIVE', role_id: roleId('TEAM_MANAGER') })).status).toBe(200);
    const r = await kim.post('/auth/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(r.status).toBe(409);
    expect((await admin.get<{ role_key: string }>(o(`/workers/${membershipId}`))).body.role_key).toBe('TEAM_MANAGER');
  });
});
