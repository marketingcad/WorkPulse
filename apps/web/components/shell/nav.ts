import type { Permission, Scope } from '@tallywork/domain';
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  NotebookPen,
  PieChart,
  PiggyBank,
  Radio,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** Who may open a page: any of these permissions, optionally only at team or org scope. */
interface Gate {
  perms?: Permission[];
  minScope?: Scope | 'team_or_org';
}

/** One tab of a nav item that groups several pages (e.g. Members · Teams). */
export interface NavTab extends Gate {
  /** message key */
  label: string;
  href: string; // relative to /o/:orgId
}

export interface NavItem extends Gate {
  /** message key (webEn nav.item.*); translated at render */
  label: string;
  /** relative to /o/:orgId; for an item with tabs, the first tab the person may open */
  href: string;
  icon: LucideIcon;
  /** worker-facing label override (message key) */
  workerLabel?: string;
  /** pages shown as a tab bar under this one item; the item shows when any tab is allowed */
  tabs?: NavTab[];
  /** other pages that belong to this item (it stays highlighted there), e.g. Live → Sessions */
  also?: string[];
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
    items: [{ label: 'nav.item.overview', workerLabel: 'nav.item.today', href: '', icon: LayoutDashboard }],
  },
  {
    label: 'nav.group.time',
    items: [
      { label: 'nav.item.timeEntries', href: '/timesheets/all', icon: ListChecks, perms: ['time:read'], minScope: 'team_or_org' },
      {
        label: 'nav.item.timesheets',
        href: '/timesheets/approvals',
        icon: ClipboardCheck,
        tabs: [
          // Submitted timesheets and manual time requests, each part shown by its own permission.
          { label: 'nav.item.approvals', href: '/timesheets/approvals', perms: ['timesheets:approve', 'manual_time:request', 'manual_time:approve'] },
          { label: 'nav.item.teamWeek', href: '/timesheets/team', perms: ['timesheets:read'], minScope: 'team_or_org' },
        ],
        also: ['/timesheets/manual'],
      },
      { label: 'nav.item.live', href: '/tracking/live', icon: Radio, perms: ['tracking:read'], minScope: 'team_or_org', also: ['/sessions'] },
      { label: 'nav.item.activity', workerLabel: 'nav.item.myActivity', href: '/activity', icon: Activity, perms: ['activity:read'] },
      { label: 'nav.item.eodReports', href: '/tracking/reports', icon: NotebookPen, perms: ['tracking:read'], minScope: 'team_or_org' },
    ],
  },
  {
    label: 'nav.group.people',
    items: [
      {
        label: 'nav.item.members',
        href: '/workers',
        icon: Users,
        tabs: [
          { label: 'nav.item.members', href: '/workers', perms: ['members:read'], minScope: 'team_or_org' },
          { label: 'nav.item.teams', href: '/teams', perms: ['teams:read'], minScope: 'team_or_org' },
        ],
      },
      {
        label: 'nav.item.schedulesAttendance',
        workerLabel: 'nav.item.mySchedule',
        href: '/schedules',
        icon: CalendarClock,
        tabs: [
          { label: 'nav.item.schedules', href: '/schedules', perms: ['schedules:read'] },
          { label: 'nav.item.attendance', href: '/attendance', perms: ['attendance:read'], minScope: 'team_or_org' },
        ],
      },
      { label: 'nav.item.timeOff', href: '/time-off', icon: CalendarOff, perms: ['time_off:read'] },
    ],
  },
  {
    label: 'nav.group.work',
    items: [
      { label: 'nav.item.clients', href: '/clients', icon: Building2, perms: ['clients:read'] },
      { label: 'nav.item.projects', href: '/projects', icon: FolderKanban, perms: ['projects:read'] },
      { label: 'nav.item.tasks', href: '/tasks', icon: CheckSquare, perms: ['tasks:read'] },
    ],
  },
  {
    label: 'nav.group.money',
    items: [
      { label: 'nav.item.rates', href: '/finance/billing', icon: BadgeDollarSign, perms: ['rates:read'] },
      { label: 'nav.item.budgets', href: '/finance/budgets', icon: PiggyBank, perms: ['budgets:read'] },
      { label: 'nav.item.expenses', href: '/finance/expenses', icon: Receipt, perms: ['expenses:read'] },
      {
        label: 'nav.item.invoices',
        href: '/finance/invoices',
        icon: FileText,
        tabs: [
          { label: 'nav.item.invoices', href: '/finance/invoices', perms: ['invoices:read'] },
          { label: 'nav.tab.paymentsReceived', href: '/finance/invoices/payments', perms: ['payments:read'] },
        ],
      },
      // Payroll also holds Owed (what members are owed), open to billing or rates access.
      { label: 'nav.item.payroll', href: '/finance/payroll', icon: Banknote, perms: ['payroll:read', 'billing:read', 'rates:read'] },
    ],
  },
  {
    label: 'nav.group.reports',
    items: [
      { label: 'nav.item.summary', href: '/insights', icon: PieChart, perms: ['time:read'], minScope: 'team_or_org' },
      { label: 'nav.item.reportLibrary', href: '/reports', icon: BarChart3, perms: ['reports:read'] },
    ],
  },
  {
    label: null,
    items: [
      {
        label: 'nav.item.settings',
        href: '/settings',
        icon: Settings,
        tabs: [
          { label: 'nav.item.organization', href: '/settings', perms: ['org:update'] },
          { label: 'nav.item.timePay', href: '/settings/time', perms: ['org:update'] },
          { label: 'nav.item.trackingPolicies', href: '/settings/policies', perms: ['policies:read'], minScope: 'team_or_org' },
          { label: 'nav.item.devices', href: '/devices', perms: ['devices:read'] },
          { label: 'nav.item.roles', href: '/settings/roles', perms: ['roles:manage'] },
          { label: 'nav.item.accessReview', href: '/settings/access-review', perms: ['members:manage', 'settings:security'] },
          { label: 'nav.item.security', href: '/settings/security', perms: ['retention:manage', 'settings:security'] },
          { label: 'nav.item.screenshotRetention', href: '/settings/screenshot-retention', perms: ['retention:manage', 'settings:security'] },
          { label: 'nav.item.apiKeys', href: '/developer/api-keys', perms: ['api_keys:manage'] },
          { label: 'nav.item.webhooks', href: '/developer/webhooks', perms: ['webhooks:manage'] },
          { label: 'nav.item.auditLog', href: '/settings/audit', perms: ['audit:read'] },
        ],
      },
      // The user manual and the product tour, for everyone.
      { label: 'nav.item.help', href: '/help', icon: LifeBuoy },
    ],
  },
];

type Can = (p: Permission, s?: Scope) => boolean;

function allowed(g: Gate, can: Can, grants: Partial<Record<Permission, Scope>>): boolean {
  if (!g.perms) return true;
  return g.perms.some((p) => can(p) && (g.minScope !== 'team_or_org' || grants[p] === 'team' || grants[p] === 'org'));
}

/**
 * The menu this person sees: items they may open, tabs they may open, and an item with tabs
 * links to its first allowed tab (so a manager without Organization settings lands on Devices).
 */
export function filterNav(can: Can, grants: Partial<Record<Permission, Scope>>, isManagerView: boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.flatMap((i): NavItem[] => {
      const label = !isManagerView && i.workerLabel ? i.workerLabel : i.label;
      if (!i.tabs) return allowed(i, can, grants) ? [{ ...i, label }] : [];
      const tabs = i.tabs.filter((tab) => allowed(tab, can, grants));
      return tabs.length ? [{ ...i, label, href: tabs[0]!.href, tabs }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

/** Every page an item stands for: itself, its tabs and its related pages. */
const itemHrefs = (i: NavItem) => [i.href, ...(i.tabs?.map((t) => t.href) ?? []), ...(i.also ?? [])];

/** Whether `href` (relative) is `path` (relative) or a page under it. Overview ('') matches only itself. */
const covers = (href: string, path: string) => (href === '' ? path === '' : path === href || path.startsWith(`${href}/`));

/**
 * The page a path belongs to, by the longest matching href, so /settings/policies picks the
 * Tracking policies tab over Settings › General, and /workers/123 still highlights Members.
 * Returns the matching item and, for an item with tabs, the matching tab.
 */
export function activeNav(groups: NavGroup[], path: string): { item: NavItem; tab: NavTab | null } | null {
  let best: { item: NavItem; tab: NavTab | null; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    for (const href of itemHrefs(item)) {
      if (!covers(href, path) || (best && href.length <= best.len)) continue;
      best = { item, tab: item.tabs?.find((t) => t.href === href) ?? null, len: href.length };
    }
  }
  return best && { item: best.item, tab: best.tab };
}
