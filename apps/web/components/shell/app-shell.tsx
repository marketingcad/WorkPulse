'use client';
import { Suspense, lazy, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronRight, ChevronsUpDown, Clock, Eye, LogOut, Menu as MenuIcon, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sun, UserRound, Wallet, X } from 'lucide-react';
import type { MeDto, NotificationDto } from '@tallywork/contracts';
import { IconButton, Logo, Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, Popover, cx, fmtRelative } from '@tallywork/ui';
import { api, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { activeNav, filterNav, subnavGroups, type NavItem, type NavTab } from './nav';
import { SectionTabs } from './section-tabs';
import { TourProvider } from '@/components/help/tour';
import { HelpReturnBar } from '@/components/help/help-return';
import { TimerBar } from './timer-bar';
import { HelpLink } from '@/components/help/help-link';
import { CalculatorLauncher } from '@/components/calculator/calculator-launcher';
import { MyAvatar } from '@/lib/avatars';

// Opened from the organization switcher only, so not part of every page.
const NewOrgDialog = lazy(() => import('./new-org-dialog').then((m) => ({ default: m.NewOrgDialog })));
// Fetched only when the assistant is on for this person, after the page loads, so it adds nothing
// to every page's first-load JavaScript (apps/web/scripts/check-bundle-budget.mjs).
const AssistantLauncher = lazy(() => import('@/components/assistant/assistant-launcher').then((m) => ({ default: m.AssistantLauncher })));

/**
 * The phone navigation drawer, as a modal dialog (audit QA-04): focus moves in and stays in while it
 * is open, Escape closes it, and focus goes back to the menu button afterwards.
 */
function MobileNav({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  // The latest onClose, without re-running the effect (which would move focus again) on every render.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const inside = panel.current?.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button className="absolute inset-0 bg-black/40" aria-label={t('nav.close')} tabIndex={-1} onClick={onClose} />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        className="absolute inset-y-0 left-0 flex w-72 flex-col bg-nav bg-[radial-gradient(130%_55%_at_0%_100%,rgba(23,102,255,0.20),transparent_65%),radial-gradient(90%_35%_at_100%_0%,rgba(109,76,245,0.12),transparent_70%)] text-nav-fg shadow-overlay"
      >
        <Sidebar collapsed={false} onClose={onClose} />
      </aside>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const org = useOrg();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('tw.nav.collapsed') === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('tw.nav.collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <TourProvider>
      <div className="flex min-h-dvh">
        {/* Desktop / tablet sidebar */}
        <aside className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col bg-nav bg-[radial-gradient(130%_55%_at_0%_100%,rgba(23,102,255,0.20),transparent_65%),radial-gradient(90%_35%_at_100%_0%,rgba(109,76,245,0.12),transparent_70%)] text-nav-fg transition-[width] duration-150 md:flex', collapsed ? 'w-16' : 'w-60')} aria-label={t('nav.primary')}>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </aside>
        {/* Mobile drawer */}
        {mobileOpen && <MobileNav onClose={() => setMobileOpen(false)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 shadow-[0_1px_2px_rgb(15_23_42/0.03)] backdrop-blur supports-[backdrop-filter]:bg-surface/75 sm:px-4">
            <IconButton label={t('nav.open')} className="md:hidden" onClick={() => setMobileOpen(true)} data-tour="nav-menu">
              <MenuIcon className="size-4" />
            </IconButton>
            <div className="min-w-0 flex-1">{org.can('tracking:track') && org.membership.tracking_enabled && <TimerBar />}</div>
            {org.organization.is_demo && <span className="hidden rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warning lg:inline">{t('shell.demoData')}</span>}
            <PageHelp />
            <Notifications />
            <UserMenu />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6">
            <HelpReturnBar />
            <SectionTabs />
            {children}
          </main>
        </div>
      </div>
      <CalculatorLauncher />
      {org.assistant_enabled && (
        <Suspense fallback={null}>
          <AssistantLauncher />
        </Suspense>
      )}
    </TourProvider>
  );
}

const NAV_GROUPS_KEY = 'tw.nav.groups';

/**
 * Accordion motion shared by every sidebar dropdown: grid-rows 0fr ↔ 1fr animates to the content's
 * natural height, the content fades and slides in, and the chevron turns. Off for reduced motion.
 */
const ACCORDION_EASE = 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';
const accordionPanel = (open: boolean) =>
  cx('grid transition-[grid-template-rows,opacity]', ACCORDION_EASE, open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0');
const accordionContent = (open: boolean) => cx('transition-transform', ACCORDION_EASE, open ? 'translate-y-0' : '-translate-y-2');
const accordionChevron = (open: boolean) => cx('size-3.5 shrink-0 transition-transform', ACCORDION_EASE, open && 'rotate-90');

function Sidebar({ collapsed, onToggle, onClose }: { collapsed: boolean; onToggle?: () => void; onClose?: () => void }) {
  const org = useOrg();
  const pathname = usePathname();
  const groups = filterNav(org.can, org.grants, org.isManagerView);
  // The item the current page belongs to (an item with tabs is active on any of its tabs).
  const current = activeNav(groups, pathname.slice(org.base.length))?.item ?? null;
  const isActive = (href: string) => current?.href === href;

  // Labelled groups are collapsible sections. The group holding the current page is always
  // opened; the rest remember what the user chose (per browser).
  const idPrefix = useId();
  const activeGroup = groups.find((g) => g.label && g.items.some((i) => isActive(i.href)))?.label ?? null;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (activeGroup ? { [activeGroup]: true } : {}));
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) ?? '{}') as Record<string, boolean>;
      setOpen((o) => ({ ...stored, ...o }));
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o[activeGroup] ? o : { ...o, [activeGroup]: true }));
  }, [activeGroup]);
  const toggleGroup = (label: string) =>
    setOpen((o) => {
      const next = { ...o, [label]: !(o[label] ?? true) };
      try {
        localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const renderItems = (items: NavItem[]) => (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => {
        const active = isActive(i.href);
        const Icon = i.icon;
        const sub = subnavGroups(i);
        if (sub) return <SidebarSubnav key={i.href + i.label} item={i} groups={sub} active={active} collapsed={collapsed} />;
        return (
          <li key={i.href + i.label}>
            <Link
              data-tour={i.label}
              href={`${org.base}${i.href}`}
              title={collapsed ? t(i.label) : undefined}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'relative flex h-9 items-center gap-2.5 rounded-sm text-sm transition-colors',
                collapsed ? 'justify-center px-0' : 'px-2.5',
                active ? 'bg-[#1766ff]/20 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(59,130,255,0.28)]' : 'text-nav-muted hover:bg-white/[0.06] hover:text-nav-fg',
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[#3b82ff]" aria-hidden />}
              <Icon className={cx('size-4 shrink-0', active && 'text-[#6ea2ff]')} aria-hidden />
              {!collapsed && <span className="truncate">{t(i.label)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className={cx('flex h-14 shrink-0 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'gap-2 px-3')}>
        <OrgSwitcher collapsed={collapsed} />
        {onClose && (
          <button className="ml-auto rounded-sm p-1.5 text-nav-muted hover:bg-nav-active hover:text-nav-fg" onClick={onClose} aria-label={t('nav.close')}>
            <X className="size-4" />
          </button>
        )}
      </div>
      <nav className="scrollbar-nav flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g, gi) => {
          // Unlabelled group (Overview) and the icon-only rail: plain list, no dropdown.
          if (!g.label || collapsed) {
            return (
              <div key={g.label ?? gi} className="mb-3">
                {gi > 0 && <div className="mx-3 mb-2 h-px bg-white/10" />}
                {renderItems(g.items)}
              </div>
            );
          }
          // Open unless the person closed it (the audit found new admins facing five closed groups).
          const isOpen = open[g.label] ?? true;
          const panelId = `${idPrefix}-nav-${gi}`;
          return (
            <div key={g.label} className="mb-1">
              <button
                type="button"
                data-tour={g.label}
                onClick={() => toggleGroup(g.label!)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cx(
                  'flex h-7 w-full items-center gap-1 rounded-sm px-2.5 text-2xs font-semibold uppercase tracking-wider transition-colors',
                  isOpen ? 'text-nav-fg/90' : 'text-nav-muted',
                  'hover:bg-white/5 hover:text-nav-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3b82ff]',
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="truncate">{t(g.label)}</span>
                  {g.badge && ' '}
                  {g.badge && <span className="rounded-full bg-[#4d8dff]/22 px-1.5 text-[10px] leading-4 tracking-wide text-[#a9c6ff]">{t(g.badge)}</span>}
                </span>
                <ChevronRight className={accordionChevron(isOpen)} aria-hidden />
              </button>
              <div id={panelId} inert={!isOpen} className={accordionPanel(isOpen)}>
                <div className="min-h-0 overflow-hidden">
                  <div className={cx('pb-2 pt-0.5', accordionContent(isOpen))}>{renderItems(g.items)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
      {onToggle && (
        <button onClick={onToggle} className={cx('flex h-10 shrink-0 items-center gap-2 border-t border-white/10 text-xs text-nav-muted hover:text-nav-fg', collapsed ? 'justify-center' : 'px-4')} aria-label={collapsed ? t('nav.expand') : t('nav.collapseLabel')}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && t('nav.collapse')}
        </button>
      )}
    </>
  );
}

const SUBNAV_KEY = 'tw.nav.subnav';

/**
 * An item whose pages are grouped by topic (Settings), as a dropdown in the sidebar: the row opens
 * and closes the list of its pages, each a link to its own address. Open on any of its pages;
 * elsewhere it remembers what the person chose (per browser). On the icon-only rail, a flyout menu.
 */
function SidebarSubnav({ item, groups, active, collapsed }: { item: NavItem; groups: { group: string; tabs: NavTab[] }[]; active: boolean; collapsed: boolean }) {
  const org = useOrg();
  const router = useRouter();
  const pathname = usePathname();
  const path = pathname.slice(org.base.length);
  const panelId = useId();
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) {
      setOpen(true);
      return;
    }
    try {
      setOpen((JSON.parse(localStorage.getItem(SUBNAV_KEY) ?? '{}') as Record<string, boolean>)[item.label] ?? false);
    } catch {
      /* storage unavailable */
    }
  }, [active, item.label]);
  const toggle = () =>
    setOpen((o) => {
      try {
        const stored = JSON.parse(localStorage.getItem(SUBNAV_KEY) ?? '{}') as Record<string, boolean>;
        localStorage.setItem(SUBNAV_KEY, JSON.stringify({ ...stored, [item.label]: !o }));
      } catch {
        /* ignore */
      }
      return !o;
    });
  const Icon = item.icon;
  const label = t(item.label);
  const rowClass = (on: boolean) =>
    cx(
      'relative flex h-9 w-full items-center gap-2.5 rounded-sm text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3b82ff]',
      collapsed ? 'justify-center px-0' : 'px-2.5',
      on ? 'bg-[#1766ff]/20 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(59,130,255,0.28)]' : 'text-nav-muted hover:bg-white/[0.06] hover:text-nav-fg',
    );

  if (collapsed) {
    return (
      <li>
        <Menu
          align="start"
          trigger={
            <button type="button" data-tour={item.label} title={label} aria-label={label} className={rowClass(active)}>
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[#3b82ff]" aria-hidden />}
              <Icon className={cx('size-4 shrink-0', active && 'text-[#6ea2ff]')} aria-hidden />
            </button>
          }
        >
          {groups.map((g, gi) => (
            <div key={g.group}>
              {gi > 0 && <MenuSeparator />}
              {g.group && <MenuLabel>{t(g.group)}</MenuLabel>}
              {g.tabs.map((tab) => (
                <MenuItem key={tab.href} onSelect={() => router.push(`${org.base}${tab.href}`)} icon={tab.href === path ? <Check className="size-3.5" aria-hidden /> : <span className="size-3.5" aria-hidden />}>
                  {t(tab.label)}
                </MenuItem>
              ))}
            </div>
          ))}
        </Menu>
      </li>
    );
  }

  return (
    <li>
      <button type="button" data-tour={item.label} onClick={toggle} aria-expanded={open} aria-controls={panelId} className={rowClass(active && !open)}>
        {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[#3b82ff]" aria-hidden />}
        <Icon className={cx('size-4 shrink-0', active && 'text-[#6ea2ff]')} aria-hidden />
        <span className={cx('flex-1 truncate text-left', active && 'font-semibold text-white')}>{label}</span>
        <ChevronRight className={accordionChevron(open)} aria-hidden />
      </button>
      <div id={panelId} inert={!open} className={accordionPanel(open)}>
        <div className="min-h-0 overflow-hidden">
          <nav aria-label={label} className={cx('ml-[1.1rem] mt-0.5 flex flex-col gap-2 border-l border-white/10 pb-1 pl-2.5 pt-1', accordionContent(open))}>
            {groups.map((g) => (
              <div key={g.group} role="group" aria-label={g.group ? t(g.group) : label}>
                {g.group && (
                  <span className="block px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-nav-fg/90" aria-hidden>
                    {t(g.group)}
                  </span>
                )}
                <ul className="flex flex-col gap-0.5">
                  {g.tabs.map((tab) => {
                    const current = tab.href === path;
                    return (
                      <li key={tab.href}>
                        <Link
                          href={`${org.base}${tab.href}`}
                          aria-current={current ? 'page' : undefined}
                          className={cx(
                            'flex h-7 items-center rounded-sm px-2 text-[13px] transition-colors',
                            current ? 'bg-[#1766ff]/20 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(59,130,255,0.28)]' : 'text-nav-muted hover:bg-white/[0.06] hover:text-nav-fg',
                          )}
                        >
                          <span className="truncate">{t(tab.label)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </li>
  );
}

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const org = useOrg();
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Menu
        align="start"
        trigger={
          <button className={cx('flex min-w-0 items-center gap-2 rounded-sm py-1 text-left hover:bg-white/5', collapsed ? 'px-1' : 'flex-1 px-1.5')} aria-label={t('shell.switchOrg')}>
            <Logo size={26} className="shrink-0 text-white" />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{org.organization.name}</span>
                  <span className="block truncate text-2xs text-nav-muted">{org.membership.role_name}</span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-nav-muted" />
              </>
            )}
          </button>
        }
      >
        <MenuLabel>{t('shell.organizations')}</MenuLabel>
        {me?.organizations.map((o) => (
          <MenuItem key={o.id} onSelect={() => router.push(`/o/${o.id}`)} icon={o.id === org.organization.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}>
            <span className="truncate">{o.name}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => setCreating(true)}>
          {t('shell.newOrg')}
        </MenuItem>
      </Menu>
      {creating && (
        <Suspense fallback={null}>
          <NewOrgDialog open onOpenChange={setCreating} />
        </Suspense>
      )}
    </>
  );
}

type GuideFor = (typeof import('@/components/help/page-help'))['guideFor'];

/**
 * "Help" to this page's guide, in the same place on every page that has one (phones included).
 * The guides are loaded after the page shows, so every page does not carry the whole Help Center
 * in its first load (the bundle budget).
 */
function PageHelp() {
  const org = useOrg();
  const path = usePathname().slice(org.base.length);
  const [guideFor, setGuideFor] = useState<GuideFor | null>(null);
  useEffect(() => {
    let live = true;
    void import('@/components/help/page-help').then((m) => live && setGuideFor(() => m.guideFor));
    return () => {
      live = false;
    };
  }, []);
  const guide = !guideFor || path === '/help' ? null : guideFor(path, org.can);
  return guide ? <HelpLink article={guide.id} /> : null;
}

function Notifications() {
  const org = useOrg();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useOrgQuery<{ data: NotificationDto[]; unread: number }>('/notifications', { refetchInterval: 30_000 });
  const markAll = async () => {
    await api(`/orgs/${org.organization.id}/notifications/read`, { body: { ids: 'all' } });
    void qc.invalidateQueries({ queryKey: ['org', org.organization.id, '/notifications'] });
  };
  const markOne = (n: NotificationDto) => {
    if (n.read_at) return;
    void api(`/orgs/${org.organization.id}/notifications/read`, { body: { ids: [n.id] } })
      .then(() => qc.invalidateQueries({ queryKey: ['org', org.organization.id, '/notifications'] }))
      .catch(() => undefined);
  };
  return (
    <Popover
      align="end"
      className="w-[min(380px,calc(100vw-24px))] p-0"
      trigger={
        <button data-tour="notifications" className="relative inline-flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-muted hover:text-text" aria-label={data?.unread ? t('shell.notificationsUnread', { count: data.unread }) : t('shell.notifications')}>
          <Bell className="size-4" />
          {!!data?.unread && <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-on-accent">{data.unread > 9 ? '9+' : data.unread}</span>}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">{t('shell.notifications')}</span>
        {!!data?.unread && (
          <button onClick={markAll} className="text-xs font-medium text-interactive hover:underline">
            {t('shell.markAllRead')}
          </button>
        )}
      </div>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto">
        {isLoading && <li className="px-4 py-8 text-center text-sm text-text-muted">{t('shell.notificationsLoading')}</li>}
        {isError && !data && <li className="px-4 py-8 text-center text-sm text-danger">{t('shell.notificationsError')}</li>}
        {data && !data.data.length && <li className="px-4 py-8 text-center text-sm text-text-muted">{t('shell.allCaughtUp')}</li>}
        {data?.data.map((n) => (
          <li key={n.id}>
            <Link href={n.link ? `${org.base}${n.link}` : org.base} onClick={() => markOne(n)} className={cx('flex gap-3 px-4 py-3 hover:bg-surface-muted', !n.read_at && 'bg-interactive-soft/40')}>
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-interactive')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{n.title}</span>
                {n.body && <span className="block truncate text-xs text-text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-2xs text-text-faint">{fmtRelative(n.created_at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  useEffect(() => {
    try {
      const saved = (localStorage.getItem('tw.theme') as 'light' | 'dark' | null) ?? 'system';
      setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (mode: 'system' | 'light' | 'dark') => {
    setTheme(mode);
    try {
      if (mode === 'system') localStorage.removeItem('tw.theme');
      else localStorage.setItem('tw.theme', mode);
    } catch {
      /* ignore */
    }
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
  };
  // Menu radio items, so arrow keys reach the theme like the other entries (they used to skip it).
  return (
    <>
      <MenuSeparator />
      <MenuLabel>{t('shell.theme')}</MenuLabel>
      <MenuRadioGroup row value={theme} onValueChange={(v) => apply(v as 'system' | 'light' | 'dark')} label={t('shell.theme')}>
        {(
          [
            ['light', Sun],
            ['dark', Moon],
            ['system', Monitor],
          ] as const
        ).map(([mode, Icon]) => (
          <MenuRadioItem key={mode} value={mode} keepOpen label={t(`shell.theme.${mode}`)}>
            <Icon className="size-3.5" aria-hidden />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

function UserMenu() {
  const org = useOrg();
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const name = me?.user.name ?? '';
  return (
    <Menu
      trigger={
        <button data-tour="account-menu" className="flex items-center gap-2 rounded-sm p-1 hover:bg-surface-muted" aria-label={t('shell.accountMenu')}>
          <MyAvatar size={28} />
        </button>
      }
    >
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <MyAvatar size={36} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-text-muted">{me?.user.email}</div>
        </div>
      </div>
      <MenuSeparator />
      <MenuItem icon={<UserRound className="size-3.5" />} onSelect={() => router.push(`${org.base}/me/profile`)}>
        {t('shell.profileDevices')}
      </MenuItem>
      {/* Personal pages: the person's own records, kept out of the admin sidebar. */}
      {/* The same gate as the page (R10): reading your own timesheet. */}
      {org.can('timesheets:read') && (
        <>
          <MenuItem icon={<Clock className="size-3.5" />} onSelect={() => router.push(`${org.base}/timesheets`)}>
            {t('nav.item.myTimesheet')}
          </MenuItem>
          <MenuItem icon={<Wallet className="size-3.5" />} onSelect={() => router.push(`${org.base}/pay-stubs`)}>
            {t('nav.item.myPayStubs')}
          </MenuItem>
        </>
      )}
      <MenuItem icon={<Eye className="size-3.5" />} onSelect={() => router.push(`${org.base}/me/monitoring`)}>
        {t('nav.item.whatIsMonitored')}
      </MenuItem>
      <ThemeSwitch />
      <MenuSeparator />
      <MenuItem
        icon={<LogOut className="size-3.5" />}
        onSelect={async () => {
          await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
          window.location.href = '/login';
        }}
      >
        {t('shell.signOut')}
      </MenuItem>
    </Menu>
  );
}
