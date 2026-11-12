import type { Context, MiddlewareHandler } from 'hono';
import { eq, sql } from 'drizzle-orm';
import {
  memberships,
  organizations,
  rolePermissions,
  roles,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { API_KEY_SCOPES, DomainError, ORG_ONLY_PERMISSIONS, forbidden, intersectGrants, isUuid, notFound, type Grants, type Permission, type Scope } from '@tallywork/domain';
import type { Actor, AppEnv, OrgInfo, Principal } from '../context';
import { unauthenticated } from './auth';
import { clientIp, ipAllowed } from '../lib/cidr';

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

/** The organization and one membership with everything an actor is built from, as one row (see tenantRow). */
interface TenantRow {
  org_id: string;
  name: string;
  slug: string;
  timezone: string;
  week_start: number;
  currency: string;
  pay_period: OrgInfo['payPeriod'];
  settings: OrgInfo['settings'];
  m_id: string | null;
  user_id: string | null;
  status: string | null;
  is_owner: boolean | null;
  role_key: string | null;
  grants: Array<[permission: string, scope: string]>;
  teams: Array<[teamId: string, role: string]>;
  managed: string[];
  projects: string[];
}

/**
 * QA audit 11 Nov 2026, Phase 3 (BUG-02): the organization, a membership (by user or by id), its role,
 * permissions, teams, the members of the teams it manages and its projects (direct and through teams),
 * in one query. It replaces seven, each a round trip to the database on every request. Null when the
 * organization does not exist; `m_id` null when the membership does not.
 */
async function tenantRow(tx: Tx, organizationId: string, who: { userId: string } | { membershipId: string }): Promise<TenantRow | null> {
  const member = 'userId' in who ? sql`m.user_id = ${who.userId}` : sql`m.id = ${who.membershipId}`;
  const res = await tx.execute(sql`
    select o.id as org_id, o.name, o.slug, o.timezone, o.week_start, o.currency, o.pay_period, o.settings,
      m.id as m_id, m.user_id, m.status, m.is_owner, r.key as role_key,
      coalesce((select json_agg(json_build_array(rp.permission, rp.scope)) from role_permissions rp where rp.role_id = m.role_id), '[]'::json) as grants,
      coalesce((select json_agg(json_build_array(tm.team_id, tm.role)) from team_members tm where tm.membership_id = m.id), '[]'::json) as teams,
      coalesce((select json_agg(distinct tm.membership_id) from team_members tm
        where tm.team_id in (select own.team_id from team_members own where own.membership_id = m.id and own.role = 'MANAGER')), '[]'::json) as managed,
      coalesce((select json_agg(distinct p.project_id) from (
        select pm.project_id from project_members pm where pm.membership_id = m.id
        union select pt.project_id from project_teams pt where pt.team_id in (select own.team_id from team_members own where own.membership_id = m.id)
      ) p), '[]'::json) as projects
    from organizations o
    left join memberships m on m.organization_id = o.id and ${member}
    left join roles r on r.id = m.role_id
    where o.id = ${organizationId}
    limit 1`);
  return ((res as unknown as { rows: TenantRow[] }).rows[0] as TenantRow | undefined) ?? null;
}

function orgFromRow(r: TenantRow): OrgInfo {
  return { id: r.org_id, name: r.name, slug: r.slug, timezone: r.timezone, weekStart: r.week_start, currency: r.currency, payPeriod: r.pay_period, settings: r.settings };
}

/** The actor from a tenant row: the same checks and sets loadActor always made. */
function actorFromRow(principal: Principal, organizationId: string, r: TenantRow): Actor {
  if (!r.m_id || r.status !== 'ACTIVE') throw forbidden('Your membership in this organization is not active');
  let grants = Object.fromEntries(r.grants) as Grants;
  // Org-only permissions held at a narrower scope (custom roles saved before the rule) grant nothing.
  for (const p of ORG_ONLY_PERMISSIONS) if (grants[p] && grants[p] !== 'org') delete grants[p];
  if (principal.type === 'api_key') {
    const keyGrants: Grants = {};
    for (const s of principal.scopes) {
      const perm = API_KEY_SCOPES[s as keyof typeof API_KEY_SCOPES] as Permission | undefined;
      if (perm) keyGrants[perm] = 'org' as Scope;
    }
    // A key never exceeds the rights of the admin who created it.
    grants = intersectGrants(grants, keyGrants);
  }
  return {
    organizationId,
    membershipId: r.m_id,
    userId: r.user_id,
    principal,
    roleKey: r.role_key!,
    isOwner: !!r.is_owner,
    grants,
    managedTeamIds: r.teams.filter(([, role]) => role === 'MANAGER').map(([teamId]) => teamId),
    managedMembershipIds: new Set(r.managed.filter((id) => id !== r.m_id)),
    assignedProjectIds: new Set(r.projects),
  };
}

/** Build the actor context: grants + team and project scope sets. */
export async function loadActor(tx: Tx, principal: Principal, organizationId: string, membershipId: string): Promise<Actor> {
  const r = await tenantRow(tx, organizationId, { membershipId });
  if (!r) throw forbidden('Your membership in this organization is not active');
  return actorFromRow(principal, organizationId, r);
}

/**
 * The organization and the acting member, in one query. A missing organization is not found; someone
 * who is not a member gets `no_membership` (the tenant middleware turns it into its own answers).
 */
export async function loadTenant(tx: Tx, principal: Principal, organizationId: string, who: { userId: string } | { membershipId: string }): Promise<{ org: OrgInfo; actor: Actor }> {
  const r = await tenantRow(tx, organizationId, who);
  if (!r) throw notFound('organization');
  if (!r.m_id) throw new DomainError('not_found', 'no_membership', 'Not a member of this organization');
  return { org: orgFromRow(r), actor: actorFromRow(principal, organizationId, r) };
}

/**
 * The endpoints each API key scope opens. A key acts as the admin who created it (intersected
 * with its scopes), so without this list a read-only key could still reach that admin's own
 * settings, notifications or dashboard. Anything not listed is closed to API keys.
 *
 * It is exactly the table in docs/api/README.md (test/route-boundaries.test.ts reads that table and
 * compares). Ids match UUIDs only, so a named route such as /workers/options never passes as
 * /workers/:id, and writes name their method: a path alone let DELETE /clients/:id through once client
 * deletion was added, although keys were never meant to delete.
 *
 * Deliberately closed to keys (security decision, 6 Nov 2026): screenshots, app and website usage,
 * tracking sessions, pay and bill rates, budgets and payments. Monitoring data and money stay with
 * people who sign in; do not reopen them here to match a scope's name.
 */
const ID = '[0-9a-fA-F-]{36}';
const re = (s: string) => new RegExp(`^${s.replaceAll(':id', ID)}$`);
const API_KEY_ROUTES: Record<string, { read?: RegExp[]; write?: Array<[method: string, path: RegExp]> }> = {
  'read:workers': { read: [re('/workers(/:id)?')] },
  'read:teams': { read: [re('/teams')] },
  'read:clients': { read: [re('/clients')] },
  'read:projects': { read: [re('/projects(/:id)?')] },
  'read:tasks': { read: [re('/tasks'), re('/projects/:id/tasks')] },
  'read:timesheets': { read: [re('/timesheets(/:id/history)?')] },
  'read:time': { read: [re('/time-entries(/:id/revisions)?')] },
  'read:activity': { read: [re('/activity/day'), re('/idle-events')] },
  'read:reports': { read: [re('/reports')], write: [['POST', re('/reports/[\\w-]+/query')]] },
  'read:billing': { read: [re('/billing/amounts-owed')] },
  'read:invoices': { read: [re('/invoices(/:id)?')] },
  'write:projects': { write: [['POST', re('/projects')], ['PATCH', re('/projects/:id')], ['POST', re('/projects/:id/(archive|restore)')]] },
  'write:tasks': { write: [['POST', re('/projects/:id/tasks')], ['PATCH', re('/tasks/:id')], ['DELETE', re('/tasks/:id')]] },
  'write:clients': { write: [['POST', re('/clients')], ['PATCH', re('/clients/:id')], ['POST', re('/clients/:id/(archive|restore)')]] },
};

export function apiKeyAllows(scopes: string[], method: string, path: string): boolean {
  const p = path.replace(/\/$/, '');
  const reading = method === 'GET' || method === 'HEAD';
  if (reading && p === '') return true; // organization context
  return scopes.some((s) => {
    const rules = API_KEY_ROUTES[s];
    return reading ? !!rules?.read?.some((r) => r.test(p)) : !!rules?.write?.some(([m, r]) => m === method && r.test(p));
  });
}

function assertApiKeyRoute(scopes: string[], method: string, path: string) {
  if (!apiKeyAllows(scopes, method, path)) throw forbidden('This API key does not have a scope for this endpoint');
}

/** Admins are members who can change the organization or its members. */
function mfaRequiredFor(setting: string | undefined, actor: Actor): boolean {
  if (setting === 'all') return true;
  return setting === 'admins' && (actor.isOwner || !!actor.grants['org:update'] || !!actor.grants['members:manage']);
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
    // The organization and the acting member in one query (QA audit Phase 3: it was seven). The checks
    // below keep their old order, so each case still gets the same answer.
    const row = await tenantRow(tx, organizationId, { userId: principal.type === 'user' ? principal.userId : principal.createdBy });
    if (!row?.m_id) {
      // Not a member → the org does not exist as far as this user is concerned.
      if (principal.type === 'user') throw notFound('organization');
      throw forbidden('The API key owner is no longer a member');
    }
    if (principal.type === 'api_key') assertApiKeyRoute(principal.scopes, c.req.method, c.req.path.split(`/orgs/${organizationId}`)[1] ?? '');
    const org = orgFromRow(row);
    // Organization security settings apply to people and API keys (desktop agents use their own routes).
    // Required two-factor is for the web app only, by decision (audit 29 Oct 2026, AUTH-006); the
    // security settings page says so.
    if (!ipAllowed(clientIp((h) => c.req.header(h)), org.settings.ipAllowlist)) throw forbidden('Access to this organization is not allowed from your network');
    c.set('org', org);
    const actor = actorFromRow(principal, organizationId, row);
    if (principal.type === 'user' && !principal.mfaVerified && mfaRequiredFor(org.settings.enforceMfa, actor)) {
      throw new DomainError('forbidden', 'mfa_enrollment_required', 'Your organization requires two-factor authentication. Turn it on in your profile to continue.');
    }
    c.set('actor', actor);
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
