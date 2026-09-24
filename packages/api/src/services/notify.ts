import { and, eq, inArray } from 'drizzle-orm';
import { memberships, notificationPreferences, notifications, rolePermissions, teamMembers, users, type Tx } from '@tallywork/db';
import { newId, type Permission } from '@tallywork/domain';
import type { Deps } from '../context';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  payload?: Record<string, unknown>;
}

/** Deliver an in-app notification (+ email when the member opted in). */
export async function notify(tx: Tx, deps: Deps, organizationId: string, membershipIds: string[], n: NotificationInput): Promise<void> {
  const ids = [...new Set(membershipIds)];
  if (!ids.length) return;
  const prefs = await tx.select().from(notificationPreferences).where(and(inArray(notificationPreferences.membershipId, ids), eq(notificationPreferences.type, n.type)));
  const prefBy = new Map(prefs.map((p) => [p.membershipId, p]));
  const inApp = ids.filter((id) => prefBy.get(id)?.inApp ?? true);
  if (inApp.length) {
    await tx.insert(notifications).values(
      inApp.map((membershipId) => ({ id: newId(), organizationId, membershipId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, payload: n.payload ?? {} })),
    );
  }
  const emailIds = ids.filter((id) => prefBy.get(id)?.email);
  if (emailIds.length) {
    const rows = await tx.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.id, emailIds));
    for (const r of rows) {
      await deps.mailer.send({ to: r.email, subject: n.title, text: `${n.body ?? ''}\n\n${n.link ? `${deps.config.appUrl}${n.link}` : ''}` }).catch(() => undefined);
    }
  }
}

/**
 * Members who hold `permission` over `workerMembershipId`: org-scope holders plus
 * managers of the worker's teams (team scope).
 */
export async function approversFor(tx: Tx, organizationId: string, workerMembershipId: string, permission: Permission): Promise<string[]> {
  const holders = await tx
    .select({ id: memberships.id, scope: rolePermissions.scope })
    .from(memberships)
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, memberships.roleId), eq(rolePermissions.permission, permission)))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'ACTIVE')));
  const orgWide = holders.filter((h) => h.scope === 'org').map((h) => h.id);
  const teamScoped = new Set(holders.filter((h) => h.scope === 'team').map((h) => h.id));
  const workerTeams = (await tx.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.membershipId, workerMembershipId))).map((t) => t.teamId);
  const managers = workerTeams.length
    ? (await tx.select({ id: teamMembers.membershipId }).from(teamMembers).where(and(inArray(teamMembers.teamId, workerTeams), eq(teamMembers.role, 'MANAGER')))).map((m) => m.id).filter((id) => teamScoped.has(id))
    : [];
  return [...new Set([...orgWide, ...managers])].filter((id) => id !== workerMembershipId);
}

export async function membersWith(tx: Tx, organizationId: string, permission: Permission): Promise<string[]> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, memberships.roleId), eq(rolePermissions.permission, permission), eq(rolePermissions.scope, 'org')))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'ACTIVE')));
  return rows.map((r) => r.id);
}
