import { useEffect, useId, useState } from 'react';
import { ArrowRight, BarChart3, Check, ChevronLeft, Clock3, ClockPlus, ExternalLink, Eye, EyeOff, Lock, LogOut, Mail, RefreshCw, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { Dashboard } from './Dashboard';
import { ActivityPage, PayStubsPage, ProjectsPage, ReportsPage, SchedulePage, TasksPage, TimeOffPage, TimesheetPage, TrackingPage } from './Pages';
import { Shell } from './Shell';
import { bridge, errorText, fmtHm, isView, localDateInput, useAgentState, type View } from './lib';

export function App() {
  const s = useAgentState();
  const [view, setView] = useState<View>('home');
  useEffect(() => bridge.onNavigate((v) => isView(v) && setView(v)), []);
  if (!s) return <div className="h-full bg-nav" />;
  if (s.phase === 'signed_out' || s.phase === 'signing_in')
    return (
      <div className="h-full bg-bg">
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
      case 'paystubs':
        return <PayStubsPage />;
      case 'settings':
        return narrow(<SettingsView s={s} onBack={() => setView('home')} />);
      
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

/** A tall sign-in field with a leading icon (and an optional trailing control). */
function SignInField({ label, icon: Icon, trailing, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; icon: LucideIcon; trailing?: React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-text">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-text-faint" aria-hidden />
        <input
          id={id}
          className={`h-11 w-full rounded-lg border border-border bg-surface pl-11 text-sm text-text outline-none placeholder:text-text-faint hover:border-border-strong focus:border-interactive focus:ring-2 focus:ring-interactive/20 disabled:opacity-60 ${trailing ? 'pr-11' : 'pr-3.5'}`}
          {...rest}
        />
        {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
    </div>
  );
}

const PILLARS: Array<{ icon: LucideIcon; tone: string; title: string; body: string }> = [
  { icon: Clock3, tone: 'bg-[#1766ff]', title: 'Time Tracking', body: 'Accurate. Automatic. Effortless.' },
  { icon: BarChart3, tone: 'bg-[#6d4cf5]', title: 'Productivity Insights', body: 'Understand. Improve. Grow.' },
  { icon: Users, tone: 'bg-[#0f9f6e]', title: 'Team Focus', body: 'Better collaboration. Greater results.' },
];

/** The brand side of the sign-in window (wide windows only), as on the website's sign-in page. */
function SignInBrand() {
  return (
    <aside className="relative hidden w-[46%] shrink-0 flex-col overflow-hidden bg-[#060d22] px-10 py-9 text-white min-[900px]:flex">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_70%_90%,rgba(37,84,255,0.55),transparent_70%),radial-gradient(45%_40%_at_100%_30%,rgba(91,61,245,0.35),transparent_70%),radial-gradient(60%_50%_at_0%_100%,rgba(23,102,255,0.45),transparent_70%)]" />
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 800 500" preserveAspectRatio="none">
        <path d="M0 330 C 160 250, 260 420, 430 330 S 700 160, 800 120" fill="none" stroke="rgba(77,140,255,0.55)" strokeWidth="2" />
        <path d="M0 500 L0 380 C 180 300, 330 470, 520 400 S 760 300, 800 330 L800 500 Z" fill="rgba(23,102,255,0.28)" />
      </svg>
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center gap-3">
          <Mark size={44} />
          <span>
            <span className="block text-2xl font-bold leading-none tracking-tight">
              Work<span className="text-[#3b82ff]">Pulse</span>
            </span>
            <span className="mt-1 block text-xs tracking-wide text-[#9fb0cf]">Track • Focus • Achieve</span>
          </span>
        </div>
        <h2 className="mt-12 text-[38px] font-extrabold leading-[1.08] tracking-tight">
          Turn Work
          <br />
          into <span className="text-[#3b82ff]">Progress</span>
        </h2>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#c7d2e8]">Track time, monitor activity, and get real insights into how your team works — all in one place.</p>
        <ul className="mt-8 space-y-5">
          {PILLARS.map((p) => (
            <li key={p.title} className="flex items-center gap-3.5">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-lg ${p.tone}`}>
                <p.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold">{p.title}</span>
                <span className="block text-xs text-[#9fb0cf]">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-auto flex items-center gap-2 text-xs text-[#c7d2e8]">
          <ShieldCheck className="size-4 text-[#3b82ff]" aria-hidden />
          Trusted by remote teams worldwide
        </p>
      </div>
    </aside>
  );
}

function SignIn({ s }: { s: AgentState }) {
  const [server, setServer] = useState(s.serverUrl);
  const [advanced, setAdvanced] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="flex h-full w-full">
      <SignInBrand />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-bg">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_85%_0%,rgba(23,102,255,0.10),transparent_70%),radial-gradient(50%_40%_at_10%_100%,rgba(99,102,241,0.08),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 size-48 rotate-12 rounded-[38%] bg-[linear-gradient(140deg,#4f7dff_0%,#1766ff_45%,#5b3df5_100%)] opacity-90" />
        <div className="relative m-auto w-full max-w-[420px] px-5 py-8">
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-[0_24px_60px_-28px_rgba(15,34,64,0.35)]">
            <Mark size={40} />
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-text">Welcome Back</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">Sign in to start tracking, with the email and password you chose when you accepted your invitation.</p>
            {s.error && (
              <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {s.error}
              </p>
            )}
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
              <SignInField label="Email" icon={Mail} type="email" autoComplete="email" placeholder="you@company.com" autoFocus value={email} disabled={step !== 'password'} onChange={(e) => setEmail(e.target.value)} />
              <SignInField
                label="Password"
                icon={Lock}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                disabled={step !== 'password'}
                onChange={(e) => setPassword(e.target.value)}
                trailing={
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    className="flex size-8 items-center justify-center rounded-md text-text-faint hover:bg-surface-muted hover:text-text"
                  >
                    {showPassword ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
                  </button>
                }
              />
              {step === 'mfa' && (
                <SignInField label="Authentication code (or a recovery code)" icon={ShieldCheck} inputMode="numeric" autoComplete="one-time-code" autoFocus value={mfaCode} maxLength={20} onChange={(e) => setMfaCode(e.target.value)} className="tabular tracking-[0.2em]" />
              )}
              {step === 'organization' && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-[13px] font-semibold text-text">Which organization is this computer for?</legend>
                  {organizations.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-text">
                      <input type="radio" name="org" checked={organizationId === o.id} onChange={() => setOrganizationId(o.id)} />
                      {o.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <button type="submit" disabled={busy || !ready} className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-interactive text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-60">
                {busy && !viaBrowser ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
                {step === 'password' ? 'Sign in' : 'Continue'}
              </button>
              {step !== 'password' && (
                <button type="button" onClick={restart} className="text-xs text-text-muted hover:text-text">
                  Use a different account
                </button>
              )}
            </form>
            <div className="mt-5 flex items-center gap-3 text-xs text-text-muted">
              <span aria-hidden className="h-px flex-1 bg-border" />
              or
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setViaBrowser(true);
                void bridge.login(server);
              }}
              className="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium text-text hover:bg-surface-muted disabled:opacity-60"
            >
              {busy && viaBrowser ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
              {busy && viaBrowser ? 'Waiting for browser…' : 'Sign in with browser instead'}
            </button>
            <div className="mt-5 flex items-start gap-3 rounded-xl bg-surface-muted px-4 py-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-interactive" aria-hidden />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-text">Secure and encrypted</p>
                <p className="text-text-muted">Your sign-in is stored encrypted on this computer.</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between px-1 text-xs text-text-muted">
            {s.serverManaged ? (
              <span>Server set by your organization: {s.serverUrl}</span>
            ) : (
              <button onClick={() => setAdvanced((a) => !a)} className="hover:text-text">
                {advanced ? 'Hide' : 'Server settings'}
              </button>
            )}
            <span className="text-2xs">v{s.version}</span>
          </div>
          {advanced && !s.serverManaged && (
            <label className="mt-2 block px-1 text-xs text-text-muted">
              Server URL
              <input value={server} onChange={(e) => setServer(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-interactive focus:outline-none" />
            </label>
          )}
        </div>
      </div>
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

/** Device status in plain words a worker understands, rather than the raw enum. */
function deviceStatusLabel(status: string): string {
  const map: Record<string, string> = { ACTIVE: 'Active', PENDING: 'Waiting for your administrator to approve it', REVOKED: 'Removed by your administrator' };
  return map[status.toUpperCase()] ?? status;
}

function SettingsView({ s, onBack }: { s: AgentState; onBack: () => void }) {
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
          ['This device', s.device ? deviceStatusLabel(s.device.status) : '—'],
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
