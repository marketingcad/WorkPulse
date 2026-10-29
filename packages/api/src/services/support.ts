import { and, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  devices,
  emailTokens,
  integrationConnections,
  memberships,
  organizations,
  outboxEvents,
  reportRuns,
  roles,
  supportGrants,
  timeEntries,
  trackingSessions,
  users,
  webhookEndpoints,
  withSystem,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { DomainError, businessRule, forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { Deps, Principal } from '../context';
import type { Ctx } from './ctx';
import { audit } from './events';

/**
 * Support console for Tallywork staff. Staff are listed in SUPPORT_STAFF_EMAILS and must have
 * passed two-factor on this session. Without a grant, staff see only operational metadata
 * (counts, statuses, health). With a grant the organization gave (time-limited, read-only),
 * they also see members, devices and the audit log. Every look is written to the
 * organization's own audit log as a `support` actor.
 */
export async function assertSupportStaff(deps: Deps, principal: Principal | null): Promise<{ userId: string; email: string }> {
  if (!principal || principal.type !== 'user') throw new DomainError('unauthenticated', 'unauthenticated', 'Please sign in to continue');
  const [u] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, principal.userId));
  if (!u || !deps.config.supportStaffEmails.includes(u.email.toLowerCase())) throw notFound('route');
  // The address must be proven (audit 29 Oct 2026, AUTH-005): with email verification off, signing up
  // marks an account verified, so anyone registering a staff address first would get the console.
  // A verification or password-reset link this account opened shows it controls the mailbox.
  const [proof] = await deps.db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, principal.userId), inArray(emailTokens.purpose, ['VERIFY_EMAIL', 'RESET_PASSWORD']), isNotNull(emailTokens.usedAt)))
    .limit(1);
  if (!proof) throw forbidden('Confirm your email address first: open the link in the verification or password reset email');
  if (!principal.mfaVerified) throw forbidden('The support console needs a session verified with two-factor authentication');
  return { userId: principal.userId, email: u.email };
}

async function logSupport(tx: Tx, organizationId: string, staff: { userId: string; email: string }, action: string, metadata: Record<string, unknown> = {}) {
  await tx.insert(auditLogs).values({ id: newId(), organizationId, actorType: 'support', actorId: staff.userId, action, targetType: 'organization', targetId: organizationId, metadata: { staff_email: staff.email, ...metadata } });
}

async function activeGrant(tx: Tx, now: Date) {
  const [g] = await tx.select().from(supportGrants).where(and(gt(supportGrants.expiresAt, now), isNull(supportGrants.revokedAt))).orderBy(desc(supportGrants.expiresAt)).limit(1);
  return g ?? null;
}

/** Find organizations by name, slug, id or the owner's email. */
export async function searchOrganizations(deps: Deps, staff: { userId: string; email: string }, q: string) {
  const term = q.trim();
  if (term.length < 2) throw validation('Type at least 2 characters');
  return withSystem(deps.db, async (tx) => {
    const byOwner = tx.select({ id: memberships.organizationId }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.isOwner, true), ilike(users.email, `%${term}%`)));
    const rows = await tx
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, createdAt: organizations.createdAt })
      .from(organizations)
      .where(or(ilike(organizations.name, `%${term}%`), ilike(organizations.slug, `%${term}%`), /^[0-9a-f-]{36}$/i.test(term) ? eq(organizations.id, term) : undefined, inArray(organizations.id, byOwner)))
      .orderBy(organizations.name)
      .limit(25);
    void staff;
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, created_at: r.createdAt.toISOString() }));
  });
}

/** Operational overview of one organization (no personal data except the owner's contact). */
export async function organizationOverview(deps: Deps, staff: { userId: string; email: string }, organizationId: string) {
  const now = deps.now();
  const dayAgo = new Date(now.getTime() - 86400_000);
  return withTenant(deps.db, organizationId, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!org) throw notFound('organization');
    const [owner] = await tx.select({ name: users.name, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.isOwner, true)).limit(1);
    const [members] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.status, 'ACTIVE'));
    const deviceRows = await tx.select({ status: devices.status, n: count() }).from(devices).groupBy(devices.status);
    const versions = await tx.select({ v: devices.agentVersion, n: count() }).from(devices).where(eq(devices.status, 'ACTIVE')).groupBy(devices.agentVersion);
    const [live] = await tx.select({ n: count() }).from(trackingSessions).where(sql`${trackingSessions.state} <> 'STOPPED'`);
    const [lastEntry] = await tx.select({ at: max(timeEntries.endedAt) }).from(timeEntries);
    const [parked] = await tx.select({ n: count() }).from(outboxEvents).where(and(isNull(outboxEvents.processedAt), gte(outboxEvents.attempts, 10)));
    const hooks = await tx.select({ enabled: webhookEndpoints.enabled, failures: webhookEndpoints.failureCount, reason: webhookEndpoints.disabledReason }).from(webhookEndpoints);
    const [intErrors] = await tx.select({ n: count() }).from(integrationConnections).where(eq(integrationConnections.status, 'ERROR'));
    const [runsFailed] = await tx.select({ n: count() }).from(reportRuns).where(and(eq(reportRuns.status, 'FAILED'), gte(reportRuns.createdAt, dayAgo)));
    const grant = await activeGrant(tx, now);
    await logSupport(tx, organizationId, staff, 'support.overview_viewed');
    return {
      organization: { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, currency: org.currency, created_at: org.createdAt.toISOString() },
      owner: owner ?? null,
      members: Number(members?.n ?? 0),
      devices: Object.fromEntries(deviceRows.map((d) => [d.status, Number(d.n)])),
      agent_versions: Object.fromEntries(versions.map((v) => [v.v ?? 'unknown', Number(v.n)])),
      live_sessions: Number(live?.n ?? 0),
      last_time_entry_at: lastEntry?.at?.toISOString() ?? null,
      health: {
        parked_events: Number(parked?.n ?? 0),
        webhooks: { endpoints: hooks.length, disabled: hooks.filter((h) => !h.enabled).length, failing: hooks.filter((h) => h.failures > 0).length },
        integrations_in_error: Number(intErrors?.n ?? 0),
        exports_failed_24h: Number(runsFailed?.n ?? 0),
      },
      security: { enforce_mfa: org.settings.enforceMfa, session_ttl_hours: org.settings.sessionTtlHours, ip_allowlist_ranges: org.settings.ipAllowlist?.length ?? 0, device_approval: org.settings.requireDeviceApproval },
      support_access: grant ? { expires_at: grant.expiresAt.toISOString(), reason: grant.reason } : null,
    };
  });
}

/** With an active grant only: members, devices and the latest audit entries. Read-only. */
export async function grantedDetails(deps: Deps, staff: { userId: string; email: string }, organizationId: string) {
  return withTenant(deps.db, organizationId, async (tx) => {
    const grant = await activeGrant(tx, deps.now());
    if (!grant) throw forbidden('This organization has not granted support access. Ask an admin to grant it under Settings → Security.');
    const members = await tx
      .select({ id: memberships.id, name: users.name, email: users.email, role: roles.name, status: memberships.status, isOwner: memberships.isOwner })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .orderBy(users.name)
      .limit(500);
    const deviceList = await tx.select({ id: devices.id, name: devices.name, platform: devices.platform, status: devices.status, version: devices.agentVersion, lastSeenAt: devices.lastSeenAt, lastSyncAt: devices.lastSyncAt }).from(devices).orderBy(desc(devices.lastSeenAt)).limit(500);
    const log = await tx.select({ action: auditLogs.action, actorType: auditLogs.actorType, targetType: auditLogs.targetType, createdAt: auditLogs.createdAt }).from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
    await logSupport(tx, organizationId, staff, 'support.details_viewed', { grant_id: grant.id });
    return {
      grant: { expires_at: grant.expiresAt.toISOString(), reason: grant.reason },
      members: members.map((m) => ({ membership_id: m.id, name: m.name, email: m.email, role: m.role, status: m.status, is_owner: m.isOwner })),
      devices: deviceList.map((d) => ({ ...d, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, lastSyncAt: d.lastSyncAt?.toISOString() ?? null })),
      audit: log.map((l) => ({ action: l.action, actor_type: l.actorType, target_type: l.targetType, created_at: l.createdAt.toISOString() })),
    };
  });
}

// ─── The organization's side ─────────────────────────────────────────────────
function assertCanGrant(x: Ctx) {
  if (!x.actor.grants['settings:security']) throw forbidden();
}

export async function getSupportAccess(x: Ctx) {
  assertCanGrant(x);
  const g = await activeGrant(x.tx, x.deps.now());
  return g ? { active: true, expires_at: g.expiresAt.toISOString(), reason: g.reason } : { active: false, expires_at: null, reason: null };
}

/** Grant read-only support access for 1–72 hours (replaces any active grant). */
export async function grantSupportAccess(x: Ctx, input: { hours: number; reason: string }) {
  assertCanGrant(x);
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 72) throw validation('Grant access for 1 to 72 hours', { errors: [{ field: 'hours', message: '1–72' }] });
  const now = x.deps.now();
  await x.tx.update(supportGrants).set({ revokedAt: now }).where(and(gt(supportGrants.expiresAt, now), isNull(supportGrants.revokedAt)));
  const expiresAt = new Date(now.getTime() + input.hours * 3600_000);
  await x.tx.insert(supportGrants).values({ id: newId(), organizationId: x.org.id, grantedBy: x.actor.membershipId, reason: input.reason, expiresAt });
  await audit(x, { action: 'support.access_granted', targetType: 'organization', targetId: x.org.id, metadata: { hours: input.hours, reason: input.reason, expires_at: expiresAt.toISOString() } });
  return getSupportAccess(x);
}

export async function revokeSupportAccess(x: Ctx) {
  assertCanGrant(x);
  const r = await x.tx.update(supportGrants).set({ revokedAt: x.deps.now() }).where(and(gt(supportGrants.expiresAt, x.deps.now()), isNull(supportGrants.revokedAt))).returning({ id: supportGrants.id });
  if (!r.length) throw businessRule('no_support_access', 'Support access is not active');
  await audit(x, { action: 'support.access_revoked', targetType: 'organization', targetId: x.org.id });
  return getSupportAccess(x);
}
