import { inArray, sql, type SQL } from 'drizzle-orm';
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
