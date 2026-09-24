'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronsUpDown, LogOut, Menu as MenuIcon, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sun, UserRound, X } from 'lucide-react';
import type { MeDto, NotificationDto } from '@tallywork/contracts';
import { Avatar, IconButton, Logo, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, cx, fmtRelative } from '@tallywork/ui';
import { api, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { filterNav } from './nav';
import { TimerBar } from './timer-bar';

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
    <div className="flex min-h-dvh">
      {/* Desktop / tablet sidebar */}
      <aside className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col bg-nav text-nav-fg transition-[width] duration-150 md:flex', collapsed ? 'w-16' : 'w-60')} aria-label="Primary">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-nav text-nav-fg shadow-overlay">
            <Sidebar collapsed={false} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-4">
          <IconButton label="Open navigation" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon className="size-4" />
          </IconButton>
          <div className="min-w-0 flex-1">{org.can('tracking:track') && org.membership.tracking_enabled && <TimerBar />}</div>
          {org.organization.is_demo && <span className="hidden rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warning lg:inline">Demo data</span>}
          <Notifications />
          <UserMenu />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ collapsed, onToggle, onClose }: { collapsed: boolean; onToggle?: () => void; onClose?: () => void }) {
  const org = useOrg();
  const pathname = usePathname();
  const groups = filterNav(org.can, org.grants, org.isManagerView);
  const isActive = (href: string) => {
    const full = `${org.base}${href}`;
    if (href === '') return pathname === org.base;
    if (href === '/timesheets') return pathname === full;
    return pathname === full || pathname.startsWith(`${full}/`);
  };
  return (
    <>
      <div className={cx('flex h-14 shrink-0 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'gap-2 px-3')}>
        <OrgSwitcher collapsed={collapsed} />
        {onClose && (
          <button className="ml-auto rounded-sm p-1.5 text-nav-muted hover:bg-nav-active hover:text-nav-fg" onClick={onClose} aria-label="Close navigation">
            <X className="size-4" />
          </button>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g, gi) => (
          <div key={g.label ?? gi} className="mb-3">
            {g.label && !collapsed && <div className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-nav-muted/80">{g.label}</div>}
            {g.label && collapsed && gi > 0 && <div className="mx-3 mb-2 h-px bg-white/10" />}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((i) => {
                const active = isActive(i.href);
                const Icon = i.icon;
                return (
                  <li key={i.href + i.label}>
                    <Link
                      href={`${org.base}${i.href}`}
                      title={collapsed ? i.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'relative flex h-8 items-center gap-2.5 rounded-sm text-sm transition-colors',
                        collapsed ? 'justify-center px-0' : 'px-2.5',
                        active ? 'bg-nav-active font-semibold text-white' : 'text-nav-muted hover:bg-white/5 hover:text-nav-fg',
                      )}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[#8a8df0]" aria-hidden />}
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{i.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {onToggle && (
        <button onClick={onToggle} className={cx('flex h-10 shrink-0 items-center gap-2 border-t border-white/10 text-xs text-nav-muted hover:text-nav-fg', collapsed ? 'justify-center' : 'px-4')} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && 'Collapse'}
        </button>
      )}
    </>
  );
}

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const org = useOrg();
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  return (
    <Menu
      align="start"
      trigger={
        <button className={cx('flex min-w-0 items-center gap-2 rounded-sm py-1 text-left hover:bg-white/5', collapsed ? 'px-1' : 'flex-1 px-1.5')} aria-label="Switch organization">
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
      <MenuLabel>Organizations</MenuLabel>
      {me?.organizations.map((o) => (
        <MenuItem key={o.id} onSelect={() => router.push(`/o/${o.id}`)} icon={o.id === org.organization.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}>
          <span className="truncate">{o.name}</span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => router.push('/welcome')}>
        New organization
      </MenuItem>
    </Menu>
  );
}

function Notifications() {
  const org = useOrg();
  const qc = useQueryClient();
  const { data } = useOrgQuery<{ data: NotificationDto[]; unread: number }>('/notifications', { refetchInterval: 30_000 });
  const markAll = async () => {
    await api(`/orgs/${org.organization.id}/notifications/read`, { body: { ids: 'all' } });
    void qc.invalidateQueries({ queryKey: ['org', org.organization.id, '/notifications'] });
  };
  return (
    <Popover
      align="end"
      className="w-[min(380px,calc(100vw-24px))] p-0"
      trigger={
        <button className="relative inline-flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-muted hover:text-text" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
          <Bell className="size-4" />
          {!!data?.unread && <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">Notifications</span>
        {!!data?.unread && (
          <button onClick={markAll} className="text-xs font-medium text-interactive hover:underline">
            Mark all read
          </button>
        )}
      </div>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto">
        {!data?.data.length && <li className="px-4 py-8 text-center text-sm text-text-muted">You are all caught up.</li>}
        {data?.data.map((n) => (
          <li key={n.id}>
            <Link href={n.link ? `${org.base}${n.link}` : org.base} className={cx('flex gap-3 px-4 py-3 hover:bg-surface-muted', !n.read_at && 'bg-interactive-soft/40')}>
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
      const t = (localStorage.getItem('tw.theme') as 'light' | 'dark' | null) ?? 'system';
      setTheme(t);
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    try {
      if (t === 'system') localStorage.removeItem('tw.theme');
      else localStorage.setItem('tw.theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };
  return (
    <div className="flex gap-1 px-2 py-1.5" role="radiogroup" aria-label="Theme">
      {(
        [
          ['light', Sun],
          ['dark', Moon],
          ['system', Monitor],
        ] as const
      ).map(([t, Icon]) => (
        <button key={t} role="radio" aria-checked={theme === t} onClick={() => apply(t)} className={cx('flex flex-1 items-center justify-center rounded-sm py-1', theme === t ? 'bg-surface-muted text-text' : 'text-text-muted hover:text-text')} aria-label={`${t} theme`}>
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
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
        <button className="flex items-center gap-2 rounded-sm p-1 hover:bg-surface-muted" aria-label="Account menu">
          <Avatar name={name || '?'} size={28} />
        </button>
      }
    >
      <div className="px-2 py-1.5">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-xs text-text-muted">{me?.user.email}</div>
      </div>
      <MenuSeparator />
      <MenuItem icon={<UserRound className="size-3.5" />} onSelect={() => router.push(`${org.base}/me/profile`)}>
        Profile & devices
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
        Sign out
      </MenuItem>
    </Menu>
  );
}
