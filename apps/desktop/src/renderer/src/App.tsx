import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, ChevronLeft, ClipboardCheck, ClockPlus, CloudOff, ExternalLink, Eye, Globe, Keyboard, LogOut, MapPin, Pause, Play, RefreshCw, Search, Settings, Square, TimerOff, AppWindow } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';

const bridge = window.tallywork;

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtHm(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function fmtRange(fromIso: string, toIso: string): string {
  const d = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${d(fromIso)} – ${d(toIso)}`;
}

function localDateInput(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function useAgentState(): AgentState | null {
  const [s, setS] = useState<AgentState | null>(null);
  useEffect(() => {
    void bridge.getState().then(setS);
    return bridge.onState(setS);
  }, []);
  return s;
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function App() {
  const s = useAgentState();
  const [view, setView] = useState<'timer' | 'monitoring' | 'settings' | 'manual'>('timer');
  if (!s) return <div className="h-full bg-nav" />;
  if (s.phase === 'signed_out' || s.phase === 'signing_in') return <SignIn s={s} />;
  if (!s.account) return <Loading />;
  if (s.recoveryPrompt) return <Recovery s={s} />;
  if (!s.policyAcknowledged || view === 'monitoring') return <Monitoring s={s} onBack={s.policyAcknowledged ? () => setView('timer') : undefined} />;
  if (view === 'settings') return <SettingsView s={s} onBack={() => setView('timer')} />;
  if (view === 'manual') return <ManualTime s={s} onBack={() => setView('timer')} />;
  return (
    <>
      <Timer s={s} onSettings={() => setView('settings')} onMonitoring={() => setView('monitoring')} onManual={s.policy?.manualTime.allowed ? () => setView('manual') : undefined} />
      {s.idlePrompt && <IdleSheet s={s} />}
    </>
  );
}

function Loading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-nav text-nav-muted">
      <Mark />
      <RefreshCw className="size-4 animate-spin" />
    </div>
  );
}

function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Tallywork">
      <rect width="32" height="32" rx="7" fill="#ffffff" opacity="0.1" />
      <g stroke="#e6ecf5" strokeWidth="2.6" strokeLinecap="round">
        <path d="M9 8.5v15M13.3 8.5v15M17.6 8.5v15M21.9 8.5v15" />
      </g>
      <path d="M6.5 21 25.5 11" stroke="#5B8DEF" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="25.5" cy="11" r="2.1" fill="#5B8DEF" />
    </svg>
  );
}

function SignIn({ s }: { s: AgentState }) {
  const [server, setServer] = useState(s.serverUrl);
  const [advanced, setAdvanced] = useState(false);
  const busy = s.phase === 'signing_in';
  return (
    <div className="instrument flex h-full flex-col justify-between bg-nav p-6 text-nav-fg">
      <div className="flex items-center gap-2">
        <Mark size={28} />
        <span className="text-base font-bold tracking-tight">Tallywork</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold">Sign in to start tracking</h1>
        <p className="mt-1.5 text-sm text-nav-muted">Your browser will open to confirm it is you. The desktop app never sees your password.</p>
        {s.error && <p className="mt-3 rounded-sm bg-danger/20 px-3 py-2 text-sm text-[#ffb4ad]">{s.error}</p>}
        <button disabled={busy} onClick={() => void bridge.login(server)} className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-60">
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
          {busy ? 'Waiting for browser…' : 'Sign in with browser'}
        </button>
        {s.serverManaged ? (
          <p className="mt-3 text-xs text-nav-muted">Server set by your organization: {s.serverUrl}</p>
        ) : (
          <button onClick={() => setAdvanced((a) => !a)} className="mt-3 text-xs text-nav-muted hover:text-nav-fg">
            {advanced ? 'Hide' : 'Server settings'}
          </button>
        )}
        {advanced && !s.serverManaged && (
          <label className="mt-2 block text-xs text-nav-muted">
            Server URL
            <input value={server} onChange={(e) => setServer(e.target.value)} className="mt-1 h-8 w-full rounded-sm border border-white/15 bg-white/5 px-2 text-sm text-nav-fg focus:border-interactive focus:outline-none" />
          </label>
        )}
      </div>
      <p className="text-2xs text-nav-muted">v{s.version}</p>
    </div>
  );
}

function Row({ icon, label, value, on }: { icon: React.ReactNode; label: string; value: string; on: boolean }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 ${on ? 'text-interactive' : 'text-text-faint'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-text-muted">{value}</span>
      </span>
      <span className={`mt-0.5 rounded-full px-2 py-0.5 text-2xs font-semibold ${on ? 'bg-interactive-soft text-interactive' : 'bg-surface-muted text-text-muted'}`}>{on ? 'On' : 'Off'}</span>
    </li>
  );
}

/** How websites are recorded, in plain words (what, and on Windows, by which means). */
function websitesText(mode: 'domain' | 'full', s: AgentState): string {
  const what = mode === 'domain' ? 'Website domains only (e.g. github.com), not full addresses.' : 'Website addresses without query strings.';
  if (!s.capabilities.urls) return `${what} Not available on this computer.`;
  if (navigator.userAgent.includes('Windows')) {
    const how = s.browserExtension.length
      ? `Read by the Tallywork browser extension in ${s.browserExtension.join(', ')}; other browsers: from the address bar.`
      : 'Read from the browser address bar (install the Tallywork browser extension for exact addresses).';
    return `${what} ${how} Private/incognito windows are skipped when the extension is installed.`;
  }
  return what;
}

/** Transparency: exactly what this policy collects. Must be acknowledged on first run and on every change. */
function Monitoring({ s, onBack }: { s: AgentState; onBack?: () => void }) {
  const p = s.policy!;
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="rounded-sm p-1 text-text-muted hover:bg-surface-muted">
            <ChevronLeft className="size-4" />
          </button>
        )}
        <Eye className="size-4 text-interactive" />
        <h1 className="text-sm font-semibold">What is monitored</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4">
        <p className="mt-3 text-xs text-text-muted">
          {s.account!.organization} collects the following <strong>only while your timer is running</strong>. When tracking is stopped, nothing is collected.
        </p>
        <ul className="divide-y divide-border">
          <Row icon={<Keyboard className="size-4" />} label="Activity level" value="How often you use the keyboard and mouse, per minute. Keystrokes and typed text are never recorded." on={p.activity.enabled && s.capabilities.input !== false} />
          <Row icon={<Camera className="size-4" />} label="Screenshots" value={p.screenshots.enabled ? `${p.screenshots.perTenMinutes} per 10 minutes, all displays${p.screenshots.blur ? ', blurred on this device before upload' : ''}.` : 'Not captured.'} on={p.screenshots.enabled} />
          <Row icon={<AppWindow className="size-4" />} label="Applications" value="Name of the app in the foreground and for how long." on={p.apps.enabled} />
          <Row icon={<Globe className="size-4" />} label="Websites" value={p.urls.enabled ? websitesText(p.urls.mode, s) : 'Not recorded.'} on={p.urls.enabled} />
          <Row icon={<MapPin className="size-4" />} label="Location" value="Never collected by the desktop app." on={false} />
          <Row icon={<TimerOff className="size-4" />} label="Idle detection" value={p.idle.enabled ? `After ${p.idle.thresholdMinutes} minutes without input you choose to keep or discard that time.` : 'Off.'} on={p.idle.enabled} />
        </ul>
        {(p.limits.dailySeconds || p.limits.weeklySeconds) && (
          <p className="mb-3 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">
            Time limits: {p.limits.dailySeconds ? `${fmtHm(p.limits.dailySeconds)} per day` : ''}
            {p.limits.dailySeconds && p.limits.weeklySeconds ? ' · ' : ''}
            {p.limits.weeklySeconds ? `${fmtHm(p.limits.weeklySeconds)} per week` : ''}
          </p>
        )}
        <p className="mb-4 text-xs text-text-muted">Your managers and organization admins can see this data. You can review your own activity and screenshots on the web.</p>
      </div>
      {!s.policyAcknowledged && (
        <footer className="border-t border-border p-4">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await bridge.acknowledgePolicy().finally(() => setBusy(false));
            }}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-60"
          >
            <Check className="size-4" /> I understand
          </button>
        </footer>
      )}
    </div>
  );
}

function Timer({ s, onSettings, onMonitoring, onManual }: { s: AgentState; onSettings: () => void; onMonitoring: () => void; onManual?: () => void }) {
  const t = s.tracking;
  const now = useTick(t.state === 'active');
  const elapsed = t.baseSeconds + (t.segmentStartedAt ? (now - Date.parse(t.segmentStartedAt)) / 1000 : 0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(t.note);
  const [breakMenu, setBreakMenu] = useState(false);
  const currentBreak = s.breakTypes.find((b) => b.id === s.breakTypeId);
  const shiftToday = s.nextShift && new Date(s.nextShift.startsAt).toDateString() === new Date(now).toDateString() ? s.nextShift : null;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const selectedProject = s.assignments.find((a) => a.project_id === t.projectId);
  const selectedTask = selectedProject?.tasks.find((x) => x.id === t.taskId);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.assignments
      .map((a) => ({ ...a, tasks: a.tasks.filter((x) => !needle || x.title.toLowerCase().includes(needle) || a.project_name.toLowerCase().includes(needle)) }))
      .filter((a) => !needle || a.project_name.toLowerCase().includes(needle) || a.tasks.length > 0);
  }, [s.assignments, q]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Action failed');
    }
  };
  const tracking = t.state !== 'stopped';

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between bg-nav px-4 py-2.5 text-nav-fg">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{s.account!.organization}</div>
          <div className="truncate text-2xs text-nav-muted">{s.account!.name}</div>
        </div>
        <div className="flex items-center gap-1">
          {onManual && (
            <button onClick={onManual} aria-label="Add manual time" title="Add manual time" className="rounded-sm p-1.5 text-nav-muted hover:bg-white/10 hover:text-nav-fg">
              <ClockPlus className="size-4" />
            </button>
          )}
          <button onClick={onMonitoring} aria-label="What is monitored" title="What is monitored" className="rounded-sm p-1.5 text-nav-muted hover:bg-white/10 hover:text-nav-fg">
            <Eye className="size-4" />
          </button>
          <button onClick={onSettings} aria-label="Settings" title="Settings" className="rounded-sm p-1.5 text-nav-muted hover:bg-white/10 hover:text-nav-fg">
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      {/* Timer */}
      <section className="border-b border-border bg-surface px-4 pb-4 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${t.state === 'active' ? 'bg-success-soft text-success' : t.state === 'paused' ? 'bg-warning-soft text-warning' : 'bg-surface-muted text-text-muted'}`}>
            <span className={`size-1.5 rounded-full ${t.state === 'active' ? 'animate-pulse bg-success' : t.state === 'paused' ? 'bg-warning' : 'bg-text-faint'}`} />
            {t.state === 'active' ? 'Tracking' : t.state === 'paused' ? (currentBreak ? `On break · ${currentBreak.name}` : 'Paused') : 'Not tracking'}
          </span>
          {shiftToday && t.state === 'stopped' && (
            <span className="text-text-muted" title="Your scheduled shift">
              Shift {hm(shiftToday.startsAt)}–{hm(shiftToday.endsAt)}
            </span>
          )}
          {!s.sync.online ? (
            <span className="inline-flex items-center gap-1 text-warning" title="Your time is saved on this computer and will sync when you are back online.">
              <CloudOff className="size-3.5" /> Offline · {s.sync.queued} saved
            </span>
          ) : s.sync.queued > 0 ? (
            <span className="text-text-faint">Syncing…</span>
          ) : null}
        </div>
        <div className="tabular mt-3 text-center font-mono text-[44px] font-medium leading-none tracking-tight">{fmtClock(tracking ? elapsed : 0)}</div>
        <div className="mt-2 truncate text-center text-sm text-text-muted">
          {selectedProject ? (
            <>
              <span className="font-medium text-text">{selectedProject.project_name}</span>
              {selectedTask && <> · {selectedTask.title}</>}
            </>
          ) : (
            'Choose a project below'
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {tracking ? (
            <>
              {t.state === 'active' ? (
                <div className="relative flex flex-1">
                  <button
                    onClick={() => (s.breakTypes.length ? setBreakMenu((m) => !m) : run(bridge.pause))}
                    aria-haspopup={s.breakTypes.length ? 'menu' : undefined}
                    aria-expanded={s.breakTypes.length ? breakMenu : undefined}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-sm border border-border bg-surface text-sm font-medium hover:bg-surface-muted"
                  >
                    <Pause className="size-4" /> {s.breakTypes.length ? 'Break' : 'Pause'}
                  </button>
                  {breakMenu && (
                    <ul role="menu" className="absolute left-0 top-11 z-10 w-52 rounded-sm border border-border bg-surface py-1 shadow-overlay">
                      {s.breakTypes.map((b) => (
                        <li key={b.id}>
                          <button role="menuitem" onClick={() => (setBreakMenu(false), void run(() => bridge.takeBreak(b.id)))} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted">
                            <span className="truncate">{b.name}</span>
                            <span className="shrink-0 text-2xs text-text-faint">
                              {b.paid ? 'paid' : 'unpaid'}
                              {b.maxMinutes ? ` · ${b.maxMinutes}m` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                      <li>
                        <button role="menuitem" onClick={() => (setBreakMenu(false), void run(bridge.pause))} className="w-full px-3 py-1.5 text-left text-sm text-text-muted hover:bg-surface-muted">
                          Just pause
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              ) : (
                <button onClick={() => run(bridge.resume)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-sm bg-interactive-soft text-sm font-medium text-interactive">
                  <Play className="size-4" /> Resume
                </button>
              )}
              <button onClick={() => run(bridge.stop)} className="flex h-10 flex-[1.4] items-center justify-center gap-2 rounded-sm bg-danger text-sm font-semibold text-on-accent hover:opacity-90">
                <Square className="size-3.5 fill-current" /> Stop tracking
              </button>
            </>
          ) : (
            <button
              disabled={!s.lastProject && !selectedProject}
              onClick={() => run(() => bridge.start(s.lastProject!.projectId, s.lastProject!.taskId))}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-50"
            >
              <Play className="size-4 fill-current" /> {s.lastProject ? 'Start tracking' : 'Pick a project to start'}
            </button>
          )}
        </div>
        {error && <p className="mt-2 rounded-sm bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{error}</p>}
        {tracking && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== t.note && void bridge.setNote(note)}
            placeholder="What are you working on? (note)"
            className="mt-3 h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-sm placeholder:text-text-faint focus:border-interactive focus:outline-none"
          />
        )}
      </section>

      {/* Project / task search */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="relative px-3 py-2">
          <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects and tasks" aria-label="Search projects and tasks" className="h-8 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-sm focus:border-interactive focus:outline-none" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {options.length === 0 && <li className="px-3 py-6 text-center text-sm text-text-muted">{s.assignments.length ? 'No matches' : 'You are not assigned to any project yet.'}</li>}
          {options.map((a) => (
            <li key={a.project_id}>
              <button
                onClick={() => run(() => bridge.start(a.project_id, null))}
                className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-surface-muted ${t.projectId === a.project_id && !t.taskId ? 'bg-interactive-soft' : ''}`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className="min-w-0 flex-1 truncate font-medium">{a.project_name}</span>
                {a.client_name && <span className="truncate text-2xs text-text-faint">{a.client_name}</span>}
              </button>
              {a.tasks.map((x) => (
                <button
                  key={x.id}
                  onClick={() => run(() => bridge.start(a.project_id, x.id))}
                  className={`flex w-full items-center gap-2 rounded-sm py-1.5 pl-7 pr-2.5 text-left text-sm text-text-muted hover:bg-surface-muted hover:text-text ${t.taskId === x.id ? 'bg-interactive-soft text-text' : ''}`}
                >
                  {t.taskId === x.id && tracking ? <span className="size-1.5 rounded-full bg-success" /> : <Play className="size-3 opacity-40" />}
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                </button>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {s.timesheetDue && (
        <button
          onClick={() => void bridge.openWeb(`/o/${s.account!.organizationId}/timesheets?date=${s.timesheetDue!.periodStart}`)}
          className={`flex items-center gap-2 border-t border-border px-4 py-2 text-left text-xs ${s.timesheetDue.overdue ? 'bg-warning-soft text-warning' : 'bg-interactive-soft text-interactive'}`}
        >
          <ClipboardCheck className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{s.timesheetDue.overdue ? 'Timesheet not submitted' : 'Timesheet due today'}</span>
            <span className="block truncate">
              {fmtRange(s.timesheetDue.periodStart, s.timesheetDue.periodEnd)} · {fmtHm(s.timesheetDue.totalSeconds)}
              {s.timesheetDue.status === 'REJECTED' ? ' · changes requested' : ''}
            </span>
          </span>
          <ExternalLink className="size-3.5 shrink-0" />
        </button>
      )}

      <footer className="grid grid-cols-3 border-t border-border bg-surface text-center">
        <div className="px-2 py-2">
          <div className="text-2xs text-text-muted">Today</div>
          <div className="tabular text-sm font-semibold">{fmtHm(s.todaySeconds)}</div>
        </div>
        <div className="border-x border-border px-2 py-2">
          <div className="text-2xs text-text-muted">This week</div>
          <div className="tabular text-sm font-semibold">{fmtHm(s.weekSeconds)}</div>
        </div>
        <div className="px-2 py-2">
          <div className="text-2xs text-text-muted">Activity</div>
          <div className="tabular text-sm font-semibold">{tracking && s.activityPct !== null ? `${s.activityPct}%` : '—'}</div>
        </div>
      </footer>
    </div>
  );
}

function IdleSheet({ s }: { s: AgentState }) {
  const i = s.idlePrompt!;
  const minutes = Math.max(1, Math.round((Date.parse(i.endedAt ?? new Date().toISOString()) - Date.parse(i.startedAt)) / 60000));
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="fixed inset-0 flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label="Idle time">
      <div className="w-full rounded-t-lg bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold">You were idle for {minutes} minutes</h2>
        <p className="mt-1 text-sm text-text-muted">
          {time(i.startedAt)} – {i.endedAt ? time(i.endedAt) : 'now'} with no keyboard or mouse activity. Keep that time?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button onClick={() => void bridge.resolveIdle('KEPT')} className="h-10 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover">
            Keep — I was working
          </button>
          <button onClick={() => void bridge.resolveIdle('DISCARDED')} className="h-10 rounded-sm border border-border text-sm font-medium hover:bg-surface-muted">
            Discard idle time
          </button>
        </div>
      </div>
    </div>
  );
}

function Recovery({ s }: { s: AgentState }) {
  const r = s.recoveryPrompt!;
  return (
    <div className="flex h-full flex-col justify-center gap-4 bg-surface p-6">
      <h1 className="text-lg font-semibold">Tallywork closed unexpectedly</h1>
      <p className="text-sm text-text-muted">
        Your timer{r.projectName ? ` on ${r.projectName}` : ''} was running. Time until {new Date(r.lastEvidenceAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} is saved; the gap since then is not counted.
      </p>
      <button onClick={() => void bridge.resolveRecovery(true)} className="h-10 rounded-sm bg-interactive text-sm font-semibold text-on-accent">
        Resume tracking
      </button>
      <button onClick={() => void bridge.resolveRecovery(false)} className="h-10 rounded-sm border border-border text-sm font-medium">
        Keep it stopped
      </button>
    </div>
  );
}

const field = 'mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm focus:border-interactive focus:outline-none';

/** Manual time request. Saved on this computer first, so it can be filed offline and is sent on reconnect. */
function ManualTime({ s, onBack }: { s: AgentState; onBack: () => void }) {
  const policy = s.policy!.manualTime;
  const [projectId, setProjectId] = useState(s.lastProject?.projectId ?? s.assignments[0]?.project_id ?? '');
  const [taskId, setTaskId] = useState<string>('');
  const [date, setDate] = useState(localDateInput());
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const project = s.assignments.find((a) => a.project_id === projectId);
  const startedAt = new Date(`${date}T${from}`);
  const endedAt = new Date(`${date}T${to}`);
  const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  const name = (id: string) => s.assignments.find((a) => a.project_id === id)?.project_name ?? 'Project';
  const time = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const submit = async () => {
    setError(null);
    setSaved(false);
    try {
      await bridge.requestManualTime({ projectId, taskId: taskId || null, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), reason });
      setReason('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Could not save');
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button onClick={onBack} aria-label="Back" className="rounded-sm p-1 text-text-muted hover:bg-surface-muted">
          <ChevronLeft className="size-4" />
        </button>
        <ClockPlus className="size-4 text-interactive" />
        <h1 className="text-sm font-semibold">Add manual time</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <label className="block text-xs text-text-muted">
          Project
          <select value={projectId} onChange={(e) => (setProjectId(e.target.value), setTaskId(''))} className={field}>
            {s.assignments.map((a) => (
              <option key={a.project_id} value={a.project_id}>
                {a.project_name}
              </option>
            ))}
          </select>
        </label>
        {project && project.tasks.length > 0 && (
          <label className="mt-2 block text-xs text-text-muted">
            Task (optional)
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className={field}>
              <option value="">No task</option>
              {project.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-2 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
          <label className="block text-xs text-text-muted">
            Date
            <input type="date" value={date} max={localDateInput()} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
          <label className="block text-xs text-text-muted">
            From
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="block text-xs text-text-muted">
            To
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
        </div>
        <label className="mt-2 block text-xs text-text-muted">
          Reason{policy.reasonRequired ? '' : ' (optional)'}
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client meeting away from my computer" className={field} />
        </label>
        <p className="mt-2 text-2xs text-text-muted">
          {seconds > 0 ? fmtHm(seconds) : '—'} · times in this computer's time zone. {policy.requiresApproval ? 'Your manager approves manual time before it counts.' : 'It is added to your timesheet right away.'}
        </p>
        {error && <p className="mt-2 rounded-sm bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{error}</p>}
        {saved && <p className="mt-2 rounded-sm bg-success-soft px-2.5 py-1.5 text-xs text-success">{s.sync.online ? 'Request sent.' : 'Saved on this computer. It will be sent when you are back online.'}</p>}
        <button disabled={!projectId || seconds <= 0} onClick={() => void submit()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-50">
          <Check className="size-4" /> {policy.requiresApproval ? 'Request time' : 'Add time'}
        </button>

        {s.manualRequests.length > 0 && (
          <>
            <h2 className="mt-5 text-xs font-semibold text-text-muted">Recent requests from this computer</h2>
            <ul className="mt-1 divide-y divide-border">
              {s.manualRequests.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{name(r.projectId)}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${r.status === 'rejected' ? 'bg-danger-soft text-danger' : r.status === 'queued' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
                      {r.status === 'queued' ? 'Waiting to send' : r.status === 'sent' ? 'Sent' : 'Not added'}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted">
                    {time(r.startedAt)} – {new Date(r.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                  {r.message && <div className="text-xs text-danger">{r.message}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsView({ s, onBack }: { s: AgentState; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button onClick={onBack} aria-label="Back" className="rounded-sm p-1 text-text-muted hover:bg-surface-muted">
          <ChevronLeft className="size-4" />
        </button>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>
      <dl className="divide-y divide-border px-4 text-sm">
        {[
          ['Signed in as', `${s.account?.name} (${s.account?.email})`],
          ['Organization', s.account?.organization ?? ''],
          ['Server', s.serverUrl],
          ['Device', s.device ? `${s.device.status.toLowerCase()} · ${s.device.id.slice(0, 8)}` : '—'],
          ['Pending sync', `${s.sync.queued} events${s.sync.lastSyncAt ? ` · last sync ${new Date(s.sync.lastSyncAt).toLocaleTimeString()}` : ''}`],
          ['Capabilities', Object.entries(s.capabilities).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join('  ')],
          ['Version', s.version],
        ].map(([k, v]) => (
          <div key={k} className="py-2.5">
            <dt className="text-xs text-text-muted">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {s.sync.error && <p className="mx-4 mt-2 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">{s.sync.error}</p>}
      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
        <button onClick={() => void bridge.openWeb('/')} className="flex h-9 items-center justify-center gap-2 rounded-sm border border-border text-sm hover:bg-surface-muted">
          <ExternalLink className="size-4" /> Open web dashboard
        </button>
        <button onClick={() => void bridge.logout()} className="flex h-9 items-center justify-center gap-2 rounded-sm border border-border text-sm text-danger hover:bg-danger-soft">
          <LogOut className="size-4" /> Sign out
        </button>
        <button onClick={() => void bridge.quit()} className="h-9 rounded-sm text-sm text-text-muted hover:bg-surface-muted">
          Quit Tallywork
        </button>
      </div>
    </div>
  );
}
