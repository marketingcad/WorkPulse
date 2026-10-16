import { useMemo, useState, type ReactNode } from 'react';
import { Activity, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, ClockPlus, Coffee, Download, Inbox, LayoutGrid, PauseCircle, PenLine, Play, RefreshCw, Send, type LucideIcon } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { ProjectsCard } from './Dashboard';
import { SessionList, localDay } from './HomeCards';
import { addDays, bridge, card, errorText, fmtDay, fmtHm, fmtTime, localDateInput, useMe, weekStartOf, type View } from './lib';
import type { ActivityDayDto, PayStubDto, SessionDto, ShiftDto, SummaryDto, TaskDto, TimeOffDto, TimesheetDto } from './types';

// ─── Shared page pieces ──────────────────────────────────────────────────────

function Page({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-350 flex-col gap-3 p-3 md:gap-4 md:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, right, children, className = '' }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${card} ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The one place that renders a data screen's loading / error / empty states, so every page handles
 * all of them the same way. Pass `onRetry` (a query's reload) to offer a Try again button on error.
 */
function Status({ loading, error, empty, onRetry, children }: { loading: boolean; error: string | null; empty?: string | false; onRetry?: () => void; children?: ReactNode }) {
  if (loading)
    return (
      <div className="space-y-2 p-4" aria-busy="true">
        <span className="sr-only">Loading…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-sm bg-surface-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  if (error)
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-warning">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-muted">
            <RefreshCw className="size-3.5" /> Try again
          </button>
        )}
      </div>
    );
  if (empty)
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-md bg-interactive-soft text-interactive" aria-hidden>
          <Inbox className="size-5" />
        </span>
        <p className="max-w-sm text-sm text-text-muted">{empty}</p>
      </div>
    );
  return <>{children}</>;
}

/** Solid tiles for stat icons, matching the web dashboards (white icon on a brand colour). */
const TILE = { blue: 'bg-[#1766ff]', violet: 'bg-[#6d4cf5]', green: 'bg-[#0f9f6e]', amber: 'bg-[#e08a00]', teal: 'bg-[#0e98b3]' } as const;

function Stat({ label, value, hint, tone, icon: Icon, color = 'blue' }: { label: string; value: string; hint?: string; tone?: 'warning'; icon?: LucideIcon; color?: keyof typeof TILE }) {
  return (
    <div className={`${card} flex items-start gap-3 px-4 py-3.5`}>
      {Icon && (
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-sm text-white shadow-sm ${TILE[color]}`} aria-hidden>
          <Icon className="size-[18px]" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-muted">{label}</div>
        <div className={`tabular mt-0.5 text-xl font-bold tracking-tight ${tone === 'warning' ? 'text-warning' : ''}`}>{value}</div>
        {hint && <div className="text-2xs text-text-faint">{hint}</div>}
      </div>
    </div>
  );
}

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-muted disabled:opacity-50';
const primary = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-interactive px-3 text-sm font-semibold text-on-accent hover:bg-interactive-hover disabled:opacity-50';
const field = 'mt-1 h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm focus:border-interactive focus:outline-none';

function Stepper({ label, onPrev, onNext, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="inline-flex items-center rounded-sm border border-border bg-surface">
      <button onClick={onPrev} aria-label="Previous" className="p-2 text-text-muted hover:bg-surface-muted hover:text-text">
        <ChevronLeft className="size-4" />
      </button>
      <span className="tabular min-w-36 px-2 text-center text-sm font-medium">{label}</span>
      <button onClick={onNext} disabled={nextDisabled} aria-label="Next" className="p-2 text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-40">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  const cls = { success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', info: 'bg-interactive-soft text-interactive', neutral: 'bg-surface-muted text-text-muted' }[tone];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-semibold ${cls}`}>{children}</span>;
}

const today = () => localDateInput();

// ─── Time Tracking ───────────────────────────────────────────────────────────

export function TrackingPage({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const [days, setDays] = useState(7);
  const q = useMe<SessionDto[]>('sessions', { from: addDays(today(), -(days - 1)), to: today() }, { refreshMs: 60_000, deps: [s.tracking.state, s.tracking.sessionId] });
  const byDay = useMemo(() => {
    const m = new Map<string, SessionDto[]>();
    for (const x of [...(q.data ?? [])].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
      const d = localDay(x.started_at);
      m.set(d, [...(m.get(d) ?? []), x]);
    }
    return [...m.entries()];
  }, [q.data]);
  return (
    <Page
      title="Time Tracking"
      description="Your sessions from this computer and the web."
      actions={
        <>
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-sm border border-border bg-surface px-2 text-sm">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          {s.policy?.manualTime.allowed && (
            <button onClick={() => go('manual')} className={btn}>
              <ClockPlus className="size-4 text-text-muted" /> Add manual time
            </button>
          )}
        </>
      }
    >
      <Status loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload} empty={!!q.data && !byDay.length && 'No sessions in this period.'}>
        {byDay.map(([date, list]) => (
          <Card key={date} title={fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} right={<span className="tabular text-sm font-semibold">{fmtHm(list.reduce((sum, x) => sum + x.worked_seconds, 0))}</span>}>
            <SessionList sessions={list} loading={false} error={null} s={s} empty="" />
          </Card>
        ))}
      </Status>
    </Page>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function ProjectsPage({ s }: { s: AgentState }) {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const week = useMe<SummaryDto>('summary', { from: weekStartOf(today()), to: today() }, { refreshMs: 120_000, deps: [s.tracking.sessionId] });
  const max = Math.max(1, ...(week.data?.projects.map((p) => p.seconds) ?? [0]));
  return (
    <Page title="Projects" description="Projects you are assigned to. Click one to start tracking.">
      {error && <p className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px] md:gap-4">
        <ProjectsCard s={s} run={run} />
        <Card title="This week">
          <Status loading={week.loading && !week.data} error={week.data ? null : week.error} onRetry={week.reload} empty={!!week.data && !week.data.projects.length && 'No time this week yet.'}>
            <ul className="flex flex-col gap-3 px-4 py-3">
              {week.data?.projects.map((p) => (
                <li key={p.project_id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{p.project_name}</span>
                    <span className="tabular shrink-0 font-semibold">{fmtHm(p.seconds)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full rounded-full" style={{ width: `${(p.seconds / max) * 100}%`, background: p.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </Status>
        </Card>
      </div>
    </Page>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export function TasksPage({ s }: { s: AgentState }) {
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [error, setError] = useState<string | null>(null);
  const q = useMe<TaskDto[]>('tasks', {}, { refreshMs: 120_000 });
  const t = s.tracking;
  const groups = useMemo(() => {
    const list = (q.data ?? []).filter((x) => (filter === 'all' ? true : filter === 'done' ? x.status === 'DONE' : x.status !== 'DONE'));
    const m = new Map<string, TaskDto[]>();
    for (const x of list) m.set(x.project_id, [...(m.get(x.project_id) ?? []), x]);
    return [...m.entries()];
  }, [q.data, filter]);
  const start = async (x: TaskDto) => {
    setError(null);
    try {
      await (t.state !== 'stopped' ? bridge.switchTask(x.project_id, x.id) : bridge.start(x.project_id, x.id));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const tabs: Array<[typeof filter, string]> = [
    ['open', 'Open'],
    ['done', 'Done'],
    ['all', 'All'],
  ];
  return (
    <Page
      title="Tasks"
      description="Tasks assigned to you."
      actions={
        <div className="inline-flex rounded-sm border border-border bg-surface p-0.5" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`rounded-[3px] px-3 py-1 text-sm ${filter === k ? 'bg-interactive-soft font-semibold text-interactive' : 'text-text-muted hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {error && <p className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Status loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload} empty={!!q.data && !groups.length && (filter === 'done' ? 'No finished tasks.' : 'No tasks assigned to you.')}>
        {groups.map(([projectId, list]) => {
          const a = s.assignments.find((x) => x.project_id === projectId);
          return (
            <Card key={projectId} title={list[0]!.project_name ?? a?.project_name ?? 'Project'} right={<span className="text-2xs text-text-muted">{list.length}</span>}>
              <ul className="divide-y divide-border">
                {list.map((x) => {
                  const running = t.state !== 'stopped' && t.taskId === x.id;
                  const overdue = !!x.due_date && x.status !== 'DONE' && x.due_date < today();
                  return (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${x.status === 'DONE' ? 'text-text-muted line-through' : ''}`}>{x.title}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-muted">
                          <span>{x.status === 'IN_PROGRESS' ? 'In progress' : x.status === 'DONE' ? 'Done' : 'To do'}</span>
                          {x.priority !== 'MEDIUM' && <span className={x.priority === 'URGENT' || x.priority === 'HIGH' ? 'font-semibold text-warning' : ''}>{x.priority.toLowerCase()} priority</span>}
                          {x.due_date && <span className={overdue ? 'font-semibold text-danger' : ''}>due {fmtDay(x.due_date)}</span>}
                          {!!x.tracked_seconds && <span className="tabular">{fmtHm(x.tracked_seconds)} tracked</span>}
                        </span>
                      </span>
                      {running ? (
                        <Badge tone="success">{t.state === 'paused' ? 'Paused' : 'Tracking'}</Badge>
                      ) : (
                        x.status !== 'DONE' && (
                          <button onClick={() => void start(x)} className={btn} aria-label={`Start ${x.title}`}>
                            <Play className="size-3.5" /> Start
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </Status>
    </Page>
  );
}

// ─── Timesheet ───────────────────────────────────────────────────────────────

const TS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { APPROVED: 'success', SUBMITTED: 'info', REJECTED: 'danger', DRAFT: 'neutral' };

export function TimesheetPage({ s }: { s: AgentState }) {
  // Opens on the period waiting to be submitted (possibly last period's), otherwise the current one.
  const [date, setDate] = useState(s.timesheetDue?.periodStart ?? today());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useMe<TimesheetDto>('timesheet', { date }, { deps: [s.tracking.sessionId] });
  const ts = q.data;
  const canSubmit = !!ts && (ts.status === 'DRAFT' || ts.status === 'REJECTED') && ts.total_seconds > 0;
  const submit = async () => {
    if (!ts) return;
    setBusy(true);
    setMsg(null);
    try {
      await bridge.submitTimesheet(ts.period_start, ts.version);
      setMsg({ ok: true, text: 'Timesheet submitted — your manager will review it. You will be notified when it is approved or if changes are needed.' });
      q.reload();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, 'Could not submit') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title="Timesheet"
      description="Your time for the pay period. Submit it when it is complete."
      actions={
        ts && (
          <>
            <Stepper label={`${fmtDay(ts.period_start, { month: 'short', day: 'numeric' })} – ${fmtDay(ts.period_end, { month: 'short', day: 'numeric' })}`} onPrev={() => setDate(addDays(ts.period_start, -1))} onNext={() => setDate(addDays(ts.period_end, 1))} nextDisabled={ts.period_end >= today()} />
            {canSubmit && (
              <button onClick={() => void submit()} disabled={busy} className={primary}>
                <Send className="size-4" /> {ts.status === 'REJECTED' ? 'Resubmit' : 'Submit'}
              </button>
            )}
          </>
        )
      }
    >
      {msg && <p className={`rounded-sm px-3 py-2 text-sm ${msg.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
      <Status loading={q.loading && !ts} error={ts ? null : q.error} onRetry={q.reload}>
        {ts && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
              <Stat icon={Clock3} color="blue" label="Total" value={fmtHm(ts.total_seconds)} hint={ts.expected_seconds ? `of ${fmtHm(ts.expected_seconds)} expected` : undefined} />
              <Stat icon={PenLine} color="violet" label="Added by hand" value={fmtHm(ts.manual_seconds)} />
              <Stat icon={Activity} color="green" label="Activity" value={ts.avg_activity_pct != null ? `${ts.avg_activity_pct}%` : '—'} />
            </div>
            <Card title="Hours by day" right={<Badge tone={TS_TONE[ts.status] ?? 'neutral'}>{ts.status.charAt(0) + ts.status.slice(1).toLowerCase()}</Badge>}>
              {(ts.status === 'REJECTED' || ts.comment) && (
                <p className={`mx-4 mt-3 rounded-sm px-3 py-2 text-xs ${ts.status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-text-muted'}`}>
                  {ts.status === 'REJECTED' ? 'Changes requested' : 'Comment'}
                  {ts.decided_by_name ? ` by ${ts.decided_by_name}` : ''}: {ts.comment ?? '—'}
                </p>
              )}
              {ts.late_seconds > 0 && <p className="mx-4 mt-3 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">{fmtHm(ts.late_seconds)} was added or changed after you submitted.</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-160 whitespace-nowrap text-sm">
                  <thead>
                    <tr className="border-b border-border text-2xs text-text-muted">
                      <th className="px-4 py-2 text-left font-medium">Project / task</th>
                      {ts.days.map((d) => (
                        <th key={d.date} className={`w-18 px-2 py-2 text-right font-medium ${d.date === today() ? 'text-interactive' : ''}`}>
                          {fmtDay(d.date, { weekday: 'short' })}
                          <span className="block font-normal">{fmtDay(d.date, { day: 'numeric' })}</span>
                        </th>
                      ))}
                      <th className="w-20 px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ts.projects.length === 0 && (
                      <tr>
                        <td colSpan={ts.days.length + 2} className="px-4 py-8 text-center text-text-muted">
                          No time in this period.
                        </td>
                      </tr>
                    )}
                    {ts.projects.map((p) => (
                      <tr key={`${p.project_id}:${p.task_id ?? ''}`}>
                        <td className="max-w-60 px-4 py-2">
                          <span className="flex items-center gap-2">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: p.color ?? 'var(--tw-text-faint)' }} />
                            <span className="truncate">
                              {p.project_name}
                              {p.task_title && <span className="text-text-muted"> · {p.task_title}</span>}
                            </span>
                          </span>
                        </td>
                        {ts.days.map((d) => (
                          <td key={d.date} className="tabular px-2 py-2 text-right text-text-muted">
                            {p.days[d.date] ? fmtHm(p.days[d.date]!) : '—'}
                          </td>
                        ))}
                        <td className="tabular px-4 py-2 text-right font-semibold">{fmtHm(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="px-4 py-2">Total</td>
                      {ts.days.map((d) => (
                        <td key={d.date} className="tabular px-2 py-2 text-right">
                          {d.seconds ? fmtHm(d.seconds) : '—'}
                        </td>
                      ))}
                      <td className="tabular px-4 py-2 text-right">{fmtHm(ts.total_seconds)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        )}
      </Status>
    </Page>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

function actColor(pct: number): string {
  return pct >= 80 ? 'bg-act-5' : pct >= 60 ? 'bg-act-4' : pct >= 40 ? 'bg-act-3' : pct >= 20 ? 'bg-act-2' : 'bg-act-1';
}

export function ActivityPage({ s }: { s: AgentState }) {
  const [date, setDate] = useState(today());
  const q = useMe<ActivityDayDto>('activity', { date }, { refreshMs: date === today() ? 120_000 : undefined });
  const d = q.data;
  const hours = useMemo(() => {
    const m = new Map<number, ActivityDayDto['blocks']>();
    for (const b of d?.blocks ?? []) {
      const h = new Date(b.window_start).getHours();
      m.set(h, [...(m.get(h) ?? []), b]);
    }
    return [...m.entries()].sort(([a], [b]) => a - b);
  }, [d]);
  return (
    <Page
      title="Activity"
      description="Your own activity in 10-minute blocks. Keystrokes are counted, never recorded."
      actions={<Stepper label={date === today() ? 'Today' : fmtDay(date)} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} nextDisabled={date >= today()} />}
    >
      <Status loading={q.loading && !d} error={d ? null : q.error} onRetry={q.reload}>
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
              <Stat icon={Clock3} color="blue" label="Tracked" value={fmtHm(d.total_seconds)} />
              <Stat icon={Activity} color="green" label="Average activity" value={d.blocks.length ? `${d.avg_activity_pct}%` : '—'} />
              <Stat icon={LayoutGrid} color="teal" label="Blocks" value={String(d.blocks.length)} hint="10-minute blocks with time" />
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px] md:gap-4">
              <Card title="Blocks">
                <Status loading={false} error={null} empty={!hours.length && 'No tracked time on this day.'}>
                  <div className="flex flex-col gap-3 p-3">
                    {hours.map(([h, blocks]) => (
                      <div key={h}>
                        <div className="mb-1 text-2xs font-semibold text-text-muted">{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</div>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                          {blocks.map((b) => (
                            <div key={b.window_start} className="rounded-sm border border-border px-2 py-1.5" title={`${fmtTime(b.window_start)} · ${b.project_name}`}>
                              <div className="flex items-center justify-between gap-1">
                                <span className="tabular text-2xs text-text-muted">{fmtTime(b.window_start)}</span>
                                {b.idle && <PauseCircle className="size-3 text-warning" aria-label="Includes away time" />}
                                {b.manual && <PenLine className="size-3 text-info" aria-label="Added by hand" />}
                              </div>
                              {b.manual ? (
                                <div className="mt-1 text-2xs text-text-faint">By hand</div>
                              ) : (
                                <>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                                    <div className={`h-full ${actColor(b.activity_pct)}`} style={{ width: `${b.activity_pct}%` }} />
                                  </div>
                                  <div className="tabular mt-0.5 text-2xs font-semibold">{b.activity_pct}%</div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Status>
              </Card>
              <div className="flex flex-col gap-3 md:gap-4">
                <UsageList title="Apps" rows={d.apps} empty={s.policy?.apps.enabled ? 'No apps recorded.' : 'Not recorded by your organization.'} />
                <UsageList title="Websites" rows={d.urls} empty={s.policy?.urls.enabled ? 'No websites recorded.' : 'Not recorded by your organization.'} />
              </div>
            </div>
          </>
        )}
      </Status>
    </Page>
  );
}

function UsageList({ title, rows, empty }: { title: string; rows: Array<{ name: string; seconds: number }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5 px-4 py-3">
          {rows.slice(0, 8).map((r) => (
            <li key={r.name}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{r.name}</span>
                <span className="tabular shrink-0 text-text-muted">{fmtHm(r.seconds)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-act-4" style={{ width: `${(r.seconds / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Reports (personal) ──────────────────────────────────────────────────────

type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month';

function presetRange(p: Preset): { from: string; to: string } {
  const t = today();
  const ws = weekStartOf(t);
  const d = new Date(`${t}T12:00:00`);
  const monthStart = localDateInput(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  if (p === 'this_week') return { from: ws, to: t };
  if (p === 'last_week') return { from: addDays(ws, -7), to: addDays(ws, -1) };
  if (p === 'this_month') return { from: monthStart, to: t };
  return { from: localDateInput(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)), to: addDays(monthStart, -1) };
}

export function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('this_week');
  const range = presetRange(preset);
  const q = useMe<SummaryDto>('summary', range);
  const r = q.data;
  const maxDay = Math.max(1, ...(r?.days.map((d) => d.seconds) ?? [0]));
  const total = r?.worked_seconds ?? 0;
  return (
    <Page
      title="Reports"
      description="Your personal totals. Only your own time is included."
      actions={
        <select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="h-9 rounded-sm border border-border bg-surface px-2 text-sm">
          <option value="this_week">This week</option>
          <option value="last_week">Last week</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
        </select>
      }
    >
      <Status loading={q.loading && !r} error={r ? null : q.error} onRetry={q.reload}>
        {r && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <Stat icon={Clock3} color="blue" label="Worked" value={fmtHm(r.worked_seconds)} hint={`${fmtDay(r.from, { month: 'short', day: 'numeric' })} – ${fmtDay(r.to, { month: 'short', day: 'numeric' })}`} />
              <Stat icon={PenLine} color="violet" label="Added by hand" value={fmtHm(r.manual_seconds)} />
              <Stat icon={Activity} color="green" label="Activity" value={r.activity_pct != null ? `${r.activity_pct}%` : '—'} />
              <Stat icon={Coffee} color="amber" label="Away time" value={fmtHm(r.idle_seconds)} tone={r.idle_seconds > 0 ? 'warning' : undefined} />
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px] md:gap-4">
              <Card title="Hours by day">
                <div className="flex h-48 items-end gap-1 px-4 pb-2 pt-4" role="img" aria-label="Hours worked per day">
                  {r.days.map((d) => (
                    <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${fmtDay(d.date)} · ${fmtHm(d.seconds)}`}>
                      <div className={`w-full max-w-10 rounded-t-[6px] ${d.seconds ? 'bg-gradient-to-t from-[#3b5bff] to-[#7c5cff]' : 'bg-surface-sunken'}`} style={{ height: d.seconds ? `${Math.max(3, (d.seconds / maxDay) * 100)}%` : '2px' }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 px-4 pb-3">
                  {r.days.map((d, i) => (
                    <span key={d.date} className="min-w-0 flex-1 truncate text-center text-2xs text-text-faint">
                      {r.days.length <= 7 ? fmtDay(d.date, { weekday: 'short' }) : i % 5 === 0 ? fmtDay(d.date, { day: 'numeric' }) : ''}
                    </span>
                  ))}
                </div>
              </Card>
              <Card title="By project">
                <Status loading={false} error={null} empty={!r.projects.length && 'No time in this period.'}>
                  <ul className="flex flex-col gap-3 px-4 py-3">
                    {r.projects.map((p) => (
                      <li key={p.project_id}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">{p.project_name}</span>
                          <span className="tabular shrink-0">
                            <span className="font-semibold">{fmtHm(p.seconds)}</span>
                            <span className="ml-1 text-2xs text-text-muted">{total ? Math.round((p.seconds / total) * 100) : 0}%</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <div className="h-full rounded-full" style={{ width: `${total ? (p.seconds / total) * 100 : 0}%`, background: p.color }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Status>
              </Card>
            </div>
          </>
        )}
      </Status>
    </Page>
  );
}

// ─── Time Off ────────────────────────────────────────────────────────────────

const TO_TONE: Record<TimeOffDto['requests'][number]['status'], 'success' | 'warning' | 'danger' | 'neutral'> = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'danger', CANCELLED: 'neutral' };

export function TimeOffPage() {
  const q = useMe<TimeOffDto>('time-off');
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const d = q.data;
  return (
    <Page
      title="Time Off"
      description="Your balances and requests."
      actions={
        d &&
        d.balances.length > 0 && (
          <button onClick={() => (setSent(false), setOpen((o) => !o))} className={primary}>
            <CalendarPlus className="size-4" /> Request time off
          </button>
        )
      }
    >
      <Status loading={q.loading && !d} error={d ? null : q.error} onRetry={q.reload} empty={!!d && !d.balances.length && 'No time-off policy applies to you. Ask your administrator.'}>
        {d && (
          <>
            {sent && !open && <p className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">Request sent — your manager will review it. You can see its status under “Your requests”.</p>}
            {open && <TimeOffForm d={d} onDone={() => (setOpen(false), setSent(true), q.reload())} onCancel={() => setOpen(false)} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 md:gap-4">
              {d.balances.map((b) => (
                <div key={b.policy_id} className={`${card} px-4 py-3`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{b.policy_name}</span>
                    <Badge tone="neutral">{b.paid ? 'Paid' : 'Unpaid'}</Badge>
                  </div>
                  <div className="tabular mt-2 text-xl font-semibold">{b.balance_hours === null ? 'Unlimited' : `${fmtHours(b.balance_hours)} h`}</div>
                  <div className="tabular text-2xs text-text-muted">
                    {fmtHours(b.used_hours)} h used · {fmtHours(b.pending_hours)} h pending
                  </div>
                </div>
              ))}
            </div>
            <Card title="Your requests">
              <Status loading={false} error={null} empty={!d.requests.length && 'You have not requested time off yet.'}>
                <ul className="divide-y divide-border">
                  {d.requests.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {r.policy_name} · {r.start_date === r.end_date ? fmtDay(r.start_date) : `${fmtDay(r.start_date)} – ${fmtDay(r.end_date)}`}
                          {r.half_day ? ' (half day)' : ''}
                        </span>
                        <span className="block truncate text-2xs text-text-muted">
                          {fmtHours(r.hours)} h{r.reason ? ` · ${r.reason}` : ''}
                          {r.decided_by_name ? ` · ${r.status.toLowerCase()} by ${r.decided_by_name}` : ''}
                          {r.decision_comment ? ` · “${r.decision_comment}”` : ''}
                        </span>
                      </span>
                      <Badge tone={TO_TONE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              </Status>
            </Card>
          </>
        )}
      </Status>
    </Page>
  );
}

function fmtHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function TimeOffForm({ d, onDone, onCancel }: { d: TimeOffDto; onDone: () => void; onCancel: () => void }) {
  const [policy, setPolicy] = useState(d.balances[0]!.policy_id);
  const [start, setStart] = useState(addDays(today(), 1));
  const [end, setEnd] = useState(addDays(today(), 1));
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await bridge.requestTimeOff({ policy_id: policy, start_date: start, end_date: end, half_day: start === end && half, reason: reason.trim() || undefined });
      onDone();
    } catch (e) {
      setError(errorText(e, 'Could not send the request'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Request time off">
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-text-muted">
          Type
          <select value={policy} onChange={(e) => setPolicy(e.target.value)} className={field}>
            {d.balances.map((b) => (
              <option key={b.policy_id} value={b.policy_id}>
                {b.policy_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-text-muted">
          From
          <input type="date" value={start} onChange={(e) => (setStart(e.target.value), e.target.value > end && setEnd(e.target.value))} className={field} />
        </label>
        <label className="block text-xs text-text-muted">
          To
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={half && start === end} disabled={start !== end} onChange={(e) => setHalf(e.target.checked)} className="size-4 accent-[var(--tw-interactive)]" />
          Half day
        </label>
        <label className="block text-xs text-text-muted sm:col-span-2 lg:col-span-4">
          Reason (optional)
          <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family event" className={field} />
        </label>
      </div>
      {error && <p className="mx-4 mb-3 rounded-sm bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button onClick={onCancel} className={btn}>
          Cancel
        </button>
        <button onClick={() => void submit()} disabled={busy || !start || !end} className={primary}>
          <Check className="size-4" /> Send request
        </button>
      </div>
    </Card>
  );
}

// ─── Pay Stubs ───────────────────────────────────────────────────────────────

function fmtMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat([], { style: 'currency', currency }).format(minor / 100);
}

export function PayStubsPage() {
  const q = useMe<PayStubDto[]>('pay-stubs');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await bridge.savePayStub(id);
    } catch (e) {
      setError(errorText(e, 'Could not download the pay stub'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Page title="Pay Stubs" description="Your pay for each finalized payroll.">
      {error && <p className="rounded-sm bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      <Card title="Pay stubs">
        <Status loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload} empty={!!q.data && !q.data.length && 'No pay stubs yet. They appear here when a payroll that includes you is finalized.'}>
          <ul className="divide-y divide-border">
            {q.data?.map((p) => {
              const adjustments = p.adjustments.reduce((sum, a) => sum + a.amount_minor, 0);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="tabular block truncate text-sm font-medium">
                      {fmtDay(p.period_start, { month: 'short', day: 'numeric', year: 'numeric' })} – {fmtDay(p.period_end, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className="tabular block truncate text-2xs text-text-muted">
                      {p.profile_name} · {fmtHm(p.approved_seconds)}
                      {p.time_off_hours ? ` · ${fmtHours(p.time_off_hours)} h time off` : ''} · Gross {fmtMoney(p.gross_minor, p.currency)}
                      {adjustments ? ` · Adjustments ${adjustments > 0 ? '+' : ''}${fmtMoney(adjustments, p.currency)}` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block text-sm font-semibold">{fmtMoney(p.net_minor, p.currency)}</span>
                    <span className="block text-2xs text-text-muted">Net pay</span>
                  </span>
                  <Badge tone={p.status === 'PAID' ? 'success' : 'info'}>{p.status === 'PAID' ? 'Paid' : 'Finalized'}</Badge>
                  <button onClick={() => void save(p.id)} disabled={busy !== null} className={btn}>
                    <Download className="size-4" /> {busy === p.id ? 'Downloading…' : 'PDF'}
                  </button>
                </li>
              );
            })}
          </ul>
        </Status>
      </Card>
    </Page>
  );
}

// ─── Schedule ────────────────────────────────────────────────────────────────

export function SchedulePage() {
  const from = weekStartOf(today());
  const q = useMe<ShiftDto[]>('schedule', { from, to: addDays(from, 13) });
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const byDay = useMemo(() => {
    const m = new Map<string, ShiftDto[]>();
    for (const x of q.data ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x]);
    return m;
  }, [q.data]);
  const weekSeconds = (start: string) =>
    days
      .filter((d) => d >= start && d < addDays(start, 7))
      .flatMap((d) => byDay.get(d) ?? [])
      .reduce((sum, x) => sum + (Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 1000, 0);
  return (
    <Page title="Schedule" description="Your shifts for this week and next.">
      <Status loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload} empty={!!q.data && !q.data.length && 'You have no scheduled shifts. Your manager sets your schedule.'}>
        <div className="grid gap-3 md:gap-4 lg:grid-cols-2">
          {[from, addDays(from, 7)].map((ws, wi) => (
            <Card key={ws} title={wi === 0 ? 'This week' : 'Next week'} right={<span className="tabular text-sm font-semibold">{fmtHm(weekSeconds(ws))}</span>}>
              <ul className="divide-y divide-border">
                {days.slice(wi * 7, wi * 7 + 7).map((d) => {
                  const shifts = byDay.get(d) ?? [];
                  const isToday = d === today();
                  return (
                    <li key={d} className={`flex items-center gap-3 px-4 py-2.5 ${isToday ? 'bg-interactive-soft/50' : ''}`}>
                      <span className={`w-24 shrink-0 text-sm ${isToday ? 'font-semibold text-interactive' : ''}`}>{fmtDay(d)}</span>
                      <span className="min-w-0 flex-1 text-sm">
                        {shifts.length ? (
                          shifts.map((x) => (
                            <span key={x.starts_at} className="tabular mr-3 inline-block">
                              {fmtTime(x.starts_at)} – {fmtTime(x.ends_at)}
                              {x.kind === 'ONE_OFF' && <span className="ml-1 text-2xs text-text-muted">(extra)</span>}
                            </span>
                          ))
                        ) : (
                          <span className="text-text-faint">Day off</span>
                        )}
                      </span>
                      {isToday && <Badge tone="info">Today</Badge>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </Status>
    </Page>
  );
}

