import { describe, expect, it } from 'vitest';
import { ROLE_PRESETS, type Grants, type Permission, type Scope } from '@tallywork/domain';
import { activeNav, filterNav, type NavGroup } from '../components/shell/nav';
import { precedenceText } from '../components/finance/rate-precedence';

/** The sidebar a person with these grants sees (same `can` as the org context). */
function navFor(grants: Grants): NavGroup[] {
  const can = (p: Permission, scope?: Scope) => {
    const g = grants[p];
    return !!g && (!scope || g === 'org' || g === scope);
  };
  const managerView = !!grants['tracking:read'] && grants['tracking:read'] !== 'own';
  return filterNav(can, grants, managerView);
}

const labels = (groups: NavGroup[]) => groups.map((g) => [g.label, g.items.map((i) => i.label)]);
const item = (groups: NavGroup[], label: string) => groups.flatMap((g) => g.items).find((i) => i.label === label);

describe('admin sidebar', () => {
  const nav = navFor(ROLE_PRESETS.SYSTEM_ADMIN);

  it('groups 36 items into 21 (with Help), with no personal items, Sessions or Developer in the tree', () => {
    expect(labels(nav)).toEqual([
      [null, ['nav.item.overview']],
      ['nav.group.time', ['nav.item.timeEntries', 'nav.item.timesheets', 'nav.item.live', 'nav.item.activity', 'nav.item.eodReports']],
      ['nav.group.people', ['nav.item.members', 'nav.item.schedulesAttendance', 'nav.item.timeOff']],
      ['nav.group.work', ['nav.item.clients', 'nav.item.projects', 'nav.item.tasks']],
      ['nav.group.money', ['nav.item.rates', 'nav.item.budgets', 'nav.item.expenses', 'nav.item.invoices', 'nav.item.payroll']],
      ['nav.group.reports', ['nav.item.summary', 'nav.item.reportLibrary']],
      [null, ['nav.item.settings', 'nav.item.help']],
    ]);
    expect(nav.flatMap((g) => g.items)).toHaveLength(21);
  });

  it('Settings holds every settings page, Devices and the Developer pages as tabs, in one place', () => {
    const settings = item(nav, 'nav.item.settings')!;
    expect(settings.href).toBe('/settings');
    expect(settings.tabs!.map((t) => t.href)).toEqual(['/settings', '/settings/time', '/settings/policies', '/devices', '/settings/roles', '/settings/access-review', '/settings/security', '/developer/api-keys', '/developer/webhooks', '/settings/audit']);
  });

  it('Timesheets carries Approvals and Team week; Members carries Teams; Schedules carries Attendance; Invoices carries Payments received', () => {
    expect(item(nav, 'nav.item.timesheets')!.tabs!.map((t) => t.href)).toEqual(['/timesheets/approvals', '/timesheets/team']);
    expect(item(nav, 'nav.item.members')!.tabs!.map((t) => t.href)).toEqual(['/workers', '/teams']);
    expect(item(nav, 'nav.item.schedulesAttendance')!.tabs!.map((t) => t.href)).toEqual(['/schedules', '/attendance']);
    expect(item(nav, 'nav.item.invoices')!.tabs!.map((t) => t.href)).toEqual(['/finance/invoices', '/finance/invoices/payments']);
  });
});

describe('who sees what', () => {
  it('someone with billing access but no payroll access still reaches what members are owed, on Payroll', () => {
    const nav = navFor({ 'org:read': 'org', 'billing:read': 'org', 'tracking:read': 'team' });
    expect(item(nav, 'nav.item.payroll')!.href).toBe('/finance/payroll');
    expect(item(nav, 'nav.item.rates')).toBeUndefined();
  });

  it('someone who only requests manual time gets Approvals (their requests), not Team week', () => {
    const nav = navFor({ 'org:read': 'org', 'manual_time:request': 'own', 'tracking:read': 'team' });
    expect(item(nav, 'nav.item.timesheets')!.tabs!.map((t) => t.href)).toEqual(['/timesheets/approvals']);
  });

  it('a team manager sees no money pages but Budgets and Expenses, and lands on Tracking policies in Settings', () => {
    const nav = navFor(ROLE_PRESETS.TEAM_MANAGER);
    const money = nav.find((g) => g.label === 'nav.group.money')!;
    expect(money.items.map((i) => i.label)).toEqual(['nav.item.budgets', 'nav.item.expenses']);
    const settings = item(nav, 'nav.item.settings')!;
    expect(settings.href).toBe('/settings/policies');
    expect(settings.tabs!.map((t) => t.href)).toEqual(['/settings/policies', '/devices']);
    expect(item(nav, 'nav.item.members')!.tabs!.map((t) => t.href)).toEqual(['/workers', '/teams']);
  });

  it('someone who only records payments is linked straight to Payments received', () => {
    const nav = navFor({ 'org:read': 'org', 'payments:read': 'org', 'tracking:read': 'team' });
    const invoices = item(nav, 'nav.item.invoices')!;
    expect(invoices.href).toBe('/finance/invoices/payments');
    expect(invoices.tabs).toHaveLength(1);
  });

  it('a page whose tabs are all refused is not in the sidebar', () => {
    const nav = navFor({ 'org:read': 'org', 'tracking:read': 'team', 'members:read': 'own', 'teams:read': 'own' });
    expect(item(nav, 'nav.item.members')).toBeUndefined();
    expect(item(nav, 'nav.item.settings')).toBeUndefined();
  });
});

describe('the highlighted page', () => {
  const nav = navFor(ROLE_PRESETS.SYSTEM_ADMIN);
  const at = (path: string) => {
    const hit = activeNav(nav, path);
    return hit && [hit.item.label, hit.tab?.href ?? null];
  };

  it('picks the most specific match, so a settings sub-page is its own tab', () => {
    expect(at('')).toEqual(['nav.item.overview', null]);
    expect(at('/settings')).toEqual(['nav.item.settings', '/settings']);
    expect(at('/settings/policies')).toEqual(['nav.item.settings', '/settings/policies']);
    expect(at('/developer/webhooks')).toEqual(['nav.item.settings', '/developer/webhooks']);
    expect(at('/teams')).toEqual(['nav.item.members', '/teams']);
    expect(at('/attendance')).toEqual(['nav.item.schedulesAttendance', '/attendance']);
    expect(at('/finance/invoices/payments')).toEqual(['nav.item.invoices', '/finance/invoices/payments']);
  });

  it('keeps the parent highlighted on detail pages, and related pages under their item', () => {
    expect(at('/workers/0190a000-0000-7000-8000-000000000001')).toEqual(['nav.item.members', '/workers']);
    expect(at('/finance/invoices/new')).toEqual(['nav.item.invoices', '/finance/invoices']);
    expect(at('/sessions')).toEqual(['nav.item.live', null]);
    expect(at('/timesheets/approvals')).toEqual(['nav.item.timesheets', '/timesheets/approvals']);
    expect(at('/timesheets/manual')).toEqual(['nav.item.timesheets', null]);
    expect(at('/settings/time')).toEqual(['nav.item.settings', '/settings/time']);
  });

  it('highlights nothing on personal pages (they are in the user menu)', () => {
    expect(at('/timesheets')).toBeNull();
    expect(at('/pay-stubs')).toBeNull();
    expect(at('/me/monitoring')).toBeNull();
  });
});

describe('rate notes on member, client and project forms', () => {
  it('say what each rate overrides, from the engine’s own order', () => {
    expect(precedenceText('PAY', 'WORKER')).toBe('Pay rate overrides project, client and organization rates; a member-on-project rate still wins.');
    expect(precedenceText('BILL', 'WORKER')).toBe('Bill rate overrides client and organization rates; member-on-project and project rates still win.');
    expect(precedenceText('PAY', 'PROJECT')).toBe('Pay rate overrides client and organization rates; member-on-project and member rates still win.');
    expect(precedenceText('BILL', 'PROJECT')).toBe('Bill rate overrides member, client and organization rates; a member-on-project rate still wins.');
    expect(precedenceText('PAY', 'CLIENT')).toBe('Pay rate overrides organization rates; member-on-project, member and project rates still win.');
  });
});
