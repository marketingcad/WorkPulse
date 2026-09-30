import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  activityMinutes,
  activityWindows,
  apiKeys,
  appSpans,
  auditLogs,
  dashboardLayouts,
  deviceCredentials,
  devices,
  emailTokens,
  expenses,
  idleEvents,
  manualTimeRequests,
  memberships,
  mfaFactors,
  notificationPreferences,
  notifications,
  reportRuns,
  roles,
  screenshots,
  teamMembers,
  timeEntries,
  timeOffLedger,
  timeOffRequests,
  timesheets,
  trackingSessions,
  urlSpans,
  userSessions,
  users,
  workerProfiles,
  memberDetails,
  type Tx,
} from '@tallywork/db';
import { businessRule, can, forbidden, newId, notFound } from '@tallywork/domain';
import type { Deps } from '../context';
import { randomToken } from '../lib/crypto';
import { hashPassword } from '../lib/crypto';
import type { Ctx } from './ctx';
import { audit } from './events';

export const DATA_EXPORT_KEY = 'data-export';

/**
 * Data subject access: queue a complete export of one member's personal data in this
 * organization (JSON), delivered like any other export (signed link + notification).
 * Members may export their own data; admins with members:manage may export anyone's.
 */
export async function queueDataExport(x: Ctx, membershipId: string) {
  const self = membershipId === x.actor.membershipId;
  if (!self && !x.actor.grants['members:manage']) throw forbidden();
  const [m] = await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, membershipId));
  if (!m) throw notFound('worker');
  const id = newId();
  await x.tx.insert(reportRuns).values({ id, organizationId: x.org.id, membershipId: x.actor.membershipId, reportKey: DATA_EXPORT_KEY, format: 'JSON', params: { membership_id: membershipId } });
  await audit(x, { action: 'privacy.export_requested', targetType: 'membership', targetId: membershipId, metadata: { run_id: id } });
  const { processReportRuns } = await import('./report-runs');
  x.deps.defer(() => processReportRuns(x.deps).then(() => undefined));
  return { id, status: 'QUEUED' as const };
}

/** Everything held about one member in this organization (screenshot images are listed, not embedded). */
export async function collectMemberData(tx: Tx, membershipId: string) {
  const [m] = await tx.select({ m: memberships, role: roles.name }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(eq(memberships.id, membershipId));
  if (!m) throw notFound('worker');
  const [u] = await tx.select({ id: users.id, name: users.name, email: users.email, locale: users.locale, created_at: users.createdAt }).from(users).where(eq(users.id, m.m.userId));
  const by = <T extends { membershipId: unknown }>(t: T) => eq(t.membershipId as never, membershipId);
  const sessions = await tx.select().from(trackingSessions).where(by(trackingSessions)).orderBy(asc(trackingSessions.startedAt));
  return {
    exported_at: new Date().toISOString(),
    account: u,
    membership: { id: m.m.id, role: m.role, status: m.m.status, joined_at: m.m.createdAt },
    profile: (await tx.select().from(workerProfiles).where(eq(workerProfiles.membershipId, membershipId)))[0] ?? null,
    personal_details: (await tx.select().from(memberDetails).where(eq(memberDetails.membershipId, membershipId)))[0] ?? null,
    time_entries: await tx.select().from(timeEntries).where(by(timeEntries)).orderBy(asc(timeEntries.startedAt)),
    tracking_sessions: sessions,
    activity_minutes: await tx.select().from(activityMinutes).where(inArray(activityMinutes.sessionId, sessions.length ? sessions.map((s) => s.id) : ['00000000-0000-7000-8000-000000000000'])),
    idle_events: await tx.select().from(idleEvents).where(by(idleEvents)),
    app_usage: await tx.select().from(appSpans).where(by(appSpans)),
    website_usage: await tx.select().from(urlSpans).where(by(urlSpans)),
    screenshots: (await tx.select().from(screenshots).where(by(screenshots))).map((s) => ({ id: s.id, captured_at: s.capturedAt, blurred: s.blurred, width: s.width, height: s.height })),
    timesheets: await tx.select().from(timesheets).where(by(timesheets)),
    manual_time_requests: await tx.select().from(manualTimeRequests).where(by(manualTimeRequests)),
    time_off_requests: await tx.select().from(timeOffRequests).where(by(timeOffRequests)),
    time_off_ledger: await tx.select().from(timeOffLedger).where(by(timeOffLedger)),
    expenses: await tx.select().from(expenses).where(by(expenses)),
    devices: (await tx.select().from(devices).where(by(devices))).map((d) => ({ id: d.id, name: d.name, platform: d.platform, status: d.status, last_seen_at: d.lastSeenAt })),
    notifications: await tx.select().from(notifications).where(by(notifications)),
    actions_in_audit_log: await tx.select({ action: auditLogs.action, target_type: auditLogs.targetType, created_at: auditLogs.createdAt }).from(auditLogs).where(eq(auditLogs.actorId, membershipId)).orderBy(asc(auditLogs.createdAt)),
  };
}

/**
 * Erasure request: remove a member and their personal monitoring data. Kept, because the law
 * or the organization's books need them: time entries, timesheets, approvals, billing, invoices,
 * expenses and the audit trail (with network identifiers removed). The account itself is
 * anonymized when the person belongs to no other organization.
 */
export async function anonymizeMember(x: Ctx, membershipId: string) {
  if (!x.actor.grants['members:manage']) throw forbidden();
  if (membershipId === x.actor.membershipId) throw businessRule('cannot_erase_self', 'Ask another admin to erase your data');
  const [m] = await x.tx.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m || !can(x.actor, 'members:manage', { ownerMembershipId: membershipId })) throw notFound('worker');
  if (m.isOwner) throw businessRule('owner_protected', 'Transfer ownership before erasing the owner');
  const live = await x.tx.select({ id: trackingSessions.id }).from(trackingSessions).where(and(eq(trackingSessions.membershipId, membershipId), inArray(trackingSessions.state, ['ACTIVE', 'PAUSED', 'INTERRUPTED']))).limit(1);
  if (live.length) throw businessRule('member_tracking', 'Stop this member’s timer first');

  const shots = await x.tx.select({ id: screenshots.id, key: screenshots.storageKey }).from(screenshots).where(eq(screenshots.membershipId, membershipId));
  if (shots.length) await x.deps.storage.delete(shots.flatMap((s) => [s.key, `${s.key}.thumb`]));
  const counts: Record<string, number> = { screenshots: shots.length };
  await x.tx.delete(screenshots).where(eq(screenshots.membershipId, membershipId));
  const sessionIds = (await x.tx.select({ id: trackingSessions.id }).from(trackingSessions).where(eq(trackingSessions.membershipId, membershipId))).map((s) => s.id);
  if (sessionIds.length) counts.activity_minutes = (await x.tx.delete(activityMinutes).where(inArray(activityMinutes.sessionId, sessionIds)).returning({ s: activityMinutes.sessionId })).length;
  counts.activity_windows = (await x.tx.delete(activityWindows).where(eq(activityWindows.membershipId, membershipId)).returning({ m: activityWindows.membershipId })).length;
  counts.app_spans = (await x.tx.delete(appSpans).where(eq(appSpans.membershipId, membershipId)).returning({ id: appSpans.id })).length;
  counts.url_spans = (await x.tx.delete(urlSpans).where(eq(urlSpans.membershipId, membershipId)).returning({ id: urlSpans.id })).length;
  await x.tx.delete(notifications).where(eq(notifications.membershipId, membershipId));
  await x.tx.delete(notificationPreferences).where(eq(notificationPreferences.membershipId, membershipId));
  await x.tx.delete(dashboardLayouts).where(eq(dashboardLayouts.membershipId, membershipId));
  const deviceIds = (await x.tx.select({ id: devices.id }).from(devices).where(eq(devices.membershipId, membershipId))).map((d) => d.id);
  if (deviceIds.length) {
    await x.tx.delete(deviceCredentials).where(inArray(deviceCredentials.deviceId, deviceIds));
    await x.tx.update(devices).set({ name: 'Removed device', status: 'REVOKED' }).where(inArray(devices.id, deviceIds));
  }
  await x.tx.update(workerProfiles).set({ title: null, updatedAt: new Date() }).where(eq(workerProfiles.membershipId, membershipId));
  await x.tx.delete(memberDetails).where(eq(memberDetails.membershipId, membershipId));
  await x.tx.delete(teamMembers).where(eq(teamMembers.membershipId, membershipId));
  await x.tx.update(memberships).set({ status: 'REMOVED', updatedAt: new Date() }).where(eq(memberships.id, membershipId));
  await x.tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.createdBy, m.userId), eq(apiKeys.organizationId, x.org.id), isNull(apiKeys.revokedAt)));
  const scrub = await x.tx.execute<{ n: number }>(sql`select tallywork_scrub_audit_actor(${membershipId}::uuid) as n`);
  counts.audit_entries_scrubbed = Number((scrub as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);

  // The login identity is shared across organizations: anonymize it only when nothing else uses it.
  const elsewhere = await x.tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, m.userId), ne(memberships.id, membershipId), ne(memberships.status, 'REMOVED'))).limit(1);
  const accountAnonymized = !elsewhere.length;
  if (accountAnonymized) await anonymizeUser(x.tx, x.deps, m.userId);
  await audit(x, { action: 'worker.anonymized', targetType: 'membership', targetId: membershipId, metadata: { ...counts, account_anonymized: accountAnonymized } });
  return { membership_id: membershipId, account_anonymized: accountAnonymized, deleted: counts };
}

async function anonymizeUser(tx: Tx, deps: Deps, userId: string) {
  await tx
    .update(users)
    .set({ name: 'Former member', email: `erased+${userId}@erased.invalid`, passwordHash: await hashPassword(randomToken(32)), emailVerifiedAt: null, avatarUrl: null, anonymizedAt: deps.now(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await tx.delete(mfaFactors).where(eq(mfaFactors.userId, userId));
  await tx.delete(emailTokens).where(eq(emailTokens.userId, userId));
  await tx.update(userSessions).set({ revokedAt: deps.now() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
}

/**
 * Permission review: who holds what. Roles with their grants and member counts, members with
 * their role and two-factor status, and active API keys with their scopes and creator.
 */
export async function permissionReview(x: Ctx) {
  if (!x.actor.grants['members:manage'] && !x.actor.grants['settings:security']) throw forbidden();
  const { rolePermissions } = await import('@tallywork/db');
  const rs = await x.tx.select().from(roles).where(ne(roles.key, 'AGENT')).orderBy(asc(roles.name));
  const perms = await x.tx.select().from(rolePermissions);
  const ms = await x.tx
    .select({ id: memberships.id, roleId: memberships.roleId, isOwner: memberships.isOwner, name: users.name, email: users.email, userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.status, 'ACTIVE'))
    .orderBy(asc(users.name));
  const mfa = new Set((await x.tx.select({ u: mfaFactors.userId }).from(mfaFactors).where(sql`${mfaFactors.verifiedAt} is not null`)).map((r) => r.u));
  const keys = await x.tx.select().from(apiKeys).where(isNull(apiKeys.revokedAt));
  const nameOfUser = new Map(ms.map((m) => [m.userId, m.name]));
  return {
    roles: rs.map((r) => ({ id: r.id, key: r.key, name: r.name, members: ms.filter((m) => m.roleId === r.id).length, grants: Object.fromEntries(perms.filter((p) => p.roleId === r.id).map((p) => [p.permission, p.scope])) })),
    members: ms.map((m) => ({ membership_id: m.id, name: m.name, email: m.email, role: rs.find((r) => r.id === m.roleId)?.name ?? '', is_owner: m.isOwner, mfa_enabled: mfa.has(m.userId) })),
    api_keys: keys.map((k) => ({ id: k.id, name: k.name, scopes: k.scopes, created_by: nameOfUser.get(k.createdBy) ?? '(no longer a member)', last_used_at: k.lastUsedAt?.toISOString() ?? null, expires_at: k.expiresAt?.toISOString() ?? null })),
  };
}
