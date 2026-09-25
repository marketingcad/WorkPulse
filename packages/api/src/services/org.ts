import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  invitations,
  memberships,
  organizations,
  rolePermissions,
  roles,
  teamMembers,
  users,
  workerProfiles,
} from '@tallywork/db';
import { businessRule, can, conflict, forbidden, newId, notFound, type Grants } from '@tallywork/domain';
import type { OrgContextDto, WorkerDto, inviteInput, roleInput, updateOrgInput, updateWorkerInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { membershipFilter } from './scope';
import { randomToken, sha256 } from '../lib/crypto';
import { iso } from '../lib/http';

export async function orgContext(x: Ctx): Promise<OrgContextDto> {
  const [o] = await x.tx.select().from(organizations).where(eq(organizations.id, x.org.id));
  const [p] = await x.tx.select().from(workerProfiles).where(eq(workerProfiles.membershipId, x.actor.membershipId));
  const [r] = await x.tx.select({ name: roles.name }).from(roles).innerJoin(memberships, eq(memberships.roleId, roles.id)).where(eq(memberships.id, x.actor.membershipId));
  return {
    organization: {
      id: o!.id,
      slug: o!.slug,
      name: o!.name,
      timezone: o!.timezone,
      week_start: o!.weekStart,
      currency: o!.currency,
      pay_period: o!.payPeriod,
      settings: o!.settings as unknown as Record<string, unknown>,
      is_demo: o!.isDemo,
    },
    membership: {
      id: x.actor.membershipId,
      role_key: x.actor.roleKey,
      role_name: r?.name ?? x.actor.roleKey,
      is_owner: x.actor.isOwner,
      timezone: p?.timezone ?? o!.timezone,
      tracking_enabled: p?.trackingEnabled ?? false,
    },
    grants: x.actor.grants,
    managed_team_ids: x.actor.managedTeamIds,
  };
}

export async function updateOrg(x: Ctx, input: z.infer<typeof updateOrgInput>) {
  if (!x.actor.grants['org:update']) throw forbidden();
  const [before] = await x.tx.select().from(organizations).where(eq(organizations.id, x.org.id));
  const patch: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.week_start !== undefined) patch.weekStart = input.week_start;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.pay_period !== undefined) patch.payPeriod = input.pay_period;
  if (input.settings !== undefined) patch.settings = { ...before!.settings, ...input.settings };
  await x.tx.update(organizations).set(patch).where(eq(organizations.id, x.org.id));
  await audit(x, { action: 'organization.updated', targetType: 'organization', targetId: x.org.id, before, after: patch });
  return orgContext(x);
}

// ─── Roles ───────────────────────────────────────────────────────────────────
export async function listRoles(x: Ctx) {
  const rs = await x.tx.select().from(roles).where(eq(roles.organizationId, x.org.id)).orderBy(asc(roles.createdAt));
  const perms = await x.tx.select().from(rolePermissions).where(eq(rolePermissions.organizationId, x.org.id));
  return rs
    .filter((r) => r.key !== 'AGENT')
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      builtin: r.builtin,
      grants: Object.fromEntries(perms.filter((p) => p.roleId === r.id).map((p) => [p.permission, p.scope])) as Grants,
    }));
}

export async function upsertRole(x: Ctx, roleId: string | null, input: z.infer<typeof roleInput>) {
  if (!x.actor.grants['roles:manage']) throw forbidden();
  // A custom role can never grant more than the editor holds.
  for (const [perm, scope] of Object.entries(input.grants)) {
    const mine = x.actor.grants[perm as keyof Grants];
    if (!mine || (mine !== 'org' && mine !== scope)) throw forbidden(`You cannot grant ${perm} at ${scope} scope`);
    if (perm === 'agent:ingest') throw forbidden('agent:ingest is reserved for devices');
  }
  let id = roleId;
  if (id) {
    const [r] = await x.tx.select().from(roles).where(eq(roles.id, id));
    if (!r) throw notFound('role');
    if (r.builtin) throw businessRule('builtin_role', 'Built-in roles cannot be edited; create a custom role instead');
    await x.tx.update(roles).set({ name: input.name, description: input.description ?? null, updatedAt: new Date() }).where(eq(roles.id, id));
    await x.tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
  } else {
    id = newId();
    await x.tx.insert(roles).values({ id, organizationId: x.org.id, key: `custom_${randomToken(4).toLowerCase()}`, name: input.name, description: input.description ?? null });
  }
  const rows = Object.entries(input.grants).map(([permission, scope]) => ({ organizationId: x.org.id, roleId: id!, permission, scope }));
  if (rows.length) await x.tx.insert(rolePermissions).values(rows);
  await audit(x, { action: roleId ? 'role.updated' : 'role.created', targetType: 'role', targetId: id, after: input });
  return (await listRoles(x)).find((r) => r.id === id)!;
}

export async function deleteRole(x: Ctx, roleId: string) {
  if (!x.actor.grants['roles:manage']) throw forbidden();
  const [r] = await x.tx.select().from(roles).where(eq(roles.id, roleId));
  if (!r) throw notFound('role');
  if (r.builtin) throw businessRule('builtin_role', 'Built-in roles cannot be deleted');
  const [used] = await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.roleId, roleId)).limit(1);
  if (used) throw conflict('role_in_use', 'Reassign members before deleting this role');
  await x.tx.delete(roles).where(eq(roles.id, roleId));
  await audit(x, { action: 'role.deleted', targetType: 'role', targetId: roleId, before: r });
}

// ─── Workers ─────────────────────────────────────────────────────────────────
export async function listWorkers(x: Ctx, opts: { includeRemoved?: boolean } = {}): Promise<WorkerDto[]> {
  const filter = membershipFilter(x.actor, 'members:read', memberships.id);
  const rows = await x.tx
    .select({
      m: memberships,
      u: { id: users.id, name: users.name, email: users.email },
      p: workerProfiles,
      r: { key: roles.key, name: roles.name },
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(and(eq(memberships.organizationId, x.org.id), opts.includeRemoved ? undefined : ne(memberships.status, 'REMOVED'), filter))
    .orderBy(asc(users.name));
  const ids = rows.map((r) => r.m.id);
  const tm = ids.length ? await x.tx.select().from(teamMembers).where(inArray(teamMembers.membershipId, ids)) : [];
  return rows.map(({ m, u, p, r }) => ({
    id: m.id,
    user_id: u.id,
    name: u.name,
    email: u.email,
    role_id: m.roleId,
    role_key: r.key,
    role_name: r.name,
    status: m.status,
    is_owner: m.isOwner,
    title: p?.title ?? null,
    timezone: p?.timezone ?? x.org.timezone,
    tracking_enabled: p?.trackingEnabled ?? false,
    employment_type: p?.employmentType ?? 'EMPLOYEE',
    weekly_expected_seconds: p?.weeklyExpectedSeconds ?? null,
    start_date: p?.startDate ?? null,
    team_ids: tm.filter((t) => t.membershipId === m.id).map((t) => t.teamId),
    created_at: m.createdAt.toISOString(),
  }));
}

export async function getWorker(x: Ctx, membershipId: string): Promise<WorkerDto> {
  const all = await listWorkers(x, { includeRemoved: true });
  const w = all.find((r) => r.id === membershipId);
  if (!w) throw notFound('worker');
  return w;
}

export async function updateWorker(x: Ctx, membershipId: string, input: z.infer<typeof updateWorkerInput>) {
  const before = await getWorker(x, membershipId);
  const isSelf = membershipId === x.actor.membershipId;
  const admin = !!x.actor.grants['members:manage'];
  // Workers may only change their own timezone/title.
  if (!admin) {
    const allowedSelf = isSelf && input.role_id === undefined && input.status === undefined && input.tracking_enabled === undefined && input.employment_type === undefined && input.weekly_expected_seconds === undefined && input.start_date === undefined;
    if (!allowedSelf) throw forbidden();
  }
  if (input.role_id !== undefined || input.status !== undefined) {
    if (before.is_owner) throw businessRule('owner_protected', 'The organization owner’s role and status cannot be changed');
    if (input.role_id) {
      const [r] = await x.tx.select().from(roles).where(eq(roles.id, input.role_id));
      if (!r || r.key === 'AGENT') throw notFound('role');
    }
    await x.tx
      .update(memberships)
      .set({ ...(input.role_id ? { roleId: input.role_id } : {}), ...(input.status ? { status: input.status } : {}), updatedAt: new Date() })
      .where(eq(memberships.id, membershipId));
  }
  const profilePatch: Partial<typeof workerProfiles.$inferInsert> = {};
  if (input.title !== undefined) profilePatch.title = input.title;
  if (input.timezone !== undefined) profilePatch.timezone = input.timezone;
  if (input.tracking_enabled !== undefined) profilePatch.trackingEnabled = input.tracking_enabled;
  if (input.employment_type !== undefined) profilePatch.employmentType = input.employment_type;
  if (input.weekly_expected_seconds !== undefined) profilePatch.weeklyExpectedSeconds = input.weekly_expected_seconds;
  if (input.start_date !== undefined) profilePatch.startDate = input.start_date;
  if (Object.keys(profilePatch).length) {
    await x.tx
      .insert(workerProfiles)
      .values({ membershipId, organizationId: x.org.id, timezone: before.timezone, ...profilePatch })
      .onConflictDoUpdate({ target: workerProfiles.membershipId, set: { ...profilePatch, updatedAt: new Date() } });
  }
  const after = await getWorker(x, membershipId);
  await audit(x, { action: 'worker.updated', targetType: 'membership', targetId: membershipId, before, after });
  return after;
}

export async function removeWorker(x: Ctx, membershipId: string) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  const w = await getWorker(x, membershipId);
  if (w.is_owner) throw businessRule('owner_protected', 'Transfer ownership before removing the owner');
  await x.tx.update(memberships).set({ status: 'REMOVED', updatedAt: new Date() }).where(eq(memberships.id, membershipId));
  await x.tx.delete(teamMembers).where(eq(teamMembers.membershipId, membershipId));
  await audit(x, { action: 'worker.removed', targetType: 'membership', targetId: membershipId, before: w });
}

export async function inviteWorker(x: Ctx, input: z.infer<typeof inviteInput>) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  const [role] = await x.tx.select().from(roles).where(eq(roles.id, input.role_id));
  if (!role || role.key === 'AGENT') throw notFound('role');
  const existing = await x.tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, x.org.id), eq(users.email, input.email.toLowerCase())));
  if (existing.some((e) => e.status === 'ACTIVE')) throw conflict('already_member', 'This person is already a member');
  const token = randomToken(32);
  const id = newId();
  await x.tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.organizationId, x.org.id), eq(invitations.email, input.email.toLowerCase()), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  await x.tx.insert(invitations).values({
    id,
    organizationId: x.org.id,
    email: input.email.toLowerCase(),
    name: input.name ?? null,
    roleId: input.role_id,
    teamIds: input.team_ids,
    tokenHash: sha256(token),
    invitedBy: x.actor.membershipId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const url = `${x.deps.config.appUrl}/invite?token=${token}`;
  await x.deps.mailer.send({ to: input.email, subject: `You're invited to ${x.org.name} on Tallywork`, text: `${x.org.name} invited you to join their workspace on Tallywork.\n\nAccept the invitation: ${url}\n\nThis link expires in 7 days.` });
  await audit(x, { action: 'invitation.created', targetType: 'invitation', targetId: id, after: { email: input.email, role: role.key } });
  return { id, email: input.email.toLowerCase(), invite_url: url, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() };
}

export async function listInvitations(x: Ctx) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  const rows = await x.tx
    .select({ i: invitations, roleName: roles.name })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(and(eq(invitations.organizationId, x.org.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(asc(invitations.createdAt));
  return rows.map(({ i, roleName }) => ({ id: i.id, email: i.email, name: i.name, role_id: i.roleId, role_name: roleName, expires_at: iso(i.expiresAt), created_at: iso(i.createdAt), expired: i.expiresAt < new Date() }));
}

export async function revokeInvitation(x: Ctx, id: string) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  const r = await x.tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt))).returning({ id: invitations.id });
  if (!r.length) throw notFound('invitation');
  await audit(x, { action: 'invitation.revoked', targetType: 'invitation', targetId: id });
}

export function assertCanSeeWorker(x: Ctx, membershipId: string, permission: Parameters<typeof can>[1]) {
  if (!can(x.actor, permission, { ownerMembershipId: membershipId })) throw notFound('worker');
}
