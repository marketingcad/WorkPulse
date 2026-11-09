import type { Grants, Permission, Scope } from '../permissions';

/** Who may open a page; mirrors the Gate in apps/web/components/shell/nav.ts. */
export type NavGate = { perms?: Permission[]; minScope?: Scope | 'team_or_org' };

export type NavTargetKey =
  | 'dashboard' | 'tracking.live' | 'sessions' | 'activity' | 'timesheets.all' | 'timesheets.approvals'
  | 'timesheets.team' | 'timesheets.not_added' | 'workers' | 'teams' | 'schedules' | 'attendance'
  | 'time_off' | 'clients' | 'projects' | 'tasks' | 'finance.budgets' | 'finance.expenses' | 'finance.invoices'
  | 'finance.payroll' | 'reports' | 'insights' | 'performance' | 'settings' | 'settings.time' | 'settings.policies'
  | 'settings.roles' | 'devices' | 'settings.security' | 'help' | 'ai.insights';

/**
 * The only dashboard pages the assistant may link to. Paths are relative to /o/<orgId> and copy
 * the matching NAV items and tabs in apps/web/components/shell/nav.ts (a web test checks parity).
 */
export const NAV_TARGETS: Record<NavTargetKey, { path: string; label: string } & NavGate> = {
  dashboard: { path: '', label: 'Overview' },
  'tracking.live': { path: '/tracking/live', label: 'Live', perms: ['tracking:read'], minScope: 'team_or_org' },
  sessions: { path: '/sessions', label: 'Session history', perms: ['tracking:read'], minScope: 'team_or_org' },
  activity: { path: '/activity', label: 'Activity', perms: ['activity:read'] },
  'timesheets.all': { path: '/timesheets/all', label: 'Time entries', perms: ['time:read'], minScope: 'team_or_org' },
  'timesheets.approvals': { path: '/timesheets/approvals', label: 'Approvals', perms: ['timesheets:approve', 'manual_time:request', 'manual_time:approve'] },
  'timesheets.team': { path: '/timesheets/team', label: 'Team week', perms: ['timesheets:read'], minScope: 'team_or_org' },
  'timesheets.not_added': { path: '/timesheets/not-added', label: 'Time not added', perms: ['tracking:read'], minScope: 'team_or_org' },
  workers: { path: '/workers', label: 'Members', perms: ['members:read'], minScope: 'team_or_org' },
  teams: { path: '/teams', label: 'Teams', perms: ['teams:read'], minScope: 'team_or_org' },
  schedules: { path: '/schedules', label: 'Schedules', perms: ['schedules:read'] },
  attendance: { path: '/attendance', label: 'Attendance', perms: ['attendance:read'], minScope: 'team_or_org' },
  time_off: { path: '/time-off', label: 'Time off', perms: ['time_off:read'] },
  clients: { path: '/clients', label: 'Clients', perms: ['clients:read'] },
  projects: { path: '/projects', label: 'Projects', perms: ['projects:read'] },
  tasks: { path: '/tasks', label: 'Tasks', perms: ['tasks:read'] },
  'finance.budgets': { path: '/finance/budgets', label: 'Budgets', perms: ['budgets:read'] },
  'finance.expenses': { path: '/finance/expenses', label: 'Expenses', perms: ['expenses:read'] },
  'finance.invoices': { path: '/finance/invoices', label: 'Invoices', perms: ['invoices:read'] },
  'finance.payroll': { path: '/finance/payroll', label: 'Payroll', perms: ['payroll:read', 'billing:read', 'rates:read'] },
  reports: { path: '/reports', label: 'Reports', perms: ['reports:read'] },
  insights: { path: '/insights', label: 'Summary', perms: ['time:read'], minScope: 'team_or_org' },
  performance: { path: '/performance', label: 'Performance', perms: ['performance:read'], minScope: 'team_or_org' },
  settings: { path: '/settings', label: 'Organization settings', perms: ['org:update'] },
  'settings.time': { path: '/settings/time', label: 'Time and pay settings', perms: ['org:update'] },
  'settings.policies': { path: '/settings/policies', label: 'Tracking policies', perms: ['policies:read'], minScope: 'team_or_org' },
  'settings.roles': { path: '/settings/roles', label: 'Roles', perms: ['roles:manage'] },
  devices: { path: '/devices', label: 'Devices', perms: ['devices:read'] },
  'settings.security': { path: '/settings/security', label: 'Security', perms: ['retention:manage', 'settings:security'] },
  help: { path: '/help', label: 'Help' },
  'ai.insights': { path: '/ai-insights', label: 'AI Insights', perms: ['org:read'], minScope: 'team_or_org' },
};

export const NAV_TARGET_KEYS = Object.keys(NAV_TARGETS) as NavTargetKey[];

/** Same rule as allowed() in the web nav: any listed permission, at team or org scope when required. */
export function gateAllows(grants: Grants, gate: NavGate): boolean {
  if (!gate.perms) return true;
  return gate.perms.some((p) => {
    const s = grants[p];
    if (s === undefined) return false;
    return gate.minScope !== 'team_or_org' || s === 'team' || s === 'org';
  });
}

/** Resolve an exact allowlist key to a link, or null when unknown or not permitted. */
export function resolveNav(grants: Grants, orgId: string, key: string): { key: NavTargetKey; label: string; href: string } | null {
  if (typeof key !== 'string' || !Object.hasOwn(NAV_TARGETS, key)) return null;
  const k = key as NavTargetKey;
  const t = NAV_TARGETS[k];
  if (!gateAllows(grants, t)) return null;
  return { key: k, label: t.label, href: `/o/${orgId}${t.path}` };
}

const ROUTE = /^\/o\/[^/?#]+(\/[^?#]*)?(?:[?#].*)?$/;

/** The allowlisted page a dashboard route belongs to (longest path prefix), or null. */
export function sectionFor(route: string): NavTargetKey | null {
  const m = typeof route === 'string' ? ROUTE.exec(route) : null;
  if (!m) return null;
  const path = (m[1] ?? '').replace(/\/+$/, '');
  if (path === '') return 'dashboard';
  let best: NavTargetKey | null = null;
  let len = 0;
  for (const k of NAV_TARGET_KEYS) {
    const p = NAV_TARGETS[k].path;
    if (p === '') continue;
    if ((path === p || path.startsWith(`${p}/`)) && p.length > len) {
      best = k;
      len = p.length;
    }
  }
  return best;
}
