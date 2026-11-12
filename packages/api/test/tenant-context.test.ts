import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { memberships, organizations, projectMembers, projectTeams, rolePermissions, roles, teamMembers, withTenant, type Tx } from '@tallywork/db';
import { API_KEY_SCOPES, ORG_ONLY_PERMISSIONS, intersectGrants, type Grants, type Permission, type Scope } from '@tallywork/domain';
import type { Actor, Principal } from '../src/context';
import { loadActor, loadOrg, loadTenant } from '../src/middleware/tenant';
import { withQueryStats } from '@tallywork/db';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * QA audit 11 Nov 2026, Phase 3 (BUG-02): every request loaded the signed-in member with six or seven
 * separate queries (membership, organization, membership + role, permissions, teams, managed members,
 * projects), and each query costs a full round trip to the database (~154 ms in production). loadTenant
 * loads it all in one query. What a person may see and do is decided from this, so it must give exactly
 * what the old code gave: `reference` below is the old code, kept as the oracle.
 */
async function reference(tx: Tx, principal: Principal, organizationId: string, membershipId: string) {
  const [o] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const org = { id: o!.id, name: o!.name, slug: o!.slug, timezone: o!.timezone, weekStart: o!.weekStart, currency: o!.currency, payPeriod: o!.payPeriod, settings: o!.settings };
  const [m] = await tx
    .select({ id: memberships.id, userId: memberships.userId, roleId: memberships.roleId, status: memberships.status, isOwner: memberships.isOwner, roleKey: roles.key })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!m || m.status !== 'ACTIVE') return { org, actor: 'forbidden' as const };
  const rows = await tx.select({ permission: rolePermissions.permission, scope: rolePermissions.scope }).from(rolePermissions).where(eq(rolePermissions.roleId, m.roleId));
  let grants = Object.fromEntries(rows.map((r) => [r.permission, r.scope])) as Grants;
  for (const p of ORG_ONLY_PERMISSIONS) if (grants[p] && grants[p] !== 'org') delete grants[p];
  if (principal.type === 'api_key') {
    const keyGrants: Grants = {};
    for (const s of principal.scopes) {
      const perm = API_KEY_SCOPES[s as keyof typeof API_KEY_SCOPES] as Permission | undefined;
      if (perm) keyGrants[perm] = 'org' as Scope;
    }
    grants = intersectGrants(grants, keyGrants);
  }
  const myTeams = await tx.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.membershipId, m.id));
  const managedTeamIds = myTeams.filter((t) => t.role === 'MANAGER').map((t) => t.teamId);
  const managed = managedTeamIds.length ? await tx.select({ id: teamMembers.membershipId }).from(teamMembers).where(inArray(teamMembers.teamId, managedTeamIds)) : [];
  const allTeamIds = myTeams.map((t) => t.teamId);
  const direct = await tx.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.membershipId, m.id));
  const viaTeams = allTeamIds.length ? await tx.select({ id: projectTeams.projectId }).from(projectTeams).where(inArray(projectTeams.teamId, allTeamIds)) : [];
  const actor: Actor = {
    organizationId,
    membershipId: m.id,
    userId: m.userId,
    principal,
    roleKey: m.roleKey,
    isOwner: m.isOwner,
    grants,
    managedTeamIds,
    managedMembershipIds: new Set(managed.map((r) => r.id).filter((id) => id !== m.id)),
    assignedProjectIds: new Set([...direct, ...viaTeams].map((r) => r.id)),
  };
  return { org, actor };
}

/** Sets and arrays compared as sorted lists: the database returns rows in no particular order. */
const comparable = (a: Actor | 'forbidden') =>
  a === 'forbidden' ? a : { ...a, managedTeamIds: [...a.managedTeamIds].sort(), managedMembershipIds: [...a.managedMembershipIds].sort(), assignedProjectIds: [...a.assignedProjectIds].sort() };

let t: Harness;
let admin: Client;
let orgId: string;
const people: Record<string, string> = {};
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@tenant-ctx.test'));
  for (const [key, role] of [['worker', 'WORKER'], ['worker2', 'WORKER'], ['manager', 'TEAM_MANAGER'], ['admin2', 'SYSTEM_ADMIN'], ['suspended', 'WORKER']] as const) {
    people[key] = (await addMember(t, admin, orgId, key, `${key}@tenant-ctx.test`, role)).membershipId;
  }
  const team = (await admin.post(o('/teams'), { name: 'Design' })).body;
  expect((await admin.put(o(`/teams/${team.id}/members/${people.worker}`), { role: 'MEMBER' })).status).toBeLessThan(300);
  expect((await admin.put(o(`/teams/${team.id}/members/${people.manager}`), { role: 'MANAGER' })).status).toBeLessThan(300);
  const other = (await admin.post(o('/teams'), { name: 'Ops' })).body;
  expect((await admin.put(o(`/teams/${other.id}/members/${people.worker2}`), { role: 'MEMBER' })).status).toBeLessThan(300);
  await admin.post(o('/projects'), { name: 'Direct', member_ids: [people.worker] });
  await admin.post(o('/projects'), { name: 'Via team', team_ids: [team.id] });
  await admin.post(o('/projects'), { name: 'Other team', team_ids: [other.id] });
  await admin.patch(o(`/workers/${people.suspended}`), { status: 'SUSPENDED' });
  // A custom role holding an org-only permission at a narrower scope (saved before that rule): it grants nothing.
  const narrow = (await admin.post(o('/roles'), { name: 'Narrow', grants: { 'time:read': 'team', 'payroll:read': 'org' } })).body;
  await t.h.db.execute(sql`reset role`);
  await t.h.db.execute(sql`update role_permissions set scope = 'team' where role_id = ${narrow.id} and permission = 'payroll:read'`);
  await t.h.db.execute(sql`set role tallywork_app`);
  people.custom = (await addMember(t, admin, orgId, 'custom', 'custom@tenant-ctx.test', 'WORKER')).membershipId;
  await admin.patch(o(`/workers/${people.custom}`), { role_id: narrow.id });
  const [owner] = await withTenant(t.h.db, orgId, (tx) => tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.isOwner, true))));
  people.owner = owner!.id;
}, 60_000);
afterAll(() => t.close());

describe('loadTenant gives exactly what the old seven queries gave', () => {
  const user = (userId: string): Principal => ({ type: 'user', userId, sessionId: 's', mfaVerified: true });

  it.each(['owner', 'worker', 'worker2', 'manager', 'admin2', 'custom'])('for %s, by user and by membership', async (key) => {
    await withTenant(t.h.db, orgId, async (tx) => {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, people[key]!));
      const principal = user(m!.userId);
      const ref = await reference(tx, principal, orgId, people[key]!);
      const byUser = await loadTenant(tx, principal, orgId, { userId: m!.userId });
      expect(byUser.org).toEqual(ref.org);
      expect(comparable(byUser.actor)).toEqual(comparable(ref.actor));
      expect(comparable(await loadActor(tx, principal, orgId, people[key]!))).toEqual(comparable(ref.actor));
      expect(await loadOrg(tx, orgId)).toEqual(ref.org);
    });
  });

  it('a suspended member is refused, as before', async () => {
    await withTenant(t.h.db, orgId, async (tx) => {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, people.suspended!));
      expect((await reference(tx, user(m!.userId), orgId, people.suspended!)).actor).toBe('forbidden');
      await expect(loadTenant(tx, user(m!.userId), orgId, { userId: m!.userId })).rejects.toMatchObject({ category: 'forbidden' });
    });
  });

  it('an API key gets its creator’s grants, cut down to its scopes, as before', async () => {
    await withTenant(t.h.db, orgId, async (tx) => {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, people.admin2!));
      const key: Principal = { type: 'api_key', keyId: 'k', organizationId: orgId, createdBy: m!.userId, scopes: ['read:projects', 'read:time'] };
      const ref = await reference(tx, key, orgId, people.admin2!);
      const got = await loadTenant(tx, key, orgId, { userId: m!.userId });
      expect(comparable(got.actor)).toEqual(comparable(ref.actor));
      expect(Object.keys(got.actor.grants).sort()).toEqual(Object.keys((ref.actor as Actor).grants).sort());
    });
  });

  it('someone who is not a member gets no membership, and an unknown organization is not found', async () => {
    const stranger = await signup(t, 'Zed', 'zed@tenant-ctx.test');
    await withTenant(t.h.db, orgId, async (tx) => {
      const [u] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, people.worker!));
      await expect(loadTenant(tx, user('00000000-0000-7000-8000-000000000001'), orgId, { userId: '00000000-0000-7000-8000-000000000001' })).rejects.toMatchObject({ code: 'no_membership' });
      expect(u).toBeTruthy();
    });
    await withTenant(t.h.db, stranger.orgId, async (tx) => {
      await expect(loadTenant(tx, user('x'), orgId, { userId: '00000000-0000-7000-8000-000000000001' })).rejects.toMatchObject({ category: 'not_found' });
    });
  });

  it('is one query instead of seven', async () => {
    await withTenant(t.h.db, orgId, async (tx) => {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, people.manager!));
      // Counted on the transaction's own client, as a request's queries are.
      const stats = await withQueryStats(async (st) => {
        await loadTenant(tx, user(m!.userId), orgId, { userId: m!.userId });
        return st;
      });
      expect(stats.queries).toBe(1);
    });
  });
});

describe('through the API', () => {
  it('a request still sees what its role allows, and a non-member still gets 404', async () => {
    const worker = (await addMember(t, admin, orgId, 'Walt', 'walt@tenant-ctx.test')).client;
    expect((await worker.get(o('/time-types'))).status).toBe(200);
    expect((await worker.get(o('/payroll/runs'))).status).toBe(403);
    const stranger = await signup(t, 'Yan', 'yan@tenant-ctx.test');
    expect((await stranger.client.get(o('/time-types'))).status).toBe(404);
  });
});
