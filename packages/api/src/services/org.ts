import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  invitations,
  memberDetails,
  memberships,
  organizations,
  projects,
  rolePermissions,
  roles,
  teamMembers,
  teams,
  users,
  workerProfiles,
} from '@tallywork/db';
import { businessRule, can, conflict, forbidden, localDate, newId, notFound, validation, type Grants } from '@tallywork/domain';
import type { MemberDetailsDto, MemberOptionDto, OffsetPage, OrgContextDto, WorkerDto, inviteInput, memberDetailsInput, roleInput, updateOrgInput, updateWorkerInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { ipAllowed, parseCidr } from '../lib/cidr';
import { audit } from './events';
import { applyScopedRates, currentScopedRates, rateChanges } from './finance';
import { membershipFilter, narrowMemberships } from './scope';
import { randomToken, sha256 } from '../lib/crypto';
import { iso } from '../lib/http';
import { isUuid, likePattern } from '../lib/search';
import { renderEmail } from '../lib/email';

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
      logo: o!.logo,
      brief: o!.brief,
      tax_id: o!.taxId,
      address: o!.address,
      phone: o!.phone,
      email: o!.email,
      document_language: o!.documentLanguage,
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
  if (input.logo !== undefined) patch.logo = input.logo;
  if (input.brief !== undefined) patch.brief = input.brief;
  if (input.tax_id !== undefined) patch.taxId = input.tax_id;
  if (input.address !== undefined) patch.address = input.address;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.document_language !== undefined) patch.documentLanguage = input.document_language;
  if (input.settings !== undefined) {
    const security = (['enforceMfa', 'sessionTtlHours', 'requireDeviceApproval', 'ipAllowlist'] as const).filter((k) => k in input.settings!);
    if (security.length && !x.actor.grants['settings:security']) throw forbidden('Changing security settings needs the security settings permission');
    const list = input.settings.ipAllowlist;
    if (list) {
      const bad = list.filter((c) => !parseCidr(c));
      if (bad.length) throw validation(`Not a valid IP address or range: ${bad.join(', ')}`, { errors: [{ field: 'settings.ipAllowlist', message: 'Invalid range' }] });
      // Never let an admin lock themselves out: the address they are saving from must stay allowed.
      if (list.length && !ipAllowed(x.ip, list)) throw businessRule('ip_allowlist_lockout', `Your current address (${x.ip ?? 'unknown'}) is not in the list. Add it first so you do not lock yourself out.`);
    }
    if (input.settings.enforceMfa && input.settings.enforceMfa !== 'none' && x.actor.principal.type === 'user' && !x.actor.principal.mfaVerified) {
      throw businessRule('mfa_required_first', 'Turn on two-factor authentication for your own account before requiring it for others');
    }
    patch.settings = { ...before!.settings, ...input.settings };
  }
  await x.tx.update(organizations).set(patch).where(eq(organizations.id, x.org.id));
  const shrink = <T extends { logo?: string | null }>(o: T) => ({ ...o, logo: o.logo ? '(image)' : o.logo });
  await audit(x, { action: 'organization.updated', targetType: 'organization', targetId: x.org.id, before: shrink(before!), after: shrink(patch) });
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

/** Whether the actor holds `perm` at least as widely as `scope`: never hand out more than you hold. */
function holdsGrant(x: Ctx, perm: string, scope: string): boolean {
  const mine = x.actor.grants[perm as keyof Grants];
  return !!mine && (mine === 'org' || mine === scope);
}

/**
 * Giving someone a role (inviting or changing their role) is bounded like creating one: every
 * permission in it must be one the actor holds at that scope or wider.
 */
async function assertCanAssignRole(x: Ctx, roleId: string) {
  const [role] = await x.tx.select().from(roles).where(eq(roles.id, roleId));
  if (!role || role.key === 'AGENT') throw notFound('role');
  const grants = await x.tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  for (const g of grants) if (!holdsGrant(x, g.permission, g.scope)) throw forbidden('You cannot give a role with more access than you have');
  return role;
}

export async function upsertRole(x: Ctx, roleId: string | null, input: z.infer<typeof roleInput>) {
  if (!x.actor.grants['roles:manage']) throw forbidden();
  // A custom role can never grant more than the editor holds.
  for (const [perm, scope] of Object.entries(input.grants)) {
    if (!holdsGrant(x, perm, scope)) throw forbidden(`You cannot grant ${perm} at ${scope} scope`);
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
type WorkerQuery = {
  includeRemoved?: boolean;
  /** 'former' lists only removed members; 'current' everyone else (the default). Overrides includeRemoved. */
  view?: 'current' | 'former';
  status?: string;
  roleId?: string;
  search?: string;
  id?: string;
};

/** Members the person may see that match the filters; `search` covers the name, email and title. */
function workerWhere(x: Ctx, q: WorkerQuery) {
  const term = q.search ? likePattern(q.search) : null;
  return and(
    eq(memberships.organizationId, x.org.id),
    q.view === 'former' ? eq(memberships.status, 'REMOVED') : q.view === 'current' || !q.includeRemoved ? ne(memberships.status, 'REMOVED') : undefined,
    q.status ? eq(memberships.status, q.status as 'ACTIVE') : undefined,
    q.roleId ? eq(memberships.roleId, q.roleId) : undefined,
    q.id ? eq(memberships.id, q.id) : undefined,
    term ? or(ilike(users.name, term), ilike(users.email, term), ilike(workerProfiles.title, term)) : undefined,
    membershipFilter(x.actor, 'members:read', memberships.id),
  );
}

const workerFields = {
  m: memberships,
  u: { id: users.id, name: users.name, email: users.email },
  p: workerProfiles,
  r: { key: roles.key, name: roles.name },
};

/** Members as a plain array, by name (every match: use `pageWorkers` for a page at a time). */
export async function listWorkers(x: Ctx, opts: WorkerQuery = {}): Promise<WorkerDto[]> {
  const rows = await x.tx
    .select(workerFields)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(workerWhere(x, opts))
    .orderBy(asc(users.name), asc(memberships.id));
  return toWorkerDtos(x, rows);
}

/** Members for pickers and name lookups, by name: only the fields those need (no rates or team lists). */
export async function listMemberOptions(x: Ctx, opts: { includeRemoved?: boolean } = {}): Promise<MemberOptionDto[]> {
  const rows = await x.tx
    .select({
      id: memberships.id,
      name: users.name,
      email: users.email,
      roleName: roles.name,
      status: memberships.status,
      title: workerProfiles.title,
      timezone: workerProfiles.timezone,
      tracking: workerProfiles.trackingEnabled,
      weekly: workerProfiles.weeklyExpectedSeconds,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(workerWhere(x, { includeRemoved: opts.includeRemoved }))
    .orderBy(asc(users.name), asc(memberships.id));
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role_name: r.roleName, status: r.status, title: r.title ?? null, timezone: r.timezone ?? x.org.timezone, tracking_enabled: r.tracking ?? false, weekly_expected_seconds: r.weekly ?? null }));
}

/** One numbered page of members (`page` is 1-based), by name, and the total. */
export async function pageWorkers(x: Ctx, q: WorkerQuery & { page: number; pageSize: number }): Promise<OffsetPage<WorkerDto>> {
  const where = workerWhere(x, q);
  const [count] = await x.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(where);
  const rows = await x.tx
    .select(workerFields)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(where)
    .orderBy(asc(users.name), asc(memberships.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: await toWorkerDtos(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toWorkerDtos(
  x: Ctx,
  rows: Array<{ m: typeof memberships.$inferSelect; u: { id: string; name: string; email: string }; p: typeof workerProfiles.$inferSelect | null; r: { key: string; name: string } }>,
): Promise<WorkerDto[]> {
  const ids = rows.map((r) => r.m.id);
  const tm = ids.length ? await x.tx.select().from(teamMembers).where(inArray(teamMembers.membershipId, ids)) : [];
  const rates = x.actor.grants['rates:read'] ? await currentScopedRates(x, 'WORKER') : null;
  const rateVisible = rates ? narrowMemberships(x.actor, 'rates:read') : [];
  const ratesOf = (id: string) =>
    rates && (rateVisible === 'all' || rateVisible.includes(id)) ? { pay_rate_minor: rates.get(`PAY:${id}`)?.amountMinor ?? null, bill_rate_minor: rates.get(`BILL:${id}`)?.amountMinor ?? null } : {};
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
    end_date: p?.endDate ?? null,
    ...ratesOf(m.id),
    team_ids: tm.filter((t) => t.membershipId === m.id).map((t) => t.teamId),
    created_at: m.createdAt.toISOString(),
  }));
}

export async function getWorker(x: Ctx, membershipId: string): Promise<WorkerDto> {
  // Looked up by id, not by loading every member.
  if (!isUuid(membershipId)) throw notFound('worker');
  const [w] = await listWorkers(x, { includeRemoved: true, id: membershipId });
  if (!w) throw notFound('worker');
  return w;
}

export async function updateWorker(x: Ctx, membershipId: string, input: z.infer<typeof updateWorkerInput>) {
  const before = await getWorker(x, membershipId);
  const isSelf = membershipId === x.actor.membershipId;
  // members:manage only reaches the members inside its scope.
  const admin = can(x.actor, 'members:manage', { ownerMembershipId: membershipId });
  // Workers may only change their own timezone/title.
  if (!admin) {
    const allowedSelf =
      isSelf &&
      input.role_id === undefined &&
      input.status === undefined &&
      input.tracking_enabled === undefined &&
      input.employment_type === undefined &&
      input.weekly_expected_seconds === undefined &&
      input.start_date === undefined &&
      input.end_date === undefined;
    if (!allowedSelf) throw forbidden();
  }
  const changes = rateChanges(input);
  if (changes.length && !x.actor.grants['rates:manage']) throw forbidden();
  if (input.start_date && input.end_date && input.end_date < input.start_date) throw validation('The end date is before the start date', { errors: [{ field: 'end_date', message: 'Must be on or after the start date' }] });
  if (input.role_id !== undefined || input.status !== undefined) {
    if (before.is_owner) throw businessRule('owner_protected', 'The organization owner’s role and status cannot be changed');
    if (input.role_id && input.role_id !== before.role_id) {
      if (isSelf) throw forbidden('You cannot change your own role');
      await assertCanAssignRole(x, input.role_id);
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
  if (input.end_date !== undefined) profilePatch.endDate = input.end_date;
  if (Object.keys(profilePatch).length) {
    await x.tx
      .insert(workerProfiles)
      .values({ membershipId, organizationId: x.org.id, timezone: before.timezone, ...profilePatch })
      .onConflictDoUpdate({ target: workerProfiles.membershipId, set: { ...profilePatch, updatedAt: new Date() } });
  }
  await applyScopedRates(x, 'WORKER', membershipId, changes, x.org.currency);
  const after = await getWorker(x, membershipId);
  await audit(x, { action: 'worker.updated', targetType: 'membership', targetId: membershipId, before, after });
  return after;
}

export async function removeWorker(x: Ctx, membershipId: string) {
  if (!can(x.actor, 'members:manage', { ownerMembershipId: membershipId })) throw forbidden();
  const w = await getWorker(x, membershipId);
  if (w.is_owner) throw businessRule('owner_protected', 'Transfer ownership before removing the owner');
  await x.tx.update(memberships).set({ status: 'REMOVED', updatedAt: new Date() }).where(eq(memberships.id, membershipId));
  await x.tx.delete(teamMembers).where(eq(teamMembers.membershipId, membershipId));
  if (!w.end_date) {
    const endDate = localDate(x.deps.now(), x.org.timezone);
    await x.tx
      .insert(workerProfiles)
      .values({ membershipId, organizationId: x.org.id, timezone: w.timezone, endDate })
      .onConflictDoUpdate({ target: workerProfiles.membershipId, set: { endDate, updatedAt: new Date() } });
  }
  await audit(x, { action: 'worker.removed', targetType: 'membership', targetId: membershipId, before: w });
}

// ─── Personal details ────────────────────────────────────────────────────────
function detailsAccess(x: Ctx, membershipId: string) {
  const admin = can(x.actor, 'members:manage', { ownerMembershipId: membershipId });
  const self = membershipId === x.actor.membershipId;
  if (!admin && !self) throw forbidden();
  return { admin };
}

function detailsDto(d: typeof memberDetails.$inferSelect | undefined, admin: boolean): MemberDetailsDto {
  return {
    first_name: d?.firstName ?? null,
    last_name: d?.lastName ?? null,
    birth_date: d?.birthDate ?? null,
    personal_email: d?.personalEmail ?? null,
    phone: d?.phone ?? null,
    country: d?.country ?? null,
    region: d?.region ?? null,
    city: d?.city ?? null,
    postal_code: d?.postalCode ?? null,
    address: d?.address ?? null,
    emergency_contact_name: d?.emergencyContactName ?? null,
    emergency_contact_phone: d?.emergencyContactPhone ?? null,
    education: d?.education ?? null,
    ...(admin && { notes: d?.notes ?? null }),
  };
}

export async function getMemberDetails(x: Ctx, membershipId: string): Promise<MemberDetailsDto> {
  const { admin } = detailsAccess(x, membershipId);
  await getWorker(x, membershipId);
  const [d] = await x.tx.select().from(memberDetails).where(eq(memberDetails.membershipId, membershipId));
  return detailsDto(d, admin);
}

export async function updateMemberDetails(x: Ctx, membershipId: string, input: z.infer<typeof memberDetailsInput>) {
  const { admin } = detailsAccess(x, membershipId);
  if (input.notes !== undefined && !admin) throw forbidden('Only admins can edit HR notes');
  await getWorker(x, membershipId);
  const map = {
    first_name: 'firstName',
    last_name: 'lastName',
    birth_date: 'birthDate',
    personal_email: 'personalEmail',
    phone: 'phone',
    country: 'country',
    region: 'region',
    city: 'city',
    postal_code: 'postalCode',
    address: 'address',
    emergency_contact_name: 'emergencyContactName',
    emergency_contact_phone: 'emergencyContactPhone',
    education: 'education',
    notes: 'notes',
  } as const;
  const patch: Partial<typeof memberDetails.$inferInsert> = {};
  for (const [k, col] of Object.entries(map) as Array<[keyof typeof map, (typeof map)[keyof typeof map]]>) {
    if (input[k] !== undefined) patch[col] = input[k] || null;
  }
  if (Object.keys(patch).length) {
    await x.tx
      .insert(memberDetails)
      .values({ membershipId, organizationId: x.org.id, ...patch })
      .onConflictDoUpdate({ target: memberDetails.membershipId, set: { ...patch, updatedAt: new Date() } });
  }
  // Personal data stays out of the audit trail: record which fields changed, not their values.
  await audit(x, { action: 'worker.details_updated', targetType: 'membership', targetId: membershipId, metadata: { fields: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined) } });
  return getMemberDetails(x, membershipId);
}

export async function inviteWorker(x: Ctx, input: z.infer<typeof inviteInput>) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  const role = await assertCanAssignRole(x, input.role_id);
  const existing = await x.tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, x.org.id), eq(users.email, input.email.toLowerCase())));
  if (existing.some((e) => e.status === 'ACTIVE')) throw conflict('already_member', 'This person is already a member');
  const teamIds = [...new Set(input.team_ids)];
  const projectIds = [...new Set(input.project_ids)];
  if (teamIds.length && (await x.tx.select({ id: teams.id }).from(teams).where(inArray(teams.id, teamIds))).length !== teamIds.length) throw validation('Choose teams from this workspace', { errors: [{ field: 'team_ids', message: 'Choose teams from this workspace' }] });
  if (projectIds.length && (await x.tx.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, projectIds), isNull(projects.archivedAt)))).length !== projectIds.length)
    throw validation('Choose active projects from this workspace', { errors: [{ field: 'project_ids', message: 'Choose active projects from this workspace' }] });
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
    teamIds,
    teamRole: teamIds.length ? input.team_role : 'MEMBER',
    projectIds,
    tokenHash: sha256(token),
    invitedBy: x.actor.membershipId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const url = `${x.deps.config.appUrl}/invite?token=${token}`;
  // A failed send must not lose the invitation: the admin can still share the link.
  let emailSent = x.deps.mailer.delivers !== false;
  const mail = renderEmail(
    {
      subject: `You're invited to ${x.org.name} on WorkPulse`,
      preheader: `${x.org.name} invited you to their workspace. The link expires in 7 days.`,
      heading: `Join ${x.org.name} on WorkPulse`,
      paragraphs: [`${x.org.name} invited you to their workspace on WorkPulse, where the team tracks time, timesheets and projects.`, `You'll join as ${role.name}. Accept the invitation to choose your password and get started.`],
      action: { label: 'Accept invitation', url },
      note: "This link expires in 7 days. If you weren't expecting this invitation, you can ignore this email.",
      reason: `You received this email because someone at ${x.org.name} invited this address to WorkPulse.`,
    },
    { appUrl: x.deps.config.appUrl, to: input.email },
  );
  await x.deps.mailer.send(mail).catch(() => {
    emailSent = false;
  });
  await audit(x, { action: 'invitation.created', targetType: 'invitation', targetId: id, after: { email: input.email, role: role.key, teams: teamIds.length, team_role: teamIds.length ? input.team_role : undefined, projects: projectIds.length } });
  return { id, email: input.email.toLowerCase(), invite_url: url, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(), email_sent: emailSent };
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
