import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppWindow, Camera, CameraOff, ChevronDown, ChevronRight, ClipboardCheck, ClockPlus, CloudOff, ExternalLink, Eye, Globe, NotebookPen, Pause, Play, RefreshCw, Search, Settings, Square } from 'lucide-react';
import type { AgentState, Assignment } from '../../shared/ipc';
import { bridge, card, errorText, fmtClock, fmtHm, fmtRange, fmtTime, initials, useTick, type View } from './lib';
import { CurrentSessionCard, RecentSessionsCard, TodaySummaryCard } from './HomeCards';


/**
 * The worker's home: timer, what they are working on, their own activity, and today's totals.
 * One responsive layout: a single column in a narrow window, main + side column from 768px.
 */
export function Dashboard({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const t = s.tracking;
  const now = useTick(t.state !== 'stopped' || s.sync.lastSyncAt !== null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-350 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_300px] md:gap-4 md:p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3 md:gap-4">
        <Greeting s={s} now={now} />
        {/* Primary workspace */}
        <TimerCard s={s} now={now} run={run} error={error} />
        <QuickActions s={s} go={go} />
        {/* Worker information */}
        <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
          <CurrentSessionCard s={s} now={now} />
          <RecentSessionsCard s={s} go={go} />
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-3 md:gap-4 md:pt-13">
        <TodaySummaryCard s={s} now={now} />
        <ActivityCard s={s} go={go} />
      </aside>
    </div>
  );
}

function Greeting({ s, now }: { s: AgentState; now: number }) {
  const h = new Date(now).getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="hidden md:block">
      <h1 className="text-2xl font-semibold tracking-tight">
        {part}, {s.account!.name.split(' ')[0]}
      </h1>
      <p className="text-sm text-text-muted">{new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
  );
}

// ─── Timer ───────────────────────────────────────────────────────────────────

function TimerCard({ s, now, run, error }: { s: AgentState; now: number; run: (fn: () => Promise<unknown>) => Promise<void>; error: string | null }) {
  const t = s.tracking;
  const tracking = t.state !== 'stopped';
  const elapsed = t.baseSeconds + (t.segmentStartedAt ? (now - Date.parse(t.segmentStartedAt)) / 1000 : 0);
  const [breakMenu, setBreakMenu] = useState(false);
  const currentBreak = s.breakTypes.find((b) => b.id === s.breakTypeId);
  // What Start will track: the running project, else the last one used.
  const target = tracking && t.projectId ? { projectId: t.projectId, taskId: t.taskId } : s.lastProject;
  const project = s.assignments.find((a) => a.project_id === target?.projectId);
  const task = project?.tasks.find((x) => x.id === target?.taskId);

  const status = t.state === 'active' ? { cls: 'bg-success-soft text-success', dot: 'animate-pulse bg-success', label: 'Tracking' } : t.state === 'paused' ? { cls: 'bg-warning-soft text-warning', dot: 'bg-warning', label: currentBreak ? `On break · ${currentBreak.name}` : 'Paused' } : { cls: 'bg-surface-muted text-text-muted', dot: 'bg-text-faint', label: 'Not tracking' };

  const chooseTask = (taskId: string) => {
    if (!project) return;
    const id = taskId || null;
    void run(() => (tracking ? bridge.switchTask(project.project_id, id) : bridge.start(project.project_id, id)));
  };
  // Picking a project starts (or switches) tracking on it, like clicking it in Projects.
  const chooseProject = (projectId: string) => projectId && void run(() => (tracking ? bridge.switchTask(projectId, null) : bridge.start(projectId, null)));

  return (
    <section className={`${card} p-4`} aria-label="Timer">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_150px]">
        {/* What you are working on */}
        <div className="flex min-w-0 flex-col justify-center gap-3 lg:border-r lg:border-border lg:pr-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md text-base font-semibold text-white" style={{ background: project?.color ?? 'var(--tw-text-faint)' }} aria-hidden>
              {project ? initials(project.project_name) : '—'}
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{project?.project_name ?? 'No project selected'}</div>
              <div className="truncate text-xs text-text-muted">{project ? (project.client_name ?? 'Internal') : 'Pick a project from the list to start'}</div>
            </div>
          </div>
          {s.assignments.length > 0 && (
            <label className="block">
              <span className="text-2xs text-text-muted">Current project</span>
              <select value={project?.project_id ?? ''} onChange={(e) => chooseProject(e.target.value)} className="mt-0.5 h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm focus:border-interactive focus:outline-none">
                {!project && <option value="">Choose a project…</option>}
                {s.assignments.map((a) => (
                  <option key={a.project_id} value={a.project_id}>
                    {a.project_name}
                    {a.client_name ? ` — ${a.client_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {project && project.tasks.length > 0 && (
            <label className="block">
              <span className="text-2xs text-text-muted">Current task</span>
              <select value={task?.id ?? ''} onChange={(e) => chooseTask(e.target.value)} className="mt-0.5 h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm focus:border-interactive focus:outline-none">
                <option value="">No task</option>
                {project.tasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Clock and controls */}
        <div className="flex min-w-0 flex-col items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          <div className="tabular font-mono text-[44px] font-medium leading-none tracking-tight" aria-live="off">
            {fmtClock(tracking ? elapsed : 0)}
          </div>
          <div className="tabular text-xs text-text-muted">
            Today {fmtHm(s.todaySeconds)} · Week {fmtHm(s.weekSeconds)}
          </div>
          <div className="flex w-full max-w-sm gap-2">
            {tracking ? (
              <>
                {t.state === 'active' ? (
                  <div className="relative flex flex-1">
                    <button
                      onClick={() => (s.breakTypes.length ? setBreakMenu((m) => !m) : void run(bridge.pause))}
                      aria-haspopup={s.breakTypes.length ? 'menu' : undefined}
                      aria-expanded={s.breakTypes.length ? breakMenu : undefined}
                      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-sm border border-border bg-surface text-sm font-medium hover:bg-surface-muted"
                    >
                      <Pause className="size-4" /> {s.breakTypes.length ? 'Break' : 'Pause'}
                      {s.breakTypes.length > 0 && <ChevronDown className="size-3.5 text-text-faint" />}
                    </button>
                    {breakMenu && <BreakMenu s={s} onClose={() => setBreakMenu(false)} run={run} />}
                  </div>
                ) : (
                  <button onClick={() => void run(bridge.resume)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-sm bg-interactive-soft text-sm font-semibold text-interactive hover:opacity-90">
                    <Play className="size-4" /> Resume
                  </button>
                )}
                <button onClick={() => void run(bridge.stop)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-sm bg-danger text-sm font-semibold text-on-accent hover:opacity-90">
                  <Square className="size-3.5 fill-current" /> Stop
                </button>
              </>
            ) : (
              <button
                disabled={!project}
                onClick={() => project && void run(() => bridge.start(project.project_id, task?.id ?? null))}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-50"
              >
                <Play className="size-4 fill-current" /> {project ? 'Start tracking' : 'Pick a project to start'}
              </button>
            )}
          </div>
          {error && <p className="w-full max-w-sm rounded-sm bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{error}</p>}
        </div>

        {/* At a glance */}
        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 lg:col-span-2 xl:col-span-1 xl:flex xl:flex-col xl:justify-center xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <div>
            <dt className="text-2xs text-text-muted">Activity</dt>
            <dd className="mt-1 flex items-center gap-2">
              <Ring pct={tracking ? s.activityPct : null} />
              <span className="tabular text-base font-semibold">{tracking && s.activityPct !== null ? `${s.activityPct}%` : '—'}</span>
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-text-muted">Started</dt>
            <dd className="tabular mt-1 text-base font-semibold">{tracking && t.startedAt ? fmtTime(t.startedAt) : '—'}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function BreakMenu({ s, onClose, run }: { s: AgentState; onClose: () => void; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <ul ref={ref} role="menu" className="absolute left-0 top-11 z-20 w-56 rounded-sm border border-border bg-surface py-1 shadow-overlay">
      {s.breakTypes.map((b) => (
        <li key={b.id}>
          <button role="menuitem" onClick={() => (onClose(), void run(() => bridge.takeBreak(b.id)))} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted">
            <span className="truncate">{b.name}</span>
            <span className="shrink-0 text-2xs text-text-faint">
              {b.paid ? 'paid' : 'unpaid'}
              {b.maxMinutes ? ` · ${b.maxMinutes}m` : ''}
            </span>
          </button>
        </li>
      ))}
      <li>
        <button role="menuitem" onClick={() => (onClose(), void run(bridge.pause))} className="w-full px-3 py-1.5 text-left text-sm text-text-muted hover:bg-surface-muted">
          Just pause
        </button>
      </li>
    </ul>
  );
}

/** Activity ring: a neutral indigo meter (activity is a signal, not a verdict). */
function Ring({ pct, size = 22 }: { pct: number | null; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" className="stroke-surface-sunken" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} className="stroke-interactive transition-[stroke-dasharray] duration-500" />
    </svg>
  );
}

// ─── Quick actions ───────────────────────────────────────────────────────────

function QuickActions({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const t = s.tracking;
  const [note, setNote] = useState(t.note);
  useEffect(() => setNote(t.note), [t.note, t.sessionId]);
  const org = s.account!.organizationId;
  // Narrow window: note on its own row, the two actions share the next one.
  const action = 'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-muted sm:flex-none';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {t.state !== 'stopped' && (
          <label className="relative w-full sm:w-auto sm:min-w-50 sm:flex-1">
            <span className="sr-only">Work note</span>
            <NotebookPen className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
            <input
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== t.note && void bridge.setNote(note)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="Add a note about what you are doing"
              className="h-9 w-full rounded-sm border border-border bg-surface pl-8 pr-2.5 text-sm placeholder:text-text-faint focus:border-interactive focus:outline-none"
            />
          </label>
        )}
        {s.policy?.manualTime.allowed && (
          <button onClick={() => go('manual')} className={action}>
            <ClockPlus className="size-4 text-text-muted" /> Manual time
          </button>
        )}
        <button onClick={() => void bridge.openWeb(`/o/${org}/timesheets`)} className={action}>
          <ClipboardCheck className="size-4 text-text-muted" /> My timesheet <ExternalLink className="size-3 text-text-faint" />
        </button>
      </div>
      {s.timesheetDue && (
        <button
          onClick={() => void bridge.openWeb(`/o/${org}/timesheets?date=${s.timesheetDue!.periodStart}`)}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs ${s.timesheetDue.overdue ? 'border-warning/30 bg-warning-soft text-warning' : 'border-interactive/20 bg-interactive-soft text-interactive'}`}
        >
          <ClipboardCheck className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{s.timesheetDue.overdue ? 'Timesheet not submitted' : 'Timesheet due today'}</span>
            <span className="ml-1">
              · {fmtRange(s.timesheetDue.periodStart, s.timesheetDue.periodEnd)} · {fmtHm(s.timesheetDue.totalSeconds)}
              {s.timesheetDue.status === 'REJECTED' ? ' · changes requested' : ''}
            </span>
          </span>
          <ExternalLink className="size-3.5 shrink-0" />
        </button>
      )}
    </div>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function ProjectsCard({ s, run }: { s: AgentState; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = s.tracking;
  const tracking = t.state !== 'stopped';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const options = useMemo(
    () =>
      s.assignments
        .map((a) => ({ ...a, tasks: a.tasks.filter((x) => !needle || x.title.toLowerCase().includes(needle) || a.project_name.toLowerCase().includes(needle)) }))
        .filter((a) => !needle || a.project_name.toLowerCase().includes(needle) || (a.client_name ?? '').toLowerCase().includes(needle) || a.tasks.length > 0),
    [s.assignments, needle],
  );
  // The running (or last) project and search results show their tasks; others expand on demand.
  const expanded = (a: Assignment) => open[a.project_id] ?? (!!needle || a.project_id === (t.projectId ?? s.lastProject?.projectId));

  return (
    <section className={`${card} flex min-h-65 flex-col`} aria-label="Projects">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Your projects</h2>
        <span className="tabular text-2xs text-text-muted">{s.assignments.length}</span>
      </div>
      <div className="relative px-3 pt-3">
        <Search className="pointer-events-none absolute left-5 top-1/2 mt-1.5 size-3.5 -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects and tasks" aria-label="Search projects and tasks" className="h-9 w-full rounded-sm border border-border bg-surface pl-8 pr-2 text-sm focus:border-interactive focus:outline-none" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {options.length === 0 && <li className="px-3 py-8 text-center text-sm text-text-muted">{s.assignments.length ? 'No matches' : 'You are not assigned to any project yet.'}</li>}
        {options.map((a) => {
          const isOpen = expanded(a) && a.tasks.length > 0;
          const running = tracking && t.projectId === a.project_id;
          return (
            <li key={a.project_id}>
              <div className={`group flex items-center rounded-sm ${running && !t.taskId ? 'bg-interactive-soft' : 'hover:bg-surface-muted'}`}>
                <button
                  onClick={() => void run(() => bridge.start(a.project_id, null))}
                  title={running && !t.taskId ? 'Tracking' : `Track ${a.project_name}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.project_name}</span>
                    <span className="block truncate text-2xs text-text-muted">
                      {a.client_name ?? 'Internal'}
                      {a.tasks.length ? ` · ${a.tasks.length} task${a.tasks.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  {running && <span className="shrink-0 text-2xs font-semibold text-success">{t.state === 'paused' ? 'Paused' : 'Tracking'}</span>}
                </button>
                {a.tasks.length > 0 && (
                  <button onClick={() => setOpen((o) => ({ ...o, [a.project_id]: !isOpen }))} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} tasks for ${a.project_name}`} className="mr-1 rounded-sm p-1.5 text-text-faint hover:bg-surface-sunken hover:text-text">
                    <ChevronRight className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
              {isOpen && (
                <ul className="mb-1">
                  {a.tasks.map((x) => {
                    const on = tracking && t.taskId === x.id;
                    return (
                      <li key={x.id}>
                        <button
                          onClick={() => void run(() => bridge.start(a.project_id, x.id))}
                          className={`flex w-full items-center gap-2 rounded-sm py-1.5 pl-8 pr-2.5 text-left text-sm ${on ? 'bg-interactive-soft text-text' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`}
                        >
                          {on ? <span className="size-1.5 shrink-0 rounded-full bg-success" /> : <Play className="size-3 shrink-0 opacity-40" />}
                          <span className="min-w-0 flex-1 truncate">{x.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Activity & transparency ────────────────────────────────────────────────

function ActivityCard({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const p = s.policy!;
  const tracking = s.tracking.state === 'active';
  const bars = useMemo(() => lastHour(s.activityRecent), [s.activityRecent]);
  const measured = s.activityRecent.length;
  const avg = measured ? Math.round(s.activityRecent.reduce((sum, m) => sum + m.pct, 0) / measured) : null;
  const rec = s.recordingNow;
  return (
    <section className={card} aria-label="Your activity">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Your activity</h2>
        {tracking ? (
          <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success" /> Live
          </span>
        ) : (
          <span className="text-2xs text-text-muted">{s.tracking.state === 'paused' ? 'Paused' : 'Not tracking'}</span>
        )}
      </div>
      <div className="px-4 pt-3">
        {measured ? (
          <>
            <div className="flex h-16 items-end gap-px" role="img" aria-label={`Activity for the last ${measured} tracked minutes, average ${avg}%`}>
              {bars.map((b) => (
                <span key={b.minute} title={b.pct === null ? `${fmtTime(b.minute)} · not tracking` : `${fmtTime(b.minute)} · ${b.pct}%`} className={`min-w-0 flex-1 rounded-t-[1px] ${b.pct === null ? 'h-px bg-border' : actColor(b.pct)}`} style={b.pct === null ? undefined : { height: `${Math.max(4, b.pct)}%` }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-2xs text-text-faint">
              <span>{fmtTime(bars[0]!.minute)}</span>
              <span>now</span>
            </div>
          </>
        ) : (
          <p className="py-4 text-center text-xs text-text-muted">{tracking ? 'Your first minute of activity appears in a moment.' : 'Start the timer to see your activity for the last hour.'}</p>
        )}
      </div>
      <ul className="mt-2 divide-y divide-border border-t border-border text-sm">
        <Info icon={<AppWindow className="size-4" />} label="App" value={!p.apps.enabled ? 'Not recorded' : rec?.app ?? (tracking ? '—' : 'Recorded while tracking')} />
        <Info icon={<Globe className="size-4" />} label="Website" value={!p.urls.enabled ? 'Not recorded' : rec?.domain ?? (tracking ? '—' : 'Recorded while tracking')} />
        <Info
          icon={p.screenshots.enabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
          label="Screenshots"
          value={p.screenshots.enabled ? `${p.screenshots.perTenMinutes} per 10 min · all screens${p.screenshots.blur ? ' · blurred' : ''}` : 'Off'}
        />
      </ul>
      <button onClick={() => go('monitoring')} className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs font-medium text-interactive hover:bg-surface-muted">
        <span className="inline-flex items-center gap-1.5">
          <Eye className="size-3.5" /> What is monitored
        </span>
        <ChevronRight className="size-3.5" />
      </button>
    </section>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2.5 px-4 py-2">
      <span className="text-text-faint">{icon}</span>
      <span className="w-20 shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-sm font-medium" title={value}>
        {value}
      </span>
    </li>
  );
}

/** Indigo ramp step for an activity % (the tokens' sequential act-1…act-5 scale). */
function actColor(pct: number): string {
  return pct >= 80 ? 'bg-act-5' : pct >= 60 ? 'bg-act-4' : pct >= 40 ? 'bg-act-3' : pct >= 20 ? 'bg-act-2' : 'bg-act-1';
}

/** One slot per minute for the hour ending now; minutes without tracking are gaps. */
function lastHour(recent: AgentState['activityRecent']): Array<{ minute: string; pct: number | null }> {
  const byMinute = new Map(recent.map((m) => [Date.parse(m.minute), m.pct]));
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  const out: Array<{ minute: string; pct: number | null }> = [];
  for (let t = end - 59 * 60_000; t <= end; t += 60_000) out.push({ minute: new Date(t).toISOString(), pct: byMinute.get(t) ?? null });
  return out;
}

