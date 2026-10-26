import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { projects, type Tx } from '@tallywork/db';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { forbidden, visibleMembershipIds, type Permission } from '@tallywork/domain';
import type { Actor } from '../context';

/**
 * SQL filter restricting a membership-owned column to what `actor` may see for `permission`.
 * Returns undefined for org-wide scope. Throws when the actor lacks the permission.
 */
export function membershipFilter(actor: Actor, permission: Permission, column: AnyPgColumn): SQL | undefined {
  const visible = visibleMembershipIds(actor, permission);
  if (visible === null) throw forbidden();
  if (visible === 'all') return undefined;
  return inArray(column, [...visible]);
}

/**
 * May the actor use a project-level `permission` (e.g. projects:manage) on this project? The same
 * rule as projectFilter: org scope covers every project, any narrower scope only the projects the
 * actor is assigned to. (`can()` treats team and own scope without a person as "allowed", which is
 * right for person-owned data but would make a narrow project grant organization-wide.)
 */
export function canOnProject(actor: Actor, permission: Permission, projectId: string): boolean {
  const scope = actor.grants[permission];
  if (!scope) return false;
  return scope === 'org' || actor.assignedProjectIds.has(projectId);
}

/**
 * May the actor use a client-level `permission` (e.g. clients:manage) on this client? Org scope
 * covers every client; a narrower scope the clients of the projects the actor is assigned to (the
 * clients listClients shows them).
 */
export async function canOnClient(x: { actor: Actor; tx: Tx }, permission: Permission, clientId: string): Promise<boolean> {
  const scope = x.actor.grants[permission];
  if (!scope) return false;
  if (scope === 'org') return true;
  const ids = [...x.actor.assignedProjectIds];
  if (!ids.length) return false;
  const [p] = await x.tx.select({ id: projects.id }).from(projects).where(and(eq(projects.clientId, clientId), inArray(projects.id, ids))).limit(1);
  return !!p;
}

/** Restrict a project column to projects the actor may see for `permission` (assigned scope). */
export function projectFilter(actor: Actor, permission: Permission, column: AnyPgColumn): SQL | undefined {
  const scope = actor.grants[permission];
  if (!scope) throw forbidden();
  if (scope === 'org') return undefined;
  const ids = [...actor.assignedProjectIds];
  return ids.length ? inArray(column, ids) : sql`false`;
}

/** Intersect a user-requested membership list with the visible set. */
export function narrowMemberships(actor: Actor, permission: Permission, requested?: string[]): string[] | 'all' {
  const visible = visibleMembershipIds(actor, permission);
  if (visible === null) throw forbidden();
  if (!requested || requested.length === 0) return visible === 'all' ? 'all' : [...visible];
  return visible === 'all' ? requested : requested.filter((id) => visible.has(id));
}

export function canSeeMembership(actor: Actor, permission: Permission, membershipId: string): boolean {
  const visible = visibleMembershipIds(actor, permission);
  return visible === 'all' || (visible !== null && visible.has(membershipId));
}
