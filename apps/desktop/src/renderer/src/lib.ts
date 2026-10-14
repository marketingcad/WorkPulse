import { useEffect, useRef, useState } from 'react';
import type { AgentState, MeResource } from '../../shared/ipc';

export const bridge = window.tallywork;

/** The one card style used across pages. */
export const card = 'rounded-md border border-border bg-surface';

/** Pages of the worker app (navigation order), plus the manual-time sub-screen reached from them. */
export type Page = 'home' | 'tracking' | 'projects' | 'tasks' | 'timesheet' | 'activity' | 'reports' | 'timeoff' | 'schedule' | 'paystubs' | 'settings';
export type View = Page | 'manual';

const VIEWS: readonly View[] = ['home', 'tracking', 'projects', 'tasks', 'timesheet', 'activity', 'reports', 'timeoff', 'schedule', 'paystubs', 'settings', 'manual'];
export const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v);

/**
 * The app page for a notification's link. Links are organization paths (e.g. "/timesheets?date=…");
 * workers use the desktop app only, so they open here, never in the browser. Null when no page fits.
 */
export function viewForLink(link: string): View | null {
  const path = link.split('?')[0]!.replace(/^\/+/, '');
  if (path === '') return 'home';
  if (path.startsWith('timesheets/manual')) return 'tracking';
  if (path.startsWith('timesheets')) return 'timesheet';
  if (path.startsWith('attendance/time-off') || path.startsWith('time-off')) return 'timeoff';
  if (path.startsWith('pay-stubs')) return 'paystubs';
  const top: Record<string, View> = { tasks: 'tasks', projects: 'projects', activity: 'activity', reports: 'reports', schedules: 'schedule' };
  return top[path.split('/')[0]!] ?? null;
}

/** A date as the worker's calendar day, e.g. "Mon, Sep 22". `date` is YYYY-MM-DD. */
export function fmtDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], opts);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDateInput(d);
}

/** Monday-based start of the week containing `date` (the API aligns periods to the org's week start). */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return addDays(date, -((d.getDay() + 6) % 7));
}

/**
 * Load one of the worker's own-data resources through the main process.
 * Keeps the last good data when a refresh fails (e.g. offline) and reports the error.
 */
export function useMe<T>(resource: MeResource, params: { from?: string; to?: string; date?: string } = {}, opts: { refreshMs?: number; deps?: unknown[] } = {}) {
  const key = JSON.stringify([resource, params]);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const lastKey = useRef(key);
  useEffect(() => {
    let alive = true;
    // A different resource/range must not show the previous one's data.
    const fresh = lastKey.current !== key;
    lastKey.current = key;
    setState((s) => ({ data: fresh ? null : s.data, error: null, loading: true }));
    bridge
      .me<T>(resource, params)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState((s) => ({ data: s.data, error: errorText(e, 'Could not load'), loading: false })));
    const t = opts.refreshMs ? setTimeout(() => setTick((n) => n + 1), opts.refreshMs) : null;
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...(opts.deps ?? [])]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtHm(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function fmtRange(fromIso: string, toIso: string): string {
  const d = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${d(fromIso)} – ${d(toIso)}`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function localDateInput(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Message from a failed bridge call, without Electron's "Error invoking remote method…" prefix. */
export function errorText(e: unknown, fallback = 'Action failed'): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : fallback;
}

export function useAgentState(): AgentState | null {
  const [s, setS] = useState<AgentState | null>(null);
  useEffect(() => {
    void bridge.getState().then(setS);
    return bridge.onState(setS);
  }, []);
  return s;
}

/** Re-render every second while `active` (for running clocks). */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
