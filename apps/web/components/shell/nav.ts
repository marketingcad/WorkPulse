import type { Permission, Scope } from '@tallywork/domain';
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  Clock,
  CreditCard,
  Eye,
  FileText,
  FolderKanban,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Laptop,
  ListChecks,
  PiggyBank,
  Radio,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Timer,
  UserCheck,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string; // relative to /o/:orgId
  icon: LucideIcon;
  /** shown when the actor holds any of these (optionally at a minimum scope) */
  perms?: Permission[];
  minScope?: Scope | 'team_or_org';
  /** worker-facing label override */
  workerLabel?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** One navigation config; role-specific menus are produced by permission filtering. */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Overview', workerLabel: 'Today', href: '', icon: LayoutDashboard },
      { label: 'My timesheet', href: '/timesheets', icon: Clock, perms: ['timesheets:submit'], minScope: 'own' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Members', href: '/workers', icon: Users, perms: ['members:read'], minScope: 'team_or_org' },
      { label: 'Teams', href: '/teams', icon: UsersRound, perms: ['teams:manage'] },
      { label: 'Clients', href: '/clients', icon: Building2, perms: ['clients:manage'] },
      { label: 'Projects', href: '/projects', icon: FolderKanban, perms: ['projects:read'] },
      { label: 'Tasks', href: '/tasks', icon: CheckSquare, perms: ['tasks:read'] },
    ],
  },
  {
    label: 'Tracking',
    items: [
      { label: 'Live', href: '/tracking/live', icon: Radio, perms: ['tracking:read'], minScope: 'team_or_org' },
      { label: 'Activity', workerLabel: 'My activity', href: '/activity', icon: Activity, perms: ['activity:read'] },
      { label: 'Sessions', href: '/sessions', icon: Timer, perms: ['tracking:read'] },
      { label: 'Devices', href: '/devices', icon: Laptop, perms: ['devices:read'] },
    ],
  },
  {
    label: 'Timesheets',
    items: [
      { label: 'View & edit', href: '/timesheets/team', icon: CalendarDays, perms: ['timesheets:read'], minScope: 'team_or_org' },
      { label: 'Approvals', href: '/timesheets/approvals', icon: ClipboardCheck, perms: ['timesheets:approve'] },
      { label: 'Manual time', href: '/timesheets/manual', icon: ListChecks, perms: ['manual_time:request', 'manual_time:approve'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Attendance', href: '/attendance', icon: UserCheck, perms: ['attendance:read'], minScope: 'team_or_org' },
      { label: 'Schedules', workerLabel: 'My schedule', href: '/schedules', icon: CalendarClock, perms: ['schedules:read'] },
      { label: 'Time off', href: '/time-off', icon: CalendarOff, perms: ['time_off:read'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Billing & rates', href: '/finance/billing', icon: BadgeDollarSign, perms: ['rates:read', 'billing:read'] },
      { label: 'Budgets', href: '/finance/budgets', icon: PiggyBank, perms: ['budgets:read'] },
      { label: 'Expenses', href: '/finance/expenses', icon: Receipt, perms: ['expenses:read'] },
      { label: 'Invoices', href: '/finance/invoices', icon: FileText, perms: ['invoices:read'] },
      { label: 'Payments', href: '/finance/payments', icon: CreditCard, perms: ['payments:read'] },
    ],
  },
  {
    label: 'Insights',
    items: [{ label: 'Reports', href: '/reports', icon: BarChart3, perms: ['reports:read'] }],
  },
  {
    label: 'Developer',
    items: [
      { label: 'API keys', href: '/developer/api-keys', icon: KeyRound, perms: ['api_keys:manage'] },
      { label: 'Webhooks', href: '/developer/webhooks', icon: Webhook, perms: ['webhooks:manage'] },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Organization', href: '/settings', icon: Settings, perms: ['org:update'] },
      { label: 'Tracking policies', href: '/settings/policies', icon: SlidersHorizontal, perms: ['policies:manage'] },
      { label: 'Roles & permissions', href: '/settings/roles', icon: Shield, perms: ['roles:manage'] },
      { label: 'Security & retention', href: '/settings/security', icon: Gauge, perms: ['retention:manage', 'settings:security'] },
      { label: 'Audit log', href: '/settings/audit', icon: ScrollText, perms: ['audit:read'] },
      { label: 'What is monitored', href: '/me/monitoring', icon: Eye },
    ],
  },
];

export function filterNav(can: (p: Permission, s?: Scope) => boolean, grants: Partial<Record<Permission, Scope>>, isManagerView: boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => {
        if (!i.perms) return true;
        return i.perms.some((p) => {
          if (!can(p)) return false;
          if (i.minScope === 'team_or_org') return grants[p] === 'team' || grants[p] === 'org';
          if (i.minScope === 'own') return true;
          return true;
        });
      })
      // Hide the worker's "My timesheet" shortcut for managers who have the team view.
      .filter((i) => !(i.href === '/timesheets' && isManagerView && false))
      .map((i) => (!isManagerView && i.workerLabel ? { ...i, label: i.workerLabel } : i)),
  })).filter((g) => g.items.length > 0);
}
