import type { Context, MiddlewareHandler } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import {
  memberships,
  organizations,
  projectMembers,
  projectTeams,
  rolePermissions,
  roles,
  teamMembers,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { API_KEY_SCOPES, DomainError, forbidden, intersectGrants, isUuid, notFound, type Grants, type Permission, type Scope } from '@tallywork/domain';
import type { Actor, AppEnv, OrgInfo, Principal } from '../context';
import { unauthenticated } from './auth';

class Rollback extends Error {}

/**
 * Runs the remaining handlers inside one tenant-scoped transaction (RLS enforced).
 * If a handler fails, Hono has already rendered the error; we then roll back.
 */
export async function runInTenantTx(c: Context<AppEnv>, organizationId: string, next: () => Promise<void>): Promise<void> {
  try {
    await withTenant(c.var.deps.db, organizationId, async (tx) => {
      c.set('tx', tx);
      c.set('policyCache', new Map());
      await next();
      if (c.error || c.res.status >= 500) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

export async function loadOrg(tx: Tx, organizationId: string): Promise<OrgInfo> {
  const [o] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!o) throw notFound('organization');
  return { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, weekStart: o.weekStart, currency: o.currency, payPeriod: o.payPeriod, settings: o.settings };
}

export async function loadGrants(tx: Tx, roleId: string): Promise<Grants> {
  const rows = await tx.select({ permission: rolePermissions.permission, scope: rolePermissions.scope }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  return Object.fromEntries(rows.map((r) => [r.permission, r.scope])) as Grants;
}

/** Build the actor context: grants + team and project scope sets. */
export async function loadActor(tx: Tx, principal: Principal, organizationId: string, membershipId: string): Promise<Actor> {
  const [m] = await tx
    .select({ id: memberships.id, userId: memberships.userId, roleId: memberships.roleId, status: memberships.status, isOwner: memberships.isOwner, roleKey: roles.key })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!m || m.status !== 'ACTIVE') throw forbidden('Your membership in this organization is not active');

  let grants = await loadGrants(tx, m.roleId);
  if (principal.type === 'api_key') {
    const keyGrants: Grants = {};
    for (const s of principal.scopes) {
      const perm = API_KEY_SCOPES[s as keyof typeof API_KEY_SCOPES] as Permission | undefined;
      if (perm) keyGrants[perm] = 'org' as Scope;
    }
    // A key never exceeds the rights of the admin who created it.
    grants = intersectGrants(grants, keyGrants);
  }

  const myTeams = await tx.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.membershipId, m.id));
  const managedTeamIds = myTeams.filter((t) => t.role === 'MANAGER').map((t) => t.teamId);
  const managed = managedTeamIds.length
    ? await tx.select({ id: teamMembers.membershipId }).from(teamMembers).where(inArray(teamMembers.teamId, managedTeamIds))
    : [];
  const allTeamIds = myTeams.map((t) => t.teamId);
  const direct = await tx.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.membershipId, m.id));
  const viaTeams = allTeamIds.length ? await tx.select({ id: projectTeams.projectId }).from(projectTeams).where(inArray(projectTeams.teamId, allTeamIds)) : [];

  return {
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
}

/**
 * The endpoints each API key scope opens. A key acts as the admin who created it (intersected
 * with its scopes), so without this list a read-only key could still reach that admin's own
 * settings, notifications or dashboard. Anything not listed is closed to API keys.
 */
const API_KEY_ROUTES: Record<string, { read?: RegExp[]; write?: RegExp[] }> = {
  'read:workers': { read: [/^\/workers(\/[^/]+)?$/] },
  'read:teams': { read: [/^\/teams(\/[^/]+)?$/] },
  'read:clients': { read: [/^\/clients(\/[^/]+)?$/] },
  'read:projects': { read: [/^\/projects(\/[^/]+)?$/] },
  'read:tasks': { read: [/^\/tasks(\/[^/]+)?$/, /^\/projects\/[^/]+\/tasks$/] },
  'read:timesheets': { read: [/^\/timesheets(\/[^/]+\/history)?$/] },
  'read:time': { read: [/^\/time-entries(\/[^/]+\/revisions)?$/, /^\/sessions(\/[^/]+)?$/] },
  'read:activity': { read: [/^\/activity\/day$/, /^\/screenshots$/, /^\/(apps|urls)(\/spans)?$/, /^\/idle-events$/] },
  'read:reports': { read: [/^\/reports$/], write: [/^\/reports\/[\w-]+\/query$/] },
  'read:billing': { read: [/^\/billing\/amounts-owed$/, /^\/rates$/, /^\/budgets$/] },
  'read:invoices': { read: [/^\/invoices(\/[^/]+)?$/, /^\/payments$/] },
  'write:projects': { write: [/^\/projects(\/[^/]+(\/(archive|restore))?)?$/] },
  'write:tasks': { write: [/^\/tasks(\/[^/]+)?$/, /^\/projects\/[^/]+\/tasks$/] },
  'write:clients': { write: [/^\/clients(\/[^/]+(\/(archive|restore))?)?$/] },
};

export function apiKeyAllows(scopes: string[], method: string, path: string): boolean {
  const p = path.replace(/\/$/, '');
  const reading = method === 'GET' || method === 'HEAD';
  if (reading && p === '') return true; // organization context
  return scopes.some((s) => (reading ? API_KEY_ROUTES[s]?.read : API_KEY_ROUTES[s]?.write)?.some((re) => re.test(p)));
}

function assertApiKeyRoute(scopes: string[], method: string, path: string) {
  if (!apiKeyAllows(scopes, method, path)) throw forbidden('This API key does not have a scope for this endpoint');
}

/** `/orgs/:orgId/*` — user or API key acting inside one organization. */
export const tenant: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('actor')) return next(); // already inside a tenant transaction
  const organizationId = c.req.param('orgId');
  if (!organizationId || !isUuid(organizationId)) throw notFound('organization');
  const principal = c.var.principal;
  if (!principal) throw unauthenticated();
  if (principal.type === 'agent') throw forbidden('Device tokens cannot access organization APIs');
  if (principal.type === 'api_key' && principal.organizationId !== organizationId) throw notFound('organization');

  await runInTenantTx(c, organizationId, async () => {
    const tx = c.var.tx;
    let membershipId: string;
    if (principal.type === 'user') {
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, principal.userId), eq(memberships.organizationId, organizationId)))
        .limit(1);
      // Not a member → the org does not exist as far as this user is concerned.
      if (!m) throw notFound('organization');
      membershipId = m.id;
    } else {
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, principal.createdBy), eq(memberships.organizationId, organizationId)))
        .limit(1);
      if (!m) throw forbidden('The API key owner is no longer a member');
      membershipId = m.id;
    }
    if (principal.type === 'api_key') assertApiKeyRoute(principal.scopes, c.req.method, c.req.path.split(`/orgs/${organizationId}`)[1] ?? '');
    c.set('org', await loadOrg(tx, organizationId));
    c.set('actor', await loadActor(tx, principal, organizationId, membershipId));
    await next();
  });
};

/** Coarse permission guard for a route (resource-level checks happen in services). */
export function requirePermission(...perms: Permission[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const g = c.var.actor.grants;
    if (!perms.some((p) => g[p])) throw forbidden();
    await next();
  };
}

export function assertCan(ok: boolean, message?: string): asserts ok {
  if (!ok) throw forbidden(message);
}

export function notVisible(resource: string): DomainError {
  return notFound(resource);
}
