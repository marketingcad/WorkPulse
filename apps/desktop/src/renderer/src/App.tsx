import { useEffect, useId, useState } from 'react';
import { AppWindow, Camera, Check, ChevronLeft, ClockPlus, ExternalLink, Eye, Globe, Keyboard, LogOut, MapPin, RefreshCw, TimerOff } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { Dashboard } from './Dashboard';
import { ActivityPage, ProjectsPage, ReportsPage, SchedulePage, TasksPage, TimeOffPage, TimesheetPage, TrackingPage } from './Pages';
import { Shell } from './Shell';
import { bridge, errorText, fmtHm, isView, localDateInput, useAgentState, type View } from './lib';

export function App() {
  const s = useAgentState();
  const [view, setView] = useState<View>('home');
  useEffect(() => bridge.onNavigate((v) => isView(v) && setView(v)), []);
  if (!s) return <div className="h-full bg-nav" />;
  if (s.phase === 'signed_out' || s.phase === 'signing_in')
    return (
      <div className="h-full bg-nav">
        <SignIn s={s} />
      </div>
    );
  if (!s.account) return <Loading />;
  if (s.recoveryPrompt)
    return (
      <div className="h-full bg-surface">
        <Recovery s={s} />
      </div>
    );
  // First run and every policy change: the worker must see what is monitored before tracking.
  if (!s.policyAcknowledged)
    return (
      <div className="h-full bg-bg md:p-6">
        <div className="mx-auto h-full max-w-2xl">
          <Monitoring s={s} />
        </div>
      </div>
    );
  // Settings-style screens read best at a comfortable width inside a wide window.
  const narrow = (el: React.ReactNode) => <div className="mx-auto h-full w-full max-w-2xl md:py-4">{el}</div>;
  const page = (() => {
    switch (view) {
      case 'tracking':
        return <TrackingPage s={s} go={setView} />;
      case 'projects':
        return <ProjectsPage s={s} />;
      case 'tasks':
        return <TasksPage s={s} />;
      case 'timesheet':
        return <TimesheetPage s={s} />;
      case 'activity':
        return <ActivityPage s={s} />;
      case 'reports':
        return <ReportsPage />;
      case 'timeoff':
        return <TimeOffPage />;
      case 'schedule':
        return <SchedulePage />;
      case 'settings':
        return narrow(<SettingsView s={s} onBack={() => setView('home')} onMonitoring={() => setView('monitoring')} />);
      case 'monitoring':
        return narrow(<Monitoring s={s} onBack={() => setView('home')} />);
      case 'manual':
        return narrow(<ManualTime s={s} onBack={() => setView('tracking')} />);
      default:
        return <Dashboard s={s} go={setView} />;
    }
  })();
  return (
    <>
      <Shell s={s} view={view} go={setView}>
        {page}
      </Shell>
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

/** Brand mark (same drawing as the web Logo in packages/ui/src/logo.tsx). */
function Mark({ size = 32 }: { size?: number }) {
  const clip = `wp-inner-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="WorkPulse">
      <defs>
        <clipPath id={clip}>
          <path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z" />
        </clipPath>
      </defs>
      <path d="M32 5.5 55 18.75v26.5L32 58.5 9 45.25v-26.5Z" fill="#1766FF" stroke="#1766FF" strokeWidth="7" strokeLinejoin="round" />
      <path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z" fill="#0B2A66" stroke="#0B2A66" strokeWidth="4" strokeLinejoin="round" />
      <path d="M9 41 22.5 26.5 32.5 41.5 41.5 28.5 56 37" fill="none" stroke="#FFFFFF" strokeWidth="6.4" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clip})`} />
    </svg>
  );
}

const signInInput = 'mt-1 h-10 w-full rounded-sm border border-white/15 bg-white/5 px-3 text-sm text-nav-fg focus:border-interactive focus:outline-none';

function SignIn({ s }: { s: AgentState }) {
  const [server, setServer] = useState(s.serverUrl);
  const [advanced, setAdvanced] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  // Extra steps the server can ask for after email + password.
  const [step, setStep] = useState<'password' | 'mfa' | 'organization'>('password');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [viaBrowser, setViaBrowser] = useState(false);
  const busy = s.phase === 'signing_in';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setViaBrowser(false);
    const r = await bridge.loginWithPassword({ email: email.trim(), password, mfaCode: step === 'mfa' ? mfaCode : undefined, organizationId: organizationId || undefined, serverUrl: server });
    if (r.status === 'mfa_required') setStep('mfa');
    else if (r.status === 'organization_required') {
      setOrganizations(r.organizations);
      setOrganizationId(r.organizations[0]?.id ?? '');
      setStep('organization');
    } else if (r.status === 'signed_in') setPassword('');
  }

  function restart() {
    setStep('password');
    setMfaCode('');
    setOrganizationId('');
  }

  const ready = !!email.trim() && !!password && (step !== 'mfa' || mfaCode.trim().length >= 6) && (step !== 'organization' || !!organizationId);
  return (
    <div className="instrument mx-auto flex h-full w-full max-w-md flex-col justify-between bg-nav p-6 text-nav-fg">
      <div className="flex items-center gap-2">
        <Mark size={28} />
        <span className="text-base font-bold tracking-tight">
          Work<span className="text-[#4D8DFF]">Pulse</span>
        </span>
      </div>
      <div>
        <h1 className="text-xl font-semibold">Sign in to start tracking</h1>
        <p className="mt-1.5 text-sm text-nav-muted">Use the email and password you chose when you accepted your invitation.</p>
        {s.error && <p role="alert" className="mt-3 rounded-sm bg-danger/20 px-3 py-2 text-sm text-[#ffb4ad]">{s.error}</p>}
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3" noValidate>
          <label className="block text-xs text-nav-muted">
            Email
            <input type="email" autoComplete="email" autoFocus value={email} disabled={step !== 'password'} onChange={(e) => setEmail(e.target.value)} className={signInInput} />
          </label>
          <label className="block text-xs text-nav-muted">
            Password
            <input type="password" autoComplete="current-password" value={password} disabled={step !== 'password'} onChange={(e) => setPassword(e.target.value)} className={signInInput} />
          </label>
          {step === 'mfa' && (
            <label className="block text-xs text-nav-muted">
              Authentication code (or a recovery code)
              <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={mfaCode} maxLength={20} onChange={(e) => setMfaCode(e.target.value)} className={`${signInInput} tabular tracking-[0.2em]`} />
            </label>
          )}
          {step === 'organization' && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs text-nav-muted">Which organization is this computer for?</legend>
              {organizations.map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-sm">
                  <input type="radio" name="org" checked={organizationId === o.id} onChange={() => setOrganizationId(o.id)} />
                  {o.name}
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" disabled={busy || !ready} className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-60">
            {busy && !viaBrowser && <RefreshCw className="size-4 animate-spin" />}
            {step === 'password' ? 'Sign in' : 'Continue'}
          </button>
          {step !== 'password' && (
            <button type="button" onClick={restart} className="text-xs text-nav-muted hover:text-nav-fg">
              Use a different account
            </button>
          )}
        </form>
        <button
          disabled={busy}
          onClick={() => {
            setViaBrowser(true);
            void bridge.login(server);
          }}
          className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs text-nav-muted hover:text-nav-fg disabled:opacity-60"
        >
          {busy && viaBrowser ? <RefreshCw className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
          {busy && viaBrowser ? 'Waiting for browser…' : 'Sign in with browser instead'}
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
      ? `Read by the browser extension in ${s.browserExtension.join(', ')}; other browsers: from the address bar.`
      : 'Read from the browser address bar (install the browser extension for exact addresses).';
    return `${what} ${how} Private/incognito windows are skipped when the extension is installed.`;
  }
  return what;
}

/** Transparency: exactly what this policy collects. Must be acknowledged on first run and on every change. */
function Monitoring({ s, onBack }: { s: AgentState; onBack?: () => void }) {
  const p = s.policy!;
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface md:overflow-hidden md:rounded-md md:border md:border-border">
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
          <Row icon={<Camera className="size-4" />} label="Screenshots" value={p.screenshots.enabled ? `${p.screenshots.perTenMinutes} per 10 minutes, all displays${p.screenshots.blur ? ', blurred on this device before upload' : ''}.` : 'Not captured.'} on={p.screenshots.enabled && s.capabilities.screenshots !== false} />
          <Row icon={<AppWindow className="size-4" />} label="Applications" value="Name of the app in the foreground and for how long." on={p.apps.enabled && s.capabilities.apps !== false} />
          <Row icon={<Globe className="size-4" />} label="Websites" value={p.urls.enabled ? websitesText(p.urls.mode, s) : 'Not recorded.'} on={p.urls.enabled} />
          <Row icon={<MapPin className="size-4" />} label="Location" value="Never collected by the desktop app." on={false} />
          <Row icon={<TimerOff className="size-4" />} label="Idle detection" value={p.idle.enabled ? `After ${p.idle.thresholdMinutes} minutes without input you choose to keep or discard that time.` : 'Off.'} on={p.idle.enabled} />
        </ul>
        {s.capabilities.wayland && (p.activity.enabled || p.apps.enabled || p.screenshots.enabled) && (
          <p className="mb-3 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">
            This computer uses a <strong>Wayland</strong> session, which does not let WorkPulse see your activity level, the app you are using or your screen, so those are not recorded. Your organization may ask you to switch: sign out, select your name on the login screen,
            click the gear icon at the bottom right, choose <strong>Ubuntu on Xorg</strong> and sign in again.
          </p>
        )}
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

function IdleSheet({ s }: { s: AgentState }) {
  const i = s.idlePrompt!;
  const minutes = Math.max(1, Math.round((Date.parse(i.endedAt ?? new Date().toISOString()) - Date.parse(i.startedAt)) / 60000));
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Idle time">
      <div className="w-full rounded-t-lg bg-surface p-5 shadow-overlay sm:max-w-md sm:rounded-lg">
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
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4 bg-surface p-6">
      <h1 className="text-lg font-semibold">WorkPulse closed unexpectedly</h1>
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
      setError(errorText(e, 'Could not save'));
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface md:overflow-hidden md:rounded-md md:border md:border-border">
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

function SettingsView({ s, onBack, onMonitoring }: { s: AgentState; onBack: () => void; onMonitoring: () => void }) {
  return (
    <div className="flex h-full flex-col bg-surface md:overflow-hidden md:rounded-md md:border md:border-border">
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
            <dd className="wrap-break-word">{v}</dd>
          </div>
        ))}
      </dl>
      {s.sync.error && <p className="mx-4 mt-2 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">{s.sync.error}</p>}
      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
        <button onClick={onMonitoring} className="flex h-9 items-center justify-center gap-2 rounded-sm border border-border text-sm hover:bg-surface-muted">
          <Eye className="size-4" /> What is monitored
        </button>
        <button onClick={() => void bridge.logout()} className="flex h-9 items-center justify-center gap-2 rounded-sm border border-border text-sm text-danger hover:bg-danger-soft">
          <LogOut className="size-4" /> Sign out
        </button>
        <button onClick={() => void bridge.quit()} className="h-9 rounded-sm text-sm text-text-muted hover:bg-surface-muted">
          Quit WorkPulse
        </button>
      </div>
    </div>
  );
}
