import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  clientPortalAccess,
  clientPortalSettings,
  clients,
  emailTokens,
  invitations,
  invoiceSequences,
  memberships,
  organizations,
  overtimeRuleSets,
  projectMembers,
  retentionPolicies,
  rolePermissions,
  roles,
  teamMembers,
  trackingPolicies,
  userSessions,
  users,
  workerProfiles,
  withSystem,
  withTenant,
  type Db,
  type OrgSettings,
  type Tx,
} from '@tallywork/db';
import { BUILTIN_ROLES, DEFAULT_OVERTIME, DomainError, ROLE_PRESETS, businessRule, conflict, newId, notFound, type BuiltinRole } from '@tallywork/domain';
import type { MeDto } from '@tallywork/contracts';
import type { Deps } from '../context';
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { auditSystem } from './events';

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  lateGraceMinutes: 5,
  durationFormat: 'hm',
  budgetWarnPct: 80,
  requireDeviceApproval: false,
  enforceMfa: 'none',
  sessionTtlHours: 24 * 14,
};

export const DEFAULT_RETENTION_DAYS = {
  SCREENSHOTS: 180,
  ACTIVITY: 365,
  APPS: 365,
  URLS: 365,
  SESSIONS: 730,
  TIMESHEETS: 2555,
  INVOICES: 2555,
  AUDIT: 2555,
  LOCATION: 90,
} as const;

const ROLE_NAMES: Record<BuiltinRole, { name: string; description: string }> = {
  SYSTEM_ADMIN: { name: 'System Admin', description: 'Full access to the organization' },
  TEAM_MANAGER: { name: 'Team Manager', description: 'Manages the teams they lead' },
  WORKER: { name: 'Worker', description: 'Tracks time on assigned projects' },
  AGENT: { name: 'Agent', description: 'Desktop agent device principal (technical)' },
};

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'x'}`;
}

/** Create an organization with built-in roles, default policy and the owner membership. */
export async function createOrganization(
  db: Db,
  input: { name: string; timezone: string; currency: string; ownerUserId: string; isDemo?: boolean },
): Promise<{ organizationId: string; membershipId: string; roleIds: Record<BuiltinRole, string> }> {
  const organizationId = newId();
  await withSystem(db, async (tx) => {
    await tx.insert(organizations).values({
      id: organizationId,
      slug: slugify(input.name),
      name: input.name,
      timezone: input.timezone,
      currency: input.currency,
      settings: DEFAULT_ORG_SETTINGS,
      isDemo: input.isDemo ?? false,
    });
  });
  return withTenant(db, organizationId, async (tx) => {
    const roleIds = {} as Record<BuiltinRole, string>;
    for (const key of BUILTIN_ROLES) {
      const id = newId();
      roleIds[key] = id;
      await tx.insert(roles).values({ id, organizationId, key, name: ROLE_NAMES[key].name, description: ROLE_NAMES[key].description, builtin: true });
      const grants = Object.entries(ROLE_PRESETS[key]);
      if (grants.length) {
        await tx.insert(rolePermissions).values(grants.map(([permission, scope]) => ({ organizationId, roleId: id, permission, scope: scope! })));
      }
    }
    const membershipId = newId();
    await tx.insert(memberships).values({ id: membershipId, organizationId, userId: input.ownerUserId, roleId: roleIds.SYSTEM_ADMIN, isOwner: true });
    // The owner runs the organization; they are only tracked if an admin turns it on.
    await tx.insert(workerProfiles).values({ membershipId, organizationId, timezone: input.timezone, trackingEnabled: false });
    await tx.insert(trackingPolicies).values({ id: newId(), organizationId, scopeType: 'ORG', scopeId: organizationId, doc: {} });
    await tx.insert(retentionPolicies).values(Object.entries(DEFAULT_RETENTION_DAYS).map(([dataClass, keepDays]) => ({ organizationId, dataClass: dataClass as keyof typeof DEFAULT_RETENTION_DAYS, keepDays })));
    await tx.insert(invoiceSequences).values({ organizationId });
    await tx.insert(overtimeRuleSets).values({ organizationId, rules: DEFAULT_OVERTIME });
    await auditSystem(tx, organizationId, { action: 'organization.created', actorType: 'user', actorId: membershipId, targetType: 'organization', targetId: organizationId, after: { name: input.name } });
    return { organizationId, membershipId, roleIds };
  });
}

export async function findUserByEmail(db: Db, email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return u ?? null;
}

export async function createUser(db: Db, input: { name: string; email: string; password: string; verified?: boolean }) {
  if (await findUserByEmail(db, input.email)) throw conflict('email_taken', 'An account with this email already exists');
  const id = newId();
  await db.insert(users).values({
    id,
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: await hashPassword(input.password),
    emailVerifiedAt: input.verified ? new Date() : null,
  });
  return id;
}

/** The shortest session lifetime set by any organization the user belongs to (never longer than the platform default). */
export async function sessionTtlFor(deps: Deps, userIdValue: string): Promise<number> {
  const rows = await withSystem(deps.db, (tx) =>
    tx.select({ settings: organizations.settings }).from(memberships).innerJoin(organizations, eq(organizations.id, memberships.organizationId)).where(and(eq(memberships.userId, userIdValue), eq(memberships.status, 'ACTIVE'))),
  );
  return Math.min(deps.config.sessionTtlHours, ...rows.map((r) => r.settings.sessionTtlHours ?? deps.config.sessionTtlHours));
}

export async function createSession(deps: Deps, userIdValue: string, meta: { ip: string | null; userAgent: string | null }, opts: { ttlHours?: number; mfaPending?: boolean } = {}) {
  const token = randomToken(32);
  // A pending second step gets 10 minutes; a full session the strictest organization lifetime.
  const ttlHours = opts.mfaPending ? 1 / 6 : (opts.ttlHours ?? (await sessionTtlFor(deps, userIdValue)));
  const expiresAt = new Date(deps.now().getTime() + ttlHours * 3600_000);
  await deps.db.insert(userSessions).values({
    id: newId(),
    userId: userIdValue,
    tokenHash: sha256(token),
    ipAddress: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt,
    mfaPending: !!opts.mfaPending,
  });
  return { token, expiresAt };
}

export async function login(deps: Deps, email: string, password: string): Promise<{ userId: string }> {
  const invalid = new DomainError('unauthenticated', 'invalid_credentials', 'Email or password is incorrect');
  const u = await findUserByEmail(deps.db, email);
  if (!u) {
    await verifyPassword(await dummyPasswordHash(), password); // constant-ish timing
    throw invalid;
  }
  if (u.lockedUntil && u.lockedUntil > deps.now()) {
    throw new DomainError('rate_limited', 'account_locked', 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!(await verifyPassword(u.passwordHash, password))) {
    const failed = u.failedLoginCount + 1;
    await deps.db
      .update(users)
      .set({ failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(deps.now().getTime() + LOCK_MINUTES * 60_000) : null })
      .where(eq(users.id, u.id));
    throw invalid;
  }
  // Checked only after the password, so it does not reveal which emails have accounts.
  if (deps.config.requireEmailVerification && !u.emailVerifiedAt) {
    throw new DomainError('forbidden', 'email_not_verified', 'Confirm your email before signing in. Check your inbox for the link.');
  }
  if (u.failedLoginCount > 0 || u.lockedUntil) await deps.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
  return { userId: u.id };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
}

export async function getMe(db: Db, userIdValue: string, mfaEnabled = false): Promise<MeDto> {
  const [u] = await db.select().from(users).where(eq(users.id, userIdValue)).limit(1);
  if (!u) throw notFound('user');
  const orgs = await withSystem(db, (tx) =>
    tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        roleKey: roles.key,
        roleName: roles.name,
        membershipId: memberships.id,
        isOwner: memberships.isOwner,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userIdValue), eq(memberships.status, 'ACTIVE')))
      .orderBy(organizations.name),
  );
  const portals = await withSystem(db, (tx) =>
    tx
      .select({ accessId: clientPortalAccess.id, organizationName: organizations.name, clientName: clients.name })
      .from(clientPortalAccess)
      .innerJoin(organizations, eq(organizations.id, clientPortalAccess.organizationId))
      .innerJoin(clients, eq(clients.id, clientPortalAccess.clientId))
      .innerJoin(clientPortalSettings, and(eq(clientPortalSettings.organizationId, clientPortalAccess.organizationId), eq(clientPortalSettings.clientId, clientPortalAccess.clientId)))
      .where(and(eq(clientPortalAccess.userId, userIdValue), eq(clientPortalAccess.status, 'ACTIVE'), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt)))
      .orderBy(organizations.name, clients.name),
  );
  return {
    user: { id: u.id, name: u.name, email: u.email, email_verified: !!u.emailVerifiedAt, mfa_enabled: mfaEnabled, locale: u.locale },
    organizations: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role_key: o.roleKey, role_name: o.roleName, membership_id: o.membershipId, is_owner: o.isOwner })),
    client_portals: portals.map((p) => ({ access_id: p.accessId, organization_name: p.organizationName, client_name: p.clientName })),
  };
}

export async function issueEmailToken(db: Db, userIdValue: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', ttlMinutes: number): Promise<string> {
  const token = randomToken(32);
  await db.insert(emailTokens).values({ id: newId(), userId: userIdValue, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) });
  return token;
}

export async function consumeEmailToken(db: Db, token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'): Promise<string> {
  const [t] = await db
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())))
    .limit(1);
  if (!t) throw businessRule('invalid_token', 'This link is invalid or has expired');
  await db.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, t.id));
  return t.userId;
}

export async function resetPassword(db: Db, token: string, password: string): Promise<void> {
  const uid = await consumeEmailToken(db, token, 'RESET_PASSWORD');
  await db.update(users).set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, uid));
  // Sign out everywhere after a reset.
  await db.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, uid), isNull(userSessions.revokedAt)));
}

/** Accept an invitation: creates the user if needed, then the membership. */
export async function acceptInvitation(
  db: Db,
  input: { token: string; name?: string | null; password?: string | null; currentUserId?: string | null },
): Promise<{ userId: string; organizationId: string; membershipId: string; roleKey: string | null }> {
  const inv = await withSystem(db, async (tx) => {
    const [i] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, sha256(input.token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    return i ?? null;
  });
  if (!inv) throw businessRule('invalid_invitation', 'This invitation is invalid or has expired');

  let uid = input.currentUserId ?? null;
  const existing = await findUserByEmail(db, inv.email);
  if (uid) {
    const [me] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!me || me.email.toLowerCase() !== inv.email.toLowerCase()) throw businessRule('invitation_email_mismatch', `This invitation was sent to ${inv.email}`);
  } else if (existing) {
    throw businessRule('login_required', 'Sign in with your existing account to accept this invitation');
  } else {
    if (!input.password) throw businessRule('password_required', 'Choose a password to create your account');
    uid = await createUser(db, { name: input.name ?? inv.name ?? inv.email.split('@')[0]!, email: inv.email, password: input.password, verified: true });
  }

  return withTenant(db, inv.organizationId, async (tx) => {
    const [role] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.id, inv.roleId));
    const [dup] =await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, uid!), eq(memberships.organizationId, inv.organizationId))).limit(1);
    let membershipId: string;
    if (dup) {
      membershipId = dup.id;
      await tx.update(memberships).set({ status: 'ACTIVE', roleId: inv.roleId, updatedAt: new Date() }).where(eq(memberships.id, dup.id));
    } else {
      membershipId = newId();
      const [org] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, inv.organizationId));
      await tx.insert(memberships).values({ id: membershipId, organizationId: inv.organizationId, userId: uid!, roleId: inv.roleId });
      // Only Workers are tracked by default; admins and managers can be switched on per person.
      await tx.insert(workerProfiles).values({ membershipId, organizationId: inv.organizationId, timezone: org?.tz ?? 'UTC', trackingEnabled: role?.key === 'WORKER' });
    }
    // Teams (with the invited team role) and projects apply to new and returning members alike.
    for (const teamId of inv.teamIds) {
      await tx.insert(teamMembers).values({ organizationId: inv.organizationId, teamId, membershipId, role: inv.teamRole }).onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.membershipId], set: { role: inv.teamRole } });
    }
    for (const projectId of inv.projectIds) {
      await tx.insert(projectMembers).values({ organizationId: inv.organizationId, projectId, membershipId }).onConflictDoNothing();
    }
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await auditSystem(tx, inv.organizationId, { action: 'invitation.accepted', actorType: 'user', actorId: membershipId, targetType: 'membership', targetId: membershipId, after: { email: inv.email } });
    return { userId: uid!, organizationId: inv.organizationId, membershipId, roleKey: role?.key ?? null };
  });
}

export async function markEmailVerified(db: Db, uid: string): Promise<void> {
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, uid));
}

export type { Tx };
