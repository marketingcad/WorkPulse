/**
 * Permission catalogue, scopes and built-in role presets.
 * Roles are stored as data (role_permissions rows); these presets seed every new org.
 * See docs/plan/05-security-api.md §11.
 */

export const SCOPES = ['own', 'assigned', 'team', 'org'] as const;
export type Scope = (typeof SCOPES)[number];

export const PERMISSIONS = [
  'org:read',
  'org:update',
  'roles:manage',
  'members:read',
  'members:manage',
  'members:read_pay_rate',
  'teams:read',
  'teams:manage',
  'clients:read',
  'clients:manage',
  'projects:read',
  'projects:manage',
  'tasks:read',
  'tasks:create',
  'tasks:manage',
  'policies:read',
  'policies:manage',
  'devices:read',
  'devices:manage',
  'tracking:track',
  'tracking:read',
  'tracking:force_stop',
  'activity:read',
  'screenshots:read',
  'screenshots:delete',
  'apps:read',
  'time:read',
  'time:edit',
  'manual_time:request',
  'manual_time:approve',
  'timesheets:read',
  'timesheets:submit',
  'timesheets:approve',
  'attendance:read',
  'schedules:read',
  'schedules:manage',
  'time_off:read',
  'time_off:request',
  'time_off:approve',
  'time_off:manage',
  'rates:read',
  'rates:manage',
  'billing:read',
  'budgets:read',
  'budgets:manage',
  'expenses:read',
  'expenses:create',
  'expenses:approve',
  'invoices:read',
  'invoices:manage',
  'payments:read',
  'payments:manage',
  'payroll:read',
  'payroll:manage',
  'reports:read',
  'reports:finance',
  'api_keys:manage',
  'webhooks:manage',
  'audit:read',
  'settings:security',
  'retention:manage',
  'agent:ingest',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions that only make sense for the whole organization. Payroll runs, pay stubs and bank
 * details are not narrowed to a team or to assigned work, so these are granted at org scope or not at all.
 */
export const ORG_ONLY_PERMISSIONS: readonly Permission[] = ['payroll:read', 'payroll:manage'];

export const BUILTIN_ROLES = ['SYSTEM_ADMIN', 'TEAM_MANAGER', 'WORKER', 'AGENT'] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

export type Grants = Partial<Record<Permission, Scope>>;

const all = (scope: Scope): Grants =>
  Object.fromEntries(PERMISSIONS.filter((p) => p !== 'agent:ingest').map((p) => [p, scope])) as Grants;

export const ROLE_PRESETS: Record<BuiltinRole, Grants> = {
  SYSTEM_ADMIN: { ...all('org'), 'tracking:track': 'own', 'timesheets:submit': 'own', 'manual_time:request': 'own', 'time_off:request': 'own', 'expenses:create': 'own' },
  TEAM_MANAGER: {
    'org:read': 'org',
    'members:read': 'team',
    'teams:read': 'team',
    'clients:read': 'assigned',
    'projects:read': 'assigned',
    'tasks:read': 'assigned',
    'tasks:create': 'assigned',
    'tasks:manage': 'assigned',
    'policies:read': 'team',
    'devices:read': 'team',
    'tracking:track': 'own',
    'tracking:read': 'team',
    'tracking:force_stop': 'team',
    'activity:read': 'team',
    'screenshots:read': 'team',
    'apps:read': 'team',
    'time:read': 'team',
    'time:edit': 'team',
    'manual_time:request': 'own',
    'manual_time:approve': 'team',
    'timesheets:read': 'team',
    'timesheets:submit': 'own',
    'timesheets:approve': 'team',
    'attendance:read': 'team',
    'schedules:read': 'team',
    'schedules:manage': 'team',
    'time_off:read': 'team',
    'time_off:request': 'own',
    'time_off:approve': 'team',
    'budgets:read': 'assigned',
    'expenses:read': 'team',
    'expenses:create': 'own',
    'expenses:approve': 'team',
    'reports:read': 'team',
  },
  WORKER: {
    'org:read': 'org',
    'members:read': 'own',
    'teams:read': 'own',
    'clients:read': 'assigned',
    'projects:read': 'assigned',
    'tasks:read': 'assigned',
    'policies:read': 'own',
    'devices:read': 'own',
    'devices:manage': 'own',
    'tracking:track': 'own',
    'tracking:read': 'own',
    'activity:read': 'own',
    'screenshots:read': 'own',
    'screenshots:delete': 'own',
    'apps:read': 'own',
    'time:read': 'own',
    'time:edit': 'own',
    'manual_time:request': 'own',
    'timesheets:read': 'own',
    'timesheets:submit': 'own',
    'attendance:read': 'own',
    'schedules:read': 'own',
    'time_off:read': 'own',
    'time_off:request': 'own',
    'expenses:read': 'own',
    'expenses:create': 'own',
    'reports:read': 'own',
  },
  AGENT: {
    'agent:ingest': 'own',
    'tracking:track': 'own',
    'projects:read': 'assigned',
    'tasks:read': 'assigned',
    'policies:read': 'own',
  },
};

export function scopeFor(grants: Grants, permission: Permission): Scope | null {
  return grants[permission] ?? null;
}

/**
 * Desktop-only members (workers) see nothing beyond their own and assigned work; they use Tallywork
 * through the desktop app, and the web workspace is for people who oversee others (team or org scope).
 * Decided from grants rather than the role key so custom worker-like roles are covered too.
 * `org:read` is ignored: every member can read their organization.
 */
export function isDesktopOnly(grants: Grants): boolean {
  return !Object.entries(grants).some(([p, s]) => p !== 'org:read' && (s === 'team' || s === 'org'));
}

/** Coarse check: does the actor hold `permission` at any scope? */
export function hasPermission(grants: Grants, permission: Permission): boolean {
  return grants[permission] !== undefined;
}

/** Intersect two grant sets, keeping the narrower scope ('assigned' vs 'team' → 'own'). */
export function intersectGrants(a: Grants, b: Grants): Grants {
  const out: Grants = {};
  for (const p of PERMISSIONS) {
    const x = a[p];
    const y = b[p];
    if (!x || !y) continue;
    if (x === y) out[p] = x;
    else if (x === 'org') out[p] = y;
    else if (y === 'org') out[p] = x;
    else if (x === 'own' || y === 'own') out[p] = 'own';
    else out[p] = 'own';
  }
  return out;
}

/**
 * Subject context a check is made against. The service layer loads team and project
 * memberships so this stays pure.
 */
export interface SubjectContext {
  /** membership the resource belongs to (worker-owned resources) */
  ownerMembershipId?: string | null;
  /** project the resource belongs to (project-owned resources) */
  projectId?: string | null;
}

export interface ActorContext {
  membershipId: string;
  grants: Grants;
  /** membership ids of workers in teams the actor manages */
  managedMembershipIds: ReadonlySet<string>;
  /** project ids the actor is assigned to (directly or through a team) */
  assignedProjectIds: ReadonlySet<string>;
}

/** Resource-level check: is `actor` allowed `permission` on this subject? */
export function can(actor: ActorContext, permission: Permission, subject: SubjectContext = {}): boolean {
  const scope = actor.grants[permission];
  if (!scope) return false;
  switch (scope) {
    case 'org':
      return true;
    case 'team':
      if (subject.ownerMembershipId === undefined) return true; // collection-level check
      return (
        subject.ownerMembershipId === actor.membershipId ||
        (subject.ownerMembershipId !== null && actor.managedMembershipIds.has(subject.ownerMembershipId))
      );
    case 'assigned':
      if (subject.projectId === undefined) return true;
      return subject.projectId !== null && actor.assignedProjectIds.has(subject.projectId);
    case 'own':
      if (subject.ownerMembershipId === undefined) return true;
      return subject.ownerMembershipId === actor.membershipId;
  }
}

/**
 * For list queries: which worker memberships may the actor see for `permission`?
 * Returns 'all' for org scope, or the explicit set.
 */
export function visibleMembershipIds(actor: ActorContext, permission: Permission): 'all' | Set<string> | null {
  const scope = actor.grants[permission];
  if (!scope) return null;
  if (scope === 'org') return 'all';
  if (scope === 'team') return new Set([actor.membershipId, ...actor.managedMembershipIds]);
  return new Set([actor.membershipId]);
}

/** API key scopes and the permission each one maps to (intersected with creator's grants). */
export const API_KEY_SCOPES = {
  'read:workers': 'members:read',
  'read:teams': 'teams:read',
  'read:clients': 'clients:read',
  'read:projects': 'projects:read',
  'read:tasks': 'tasks:read',
  'read:timesheets': 'timesheets:read',
  'read:time': 'time:read',
  'read:activity': 'activity:read',
  'read:reports': 'reports:read',
  'read:billing': 'billing:read',
  'read:invoices': 'invoices:read',
  'write:projects': 'projects:manage',
  'write:tasks': 'tasks:manage',
  'write:clients': 'clients:manage',
} as const satisfies Record<string, Permission>;
export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

/**
 * The built-in role × permission matrix as Markdown (docs/security/authorization-matrix.md is
 * generated from this; a test fails when the two differ). Cells show the scope a role holds.
 */
export function authorizationMatrixMarkdown(): string {
  const roles = BUILTIN_ROLES;
  const head = `| Permission | ${roles.join(' | ')} |\n|---|${roles.map(() => '---').join('|')}|`;
  const rows = PERMISSIONS.map((p) => `| \`${p}\` | ${roles.map((r) => ROLE_PRESETS[r][p] ?? '—').join(' | ')} |`);
  const keys = Object.entries(API_KEY_SCOPES).map(([k, p]) => `| \`${k}\` | \`${p}\` |`);
  return [
    '# Authorization matrix',
    '',
    '<!-- Generated from packages/domain/src/permissions.ts by `pnpm --filter @tallywork/domain gen:matrix`. Do not edit by hand. -->',
    '',
    'Scopes: `own` = the member themselves, `assigned` = projects they are assigned to, `team` = members of teams they manage, `org` = the whole organization. `—` = not granted.',
    'Custom roles can grant any subset, but never more than the admin who creates them holds.',
    '',
    '## Built-in roles',
    '',
    head,
    ...rows,
    '',
    '## API key scopes',
    '',
    'A key acts as its creator, limited to the permissions below (and to the endpoints listed in docs/api/README.md).',
    '',
    '| Scope | Permission |',
    '|---|---|',
    ...keys,
    '',
  ].join('\n');
}
