import { and, eq, inArray } from 'drizzle-orm';
import { memberships, roles, teamMembers, teams, users, workerProfiles, type Tx } from '@tallywork/db';
import { localDate, visibleMembershipIds, type Permission } from '@tallywork/domain';
import type { Ctx } from './ctx';

/**
 * Who may see or act on which people and teams in the Performance Center. Same model as the rest of
 * the API: org scope covers everyone, team scope the members (and teams) the actor manages, own scope
 * only the actor. Checked on the server for every subject, never only in the UI.
 */

export const orgToday = (x: Pick<Ctx, 'org' | 'deps'>) => localDate(x.deps.now(), x.org.timezone);

/** Teams the actor is a manager of. */
export async function managedTeamIds(x: Ctx): Promise<Set<string>> {
  const rows = await x.tx.select({ id: teamMembers.teamId }).from(teamMembers).where(and(eq(teamMembers.membershipId, x.actor.membershipId), eq(teamMembers.role, 'MANAGER')));
  return new Set(rows.map((r) => r.id));
}

/** Teams the actor belongs to (as a member or a manager). */
export async function ownTeamIds(x: Ctx): Promise<Set<string>> {
  const rows = await x.tx.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.membershipId, x.actor.membershipId));
  return new Set(rows.map((r) => r.id));
}

/** May the actor see this team's data under `perm`? Org scope: any team; team scope: teams they manage; own: teams they are in. */
export async function canSeeTeam(x: Ctx, perm: Permission, teamId: string): Promise<boolean> {
  const scope = x.actor.grants[perm];
  if (!scope) return false;
  if (scope === 'org') return true;
  if (scope === 'team') return (await managedTeamIds(x)).has(teamId);
  return (await ownTeamIds(x)).has(teamId);
}

/** May the actor act on this team under `perm` (org scope, or team scope over a team they manage)? */
export async function canActOnTeam(x: Ctx, perm: Permission, teamId: string): Promise<boolean> {
  const scope = x.actor.grants[perm];
  if (scope === 'org') return true;
  return scope === 'team' && (await managedTeamIds(x)).has(teamId);
}

/** Teams visible to the actor under `perm`: 'all' or a set of ids. */
export async function visibleTeamIds(x: Ctx, perm: Permission): Promise<'all' | Set<string>> {
  const scope = x.actor.grants[perm];
  if (!scope) return new Set();
  if (scope === 'org') return 'all';
  return scope === 'team' ? managedTeamIds(x) : ownTeamIds(x);
}

export interface MemberInfo {
  id: string;
  name: string;
  title: string | null;
  role: string;
  /** the comparison group people are ranked in: their job title, else their role */
  rankGroup: string;
}

/** Active members of the organization, with what ranking needs. */
export async function activeMembers(tx: Tx, ids?: string[]): Promise<MemberInfo[]> {
  if (ids && !ids.length) return [];
  const rows = await tx
    .select({ id: memberships.id, name: users.name, title: workerProfiles.title, role: roles.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(ids ? and(eq(memberships.status, 'ACTIVE'), inArray(memberships.id, ids)) : eq(memberships.status, 'ACTIVE'));
  return rows.map((r) => ({ ...r, rankGroup: (r.title?.trim() || r.role).toLowerCase() }));
}

/** Active members the actor may see under `perm`. */
export async function visibleActiveMembers(x: Ctx, perm: Permission): Promise<MemberInfo[]> {
  const v = visibleMembershipIds(x.actor, perm);
  if (!v) return [];
  return activeMembers(x.tx, v === 'all' ? undefined : [...v]);
}

/** Members of each team (active teams only). */
export async function teamRoster(tx: Tx, teamIds?: string[]): Promise<Map<string, { name: string; members: string[]; managers: string[] }>> {
  const ts = await tx.select({ id: teams.id, name: teams.name, archivedAt: teams.archivedAt }).from(teams).where(teamIds ? inArray(teams.id, teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000']) : undefined);
  const live = ts.filter((t) => !t.archivedAt);
  const out = new Map(live.map((t) => [t.id, { name: t.name, members: [] as string[], managers: [] as string[] }]));
  if (!live.length) return out;
  const rows = await tx
    .select({ teamId: teamMembers.teamId, m: teamMembers.membershipId, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(memberships, eq(memberships.id, teamMembers.membershipId))
    .where(and(inArray(teamMembers.teamId, live.map((t) => t.id)), eq(memberships.status, 'ACTIVE')));
  for (const r of rows) {
    const t = out.get(r.teamId)!;
    t.members.push(r.m);
    if (r.role === 'MANAGER') t.managers.push(r.m);
  }
  return out;
}
