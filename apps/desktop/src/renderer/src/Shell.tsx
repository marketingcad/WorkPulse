import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, BarChart3, Bell, CalendarClock, CalendarDays, CalendarOff, Camera, CameraOff, CheckSquare, ChevronDown, Clock, CloudOff, ExternalLink, Eye, FolderKanban, Home, LogOut, Menu, RefreshCw, Settings, UserRound, X } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { bridge, fmtTime, initials, useMe, useTick, type Page, type View } from './lib';
import type { NotificationsDto } from './types';

const NAV: Array<{ v: Page; label: string; icon: ReactNode }> = [
  { v: 'home', label: 'Home', icon: <Home className="size-4" /> },
  { v: 'tracking', label: 'Time Tracking', icon: <Clock className="size-4" /> },
  { v: 'projects', label: 'Projects', icon: <FolderKanban className="size-4" /> },
  { v: 'tasks', label: 'Tasks', icon: <CheckSquare className="size-4" /> },
  { v: 'timesheet', label: 'Timesheet', icon: <CalendarDays className="size-4" /> },
  { v: 'activity', label: 'Activity', icon: <Activity className="size-4" /> },
  { v: 'reports', label: 'Reports', icon: <BarChart3 className="size-4" /> },
  { v: 'timeoff', label: 'Time Off', icon: <CalendarOff className="size-4" /> },
  { v: 'schedule', label: 'Schedule', icon: <CalendarClock className="size-4" /> },
  { v: 'settings', label: 'Settings', icon: <Settings className="size-4" /> },
];

/** The nav item a sub-screen belongs to (highlighted while it is open). */
const SECTION: Record<View, Page> = {
  home: 'home',
  tracking: 'tracking',
  projects: 'projects',
  tasks: 'tasks',
  timesheet: 'timesheet',
  activity: 'activity',
  reports: 'reports',
  timeoff: 'timeoff',
  schedule: 'schedule',
  settings: 'settings',
  manual: 'tracking',
  monitoring: 'settings',
};

function NavList({ view, go, onPick }: { view: View; go: (v: View) => void; onPick?: () => void }) {
  const active = SECTION[view];
  return (
    <>
      {NAV.map((i) => (
        <button
          key={i.v}
          onClick={() => {
            go(i.v);
            onPick?.();
          }}
          aria-current={active === i.v ? 'page' : undefined}
          className={`relative flex h-9 w-full shrink-0 items-center gap-2.5 rounded-sm px-2.5 text-left text-sm transition-colors ${active === i.v ? 'bg-nav-active font-semibold text-white' : 'text-nav-muted hover:bg-white/5 hover:text-nav-fg'}`}
        >
          {active === i.v && <span className="absolute inset-y-1.5 left-0 w-0.75 rounded-r-full bg-[#8a8df0]" aria-hidden />}
          {i.icon}
          {i.label}
        </button>
      ))}
    </>
  );
}

/**
 * App frame. Top: online, sync, screenshot status, notifications, profile.
 * Navigation: a side rail from 1024px; below that, a drawer behind the menu button.
 */
export function Shell({ s, view, go, children }: { s: AgentState; view: View; go: (v: View) => void; children: ReactNode }) {
  const now = useTick(true);
  const [drawer, setDrawer] = useState(false);
  const synced = s.sync.lastSyncAt ? Math.max(0, Math.round((now - Date.parse(s.sync.lastSyncAt)) / 60_000)) : null;
  const p = s.policy;
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-nav px-2 text-nav-fg md:gap-3 md:px-4">
        <button onClick={() => setDrawer(true)} aria-label="Open navigation" className="rounded-sm p-1.5 text-nav-muted hover:bg-white/10 hover:text-nav-fg lg:hidden">
          <Menu className="size-4" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{s.account!.organization}</div>
        <span className={`inline-flex items-center gap-1.5 text-xs ${s.sync.online ? 'text-nav-muted' : 'text-[#e3a33b]'}`} title={s.sync.online ? 'Connected' : 'Offline: your time is saved on this computer and syncs when you are back online'}>
          {s.sync.online ? <span className="size-1.5 rounded-full bg-[#3fb27f]" /> : <CloudOff className="size-3.5" />}
          <span className="hidden sm:inline">{s.sync.online ? 'Online' : 'Offline'}</span>
        </span>
        <span className="hidden items-center gap-1.5 text-xs text-nav-muted md:inline-flex" title={s.sync.lastSyncAt ? `Last synced ${fmtTime(s.sync.lastSyncAt)}` : undefined}>
          <RefreshCw className={`size-3.5 ${s.sync.queued > 0 && s.sync.online ? 'animate-spin' : ''}`} />
          {s.sync.queued > 0 ? (s.sync.online ? 'Syncing…' : `${s.sync.queued} saved`) : synced === null ? 'Not synced yet' : synced < 1 ? 'Synced just now' : `Synced ${synced}m ago`}
        </span>
        {p && (
          <button onClick={() => go('monitoring')} className="hidden items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-nav-muted hover:bg-white/10 hover:text-nav-fg sm:inline-flex" title="What is monitored">
            {p.screenshots.enabled ? <Camera className="size-3.5" /> : <CameraOff className="size-3.5" />}
            <span className="hidden md:inline">Screenshots {p.screenshots.enabled ? 'on' : 'off'}</span>
          </button>
        )}
        <Notifications s={s} />
        <ProfileMenu s={s} go={go} />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Primary" className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav px-2 py-3 text-nav-fg lg:flex">
          <NavList view={view} go={go} />
          <button onClick={() => void bridge.openWeb('/')} className="mt-auto flex h-9 shrink-0 items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-nav-muted hover:bg-white/5 hover:text-nav-fg">
            <ExternalLink className="size-4" /> Open web app
          </button>
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-64 flex-col gap-0.5 overflow-y-auto bg-nav px-2 py-3 text-nav-fg shadow-overlay">
            <div className="mb-2 flex items-center justify-between px-2.5">
              <span className="truncate text-sm font-semibold">{s.account!.name}</span>
              <button onClick={() => setDrawer(false)} aria-label="Close navigation" className="rounded-sm p-1 text-nav-muted hover:bg-white/10">
                <X className="size-4" />
              </button>
            </div>
            <NavList view={view} go={go} onPick={() => setDrawer(false)} />
          </nav>
        </div>
      )}
    </div>
  );
}

/** Popover state that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Notifications({ s }: { s: AgentState }) {
  const pop = usePopover();
  const q = useMe<NotificationsDto>('notifications', {}, { refreshMs: 60_000, deps: [s.sync.online] });
  const unread = q.data?.unread ?? 0;
  const markAll = async () => {
    await bridge.readNotifications('all').catch(() => undefined);
    q.reload();
  };
  const open = (n: NotificationsDto['data'][number]) => {
    if (!n.read_at) void bridge.readNotifications([n.id]).then(q.reload, () => undefined);
    if (n.link) void bridge.openWeb(`/o/${s.account!.organizationId}${n.link.startsWith('/') ? n.link : `/${n.link}`}`);
  };
  return (
    <div ref={pop.ref} className="relative">
      <button onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative rounded-sm p-1.5 text-nav-muted hover:bg-white/10 hover:text-nav-fg">
        <Bell className="size-4" />
        {unread > 0 && <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {pop.open && (
        <div className="absolute right-0 top-10 z-30 w-[min(360px,calc(100vw-16px))] overflow-hidden rounded-md border border-border bg-surface text-text shadow-overlay">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={() => void markAll()} className="text-xs font-medium text-interactive hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {q.error && !q.data && <li className="px-4 py-6 text-center text-sm text-warning">{q.error}</li>}
            {q.data && !q.data.data.length && <li className="px-4 py-8 text-center text-sm text-text-muted">You are all caught up.</li>}
            {q.data?.data.map((n) => (
              <li key={n.id}>
                <button onClick={() => open(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-muted ${n.read_at ? '' : 'bg-interactive-soft/40'}`}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-interactive'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="block text-xs text-text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-2xs text-text-faint">{new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const pop = usePopover();
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted';
  const pick = (fn: () => void) => () => {
    pop.setOpen(false);
    fn();
  };
  return (
    <div ref={pop.ref} className="relative">
      <button onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open} aria-haspopup="menu" aria-label="Profile" className="flex items-center gap-2 rounded-sm p-1 hover:bg-white/10 md:pr-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-interactive text-2xs font-semibold text-on-accent">{initials(s.account!.name)}</span>
        <span className="hidden max-w-36 truncate text-sm md:inline">{s.account!.name}</span>
        <ChevronDown className="hidden size-3.5 text-nav-muted md:block" />
      </button>
      {pop.open && (
        <div className="absolute right-0 top-10 z-30 w-60 overflow-hidden rounded-md border border-border bg-surface py-1 text-text shadow-overlay" role="menu">
          <div className="border-b border-border px-3 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold">{s.account!.name}</div>
            <div className="truncate text-xs text-text-muted">{s.account!.email}</div>
            <div className="truncate text-2xs text-text-faint">{s.account!.organization}</div>
          </div>
          <button role="menuitem" className={item} onClick={pick(() => go('monitoring'))}>
            <Eye className="size-4 text-text-muted" /> What is monitored
          </button>
          <button role="menuitem" className={item} onClick={pick(() => go('settings'))}>
            <Settings className="size-4 text-text-muted" /> Settings
          </button>
          <button role="menuitem" className={item} onClick={pick(() => void bridge.openWeb(`/o/${s.account!.organizationId}/me/profile`))}>
            <UserRound className="size-4 text-text-muted" /> Profile on the web <ExternalLink className="ml-auto size-3 text-text-faint" />
          </button>
          <div className="my-1 border-t border-border" />
          <button role="menuitem" className={`${item} text-danger`} onClick={pick(() => void bridge.logout())}>
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
