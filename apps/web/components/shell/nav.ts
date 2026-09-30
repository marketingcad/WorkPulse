import type { Permission, Scope } from '@tallywork/domain';
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  Wallet,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Eye,
  FilePlus,
  FileText,
  FolderKanban,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Laptop,
  ListChecks,
  PieChart,
  PiggyBank,
  Radio,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UserCheck,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** message key (webEn nav.item.*); translated at render */
  label: string;
  href: string; // relative to /o/:orgId
  icon: LucideIcon;
  /** shown when the actor holds any of these (optionally at a minimum scope) */
  perms?: Permission[];
  minScope?: Scope | 'team_or_org';
  /** worker-facing label override (message key) */
  workerLabel?: string;
}

export interface NavGroup {
  /** message key (webEn nav.group.*) */
  label: string | null;
  items: NavItem[];
}

/** One navigation config; role-specific menus are produced by permission filtering. */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'nav.item.overview', workerLabel: 'nav.item.today', href: '', icon: LayoutDashboard },
      { label: 'nav.item.myTimesheet', href: '/timesheets', icon: Clock, perms: ['timesheets:submit'], minScope: 'own' },
      { label: 'nav.item.payStubs', href: '/pay-stubs', icon: Wallet, perms: ['timesheets:submit'], minScope: 'own' },
    ],
  },
  {
    label: 'nav.group.workspace',
    items: [
      { label: 'nav.item.members', href: '/workers', icon: Users, perms: ['members:read'], minScope: 'team_or_org' },
      { label: 'nav.item.teams', href: '/teams', icon: UsersRound, perms: ['teams:read'], minScope: 'team_or_org' },
      { label: 'nav.item.clients', href: '/clients', icon: Building2, perms: ['clients:read'] },
      { label: 'nav.item.projects', href: '/projects', icon: FolderKanban, perms: ['projects:read'] },
      { label: 'nav.item.tasks', href: '/tasks', icon: CheckSquare, perms: ['tasks:read'] },
    ],
  },
  {
    label: 'nav.group.tracking',
    items: [
      { label: 'nav.item.live', href: '/tracking/live', icon: Radio, perms: ['tracking:read'], minScope: 'team_or_org' },
      { label: 'nav.item.activity', workerLabel: 'nav.item.myActivity', href: '/activity', icon: Activity, perms: ['activity:read'] },
      { label: 'nav.item.sessions', href: '/sessions', icon: Timer, perms: ['tracking:read'] },
      { label: 'nav.item.devices', href: '/devices', icon: Laptop, perms: ['devices:read'] },
    ],
  },
  {
    label: 'nav.group.timesheets',
    items: [
      { label: 'nav.item.allEntries', href: '/timesheets/all', icon: ListChecks, perms: ['time:read'], minScope: 'team_or_org' },
      { label: 'nav.item.viewEdit', href: '/timesheets/team', icon: CalendarDays, perms: ['timesheets:read'], minScope: 'team_or_org' },
      { label: 'nav.item.approvals', href: '/timesheets/approvals', icon: ClipboardCheck, perms: ['timesheets:approve'] },
      { label: 'nav.item.manualTime', href: '/timesheets/manual', icon: FilePlus, perms: ['manual_time:request', 'manual_time:approve'] },
    ],
  },
  {
    label: 'nav.group.people',
    items: [
      { label: 'nav.item.attendance', href: '/attendance', icon: UserCheck, perms: ['attendance:read'], minScope: 'team_or_org' },
      { label: 'nav.item.schedules', workerLabel: 'nav.item.mySchedule', href: '/schedules', icon: CalendarClock, perms: ['schedules:read'] },
      { label: 'nav.item.timeOff', href: '/time-off', icon: CalendarOff, perms: ['time_off:read'] },
    ],
  },
  {
    label: 'nav.group.finance',
    items: [
      { label: 'nav.item.billingRates', href: '/finance/billing', icon: BadgeDollarSign, perms: ['rates:read', 'billing:read'] },
      { label: 'nav.item.budgets', href: '/finance/budgets', icon: PiggyBank, perms: ['budgets:read'] },
      { label: 'nav.item.expenses', href: '/finance/expenses', icon: Receipt, perms: ['expenses:read'] },
      { label: 'nav.item.invoices', href: '/finance/invoices', icon: FileText, perms: ['invoices:read', 'payments:read'] },
      { label: 'nav.item.payroll', href: '/finance/payroll', icon: Banknote, perms: ['payroll:read'] },
    ],
  },
  {
    label: 'nav.group.insights',
    items: [
      { label: 'nav.item.insights', href: '/insights', icon: PieChart, perms: ['time:read'], minScope: 'team_or_org' },
      { label: 'nav.item.reports', href: '/reports', icon: BarChart3, perms: ['reports:read'] },
    ],
  },
  {
    label: 'nav.group.developer',
    items: [
      { label: 'nav.item.apiKeys', href: '/developer/api-keys', icon: KeyRound, perms: ['api_keys:manage'] },
      { label: 'nav.item.webhooks', href: '/developer/webhooks', icon: Webhook, perms: ['webhooks:manage'] },
    ],
  },
  {
    label: 'nav.group.settings',
    items: [
      { label: 'nav.item.organization', href: '/settings', icon: Settings, perms: ['org:update'] },
      { label: 'nav.item.trackingPolicies', href: '/settings/policies', icon: SlidersHorizontal, perms: ['policies:read'], minScope: 'team_or_org' },
      { label: 'nav.item.roles', href: '/settings/roles', icon: Shield, perms: ['roles:manage'] },
      { label: 'nav.item.security', href: '/settings/security', icon: Gauge, perms: ['retention:manage', 'settings:security'] },
      { label: 'nav.item.accessReview', href: '/settings/access-review', icon: ShieldCheck, perms: ['members:manage', 'settings:security'] },
      { label: 'nav.item.auditLog', href: '/settings/audit', icon: ScrollText, perms: ['audit:read'] },
      { label: 'nav.item.whatIsMonitored', href: '/me/monitoring', icon: Eye },
    ],
  },
];

export function filterNav(can: (p: Permission, s?: Scope) => boolean, grants: Partial<Record<Permission, Scope>>, isManagerView: boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => {
        if (!i.perms) return true;
        return i.perms.some((p) => can(p) && (i.minScope !== 'team_or_org' || grants[p] === 'team' || grants[p] === 'org'));
      })
      .map((i) => (!isManagerView && i.workerLabel ? { ...i, label: i.workerLabel } : i)),
  })).filter((g) => g.items.length > 0);
}
