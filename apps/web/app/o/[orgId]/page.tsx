'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw } from 'lucide-react';
import type { CurrentTrackingDto, LiveWorkerDto, SessionDto, WorkerDto } from '@tallywork/contracts';
import {
  ActivityBar,
  Avatar,
  BudgetProgress,
  Button,
  EmptyState,
  KpiStrip,
  PageHeader,
  Panel,
  PersonCell,
  SegmentedControl,
  Select,
  Spinner,
  StatusBadge,
  WorkerStatus,
  cx,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtTime,
  useToast,
} from '@tallywork/ui';
import { api, errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrgStream } from '@/lib/stream';
import { useOrg } from '@/lib/org';
import { useCurrentTracking, useLiveSeconds } from '@/components/shell/timer-bar';
import { StackedBars } from '@/components/charts';

type Size = 'S' | 'M' | 'L';
interface WidgetCfg {
  key: string;
  size: Size;
}
interface Layout {
  scope: 'ALL' | 'ME' | 'WORKER';
  widgets: WidgetCfg[];
  customized: boolean;
  available: string[];
}

const TITLES: Record<string, string> = {
  current_timer: 'Current timer',
  worked_today: 'Worked today',
  tracked_week: 'This week',
  active_workers: 'Who is working',
  activity: 'Activity',
  hours_by_project: 'Hours by project this week',
  timesheets_to_approve: 'Waiting for approval',
  my_timesheet: 'My timesheet',
  project_budgets: 'Project budgets',
  recent_screenshots: 'Recent screenshots',
  recent_sessions: 'Recent sessions',
  time_off_requests: 'Time off requests',
  upcoming_time_off: 'Upcoming time off',
  attendance_today: 'Attendance today',
  invoices: 'Invoices',
  assigned_tasks: 'My tasks',
  weekly_limits: 'Weekly limits',
  devices_offline: 'Devices needing attention',
  month_summary: 'This month',
  hours_by_client: 'Hours by client this month',
};
const SPAN: Record<Size, string> = { S: 'lg:col-span-4', M: 'lg:col-span-6', L: 'lg:col-span-12' };

export default function OverviewPage() {
  const org = useOrg();
  const toast = useToast();
  const [scope, setScope] = useState<'ALL' | 'ME' | 'WORKER'>(org.isManagerView ? 'ALL' : 'ME');
  const [worker, setWorker] = useState<string>('');
  const [editing, setEditing] = useState(false);
  useOrgStream(['/dashboard/widgets']);
  const layoutQ = useOrgQuery<Layout>(`/dashboard/layout?scope=${scope}`);
  const [draft, setDraft] = useState<WidgetCfg[] | null>(null);
  const widgets = draft ?? layoutQ.data?.widgets ?? [];
  const keys = widgets.map((w) => w.key).join(',');
  const dataQ = useOrgQuery<Record<string, any>>(keys ? `/dashboard/widgets${qs({ keys, scope, membership_id: scope === 'WORKER' ? worker : undefined })}` : null, { refetchInterval: 120_000, enabled: !!keys && (scope !== 'WORKER' || !!worker) });
  const workersQ = useOrgQuery<WorkerDto[]>(org.isManagerView ? '/workers' : null);

  useEffect(() => {
    try {
      localStorage.setItem('tw.lastOrg', org.organization.id);
    } catch {
      /* ignore */
    }
  }, [org.organization.id]);
  useEffect(() => setDraft(null), [scope]);

  const save = async () => {
    try {
      await api(`/orgs/${org.organization.id}/dashboard/layout`, { method: 'PUT', body: { scope, widgets: draft ?? widgets } });
      await layoutQ.refetch();
      setDraft(null);
      setEditing(false);
      toast.success('Dashboard saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reset = async () => {
    await api(`/orgs/${org.organization.id}/dashboard/layout?scope=${scope}`, { method: 'DELETE' });
    await layoutQ.refetch();
    setDraft(null);
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...widgets];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setDraft(next);
  };
  const hidden = (layoutQ.data?.available ?? []).filter((k) => !widgets.some((w) => w.key === k));
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);

  return (
    <>
      <PageHeader
        title={org.isManagerView ? 'Overview' : 'Today'}
        description={org.isManagerView ? `${greeting}. Here is what needs attention across ${scope === 'ME' ? 'your own work' : 'your organization'}.` : `${greeting}. Your time and tasks at a glance.`}
        actions={
          <>
            {org.isManagerView && (
              <SegmentedControl
                label="Dashboard scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'ALL', label: org.grants['tracking:read'] === 'team' ? 'Team' : 'All' },
                  { value: 'ME', label: 'Me' },
                  { value: 'WORKER', label: 'Member' },
                ]}
              />
            )}
            {scope === 'WORKER' && (
              <Select value={worker} onChange={(e) => setWorker(e.target.value)} className="w-48" aria-label="Member">
                <option value="">Choose a member…</option>
                {workersQ.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
            {editing ? (
              <>
                <Button icon={<RotateCcw className="size-3.5" />} onClick={reset}>
                  Reset
                </Button>
                <Button onClick={() => (setDraft(null), setEditing(false))}>Cancel</Button>
                <Button variant="primary" onClick={save}>
                  Save layout
                </Button>
              </>
            ) : (
              <Button icon={<LayoutGrid className="size-3.5" />} onClick={() => setEditing(true)}>
                Customize
              </Button>
            )}
          </>
        }
      />

      {scope === 'WORKER' && !worker ? (
        <Panel>
          <EmptyState title="Pick a member" description="See one person's dashboard exactly as their manager would." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {widgets.map((w, i) => (
            <div key={w.key} className={cx('min-w-0', SPAN[w.size])}>
              <Panel
                className={cx('h-full', editing && 'ring-2 ring-interactive/30')}
                title={TITLES[w.key] ?? w.key}
                actions={
                  editing ? (
                    <>
                      <SegmentedControl size="xs" label="Widget size" value={w.size} onChange={(size) => setDraft(widgets.map((x) => (x.key === w.key ? { ...x, size } : x)))} options={[{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'L' }]} />
                      <Button size="xs" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button size="xs" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === widgets.length - 1}>
                        <ArrowDown className="size-3" />
                      </Button>
                      <Button size="xs" variant="ghost" aria-label="Hide widget" onClick={() => setDraft(widgets.filter((x) => x.key !== w.key))}>
                        <EyeOff className="size-3" />
                      </Button>
                    </>
                  ) : undefined
                }
              >
                {dataQ.isLoading ? (
                  <div className="flex h-28 items-center justify-center">
                    <Spinner />
                  </div>
                ) : (
                  <Widget k={w.key} data={dataQ.data?.[w.key]} />
                )}
              </Panel>
            </div>
          ))}
          {editing && hidden.length > 0 && (
            <div className="lg:col-span-12">
              <Panel title="Hidden widgets">
                <div className="flex flex-wrap gap-2 p-4">
                  {hidden.map((k) => (
                    <Button key={k} size="sm" icon={<Eye className="size-3.5" />} onClick={() => setDraft([...widgets, { key: k, size: 'M' }])}>
                      {TITLES[k] ?? k}
                    </Button>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Widget({ k, data }: { k: string; data: any }) {
  const org = useOrg();
  const b = org.base;
  const d = org.fmtDuration;
  if (data === undefined) return <EmptyState title="Not available" description="You do not have access to this widget's data." />;
  switch (k) {
    case 'current_timer':
      return <CurrentTimerWidget />;
    case 'worked_today':
      return (
        <KpiStrip
          className="rounded-none border-0"
          items={[
            { label: 'Worked today', value: d(data.seconds) },
            { label: 'Members tracking today', value: data.workers },
            { label: 'Billable today', value: d(data.billable_seconds) },
          ]}
        />
      );
    case 'tracked_week': {
      const delta = data.previous_seconds ? Math.round(((data.seconds - data.previous_seconds) / data.previous_seconds) * 100) : null;
      const max = Math.max(1, ...data.by_day.map((x: { seconds: number }) => x.seconds));
      return (
        <div className="p-4">
          <div className="flex items-baseline gap-3">
            <span className="tabular text-2xl font-semibold tracking-tight">{d(data.seconds)}</span>
            {delta !== null && <span className={cx('text-xs', delta >= 0 ? 'text-success' : 'text-text-muted')}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs last week</span>}
          </div>
          <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label="Hours per day this week">
            {data.by_day.map((x: { date: string; seconds: number }) => (
              <div key={x.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t-[2px] bg-secondary" style={{ height: `${(x.seconds / max) * 100}%`, minHeight: x.seconds ? 2 : 0 }} title={`${fmtDate(x.date)}: ${d(x.seconds)}`} />
                </div>
                <span className="text-2xs text-text-faint">{fmtDate(x.date, { weekday: 'narrow' })}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-text-muted">Billable {d(data.billable_seconds)}</div>
        </div>
      );
    }
    case 'activity':
      return (
        <div className="flex items-center gap-4 p-4">
          <span className="tabular text-2xl font-semibold">{data.pct ?? '—'}{data.pct !== null && '%'}</span>
          <div className="text-xs text-text-muted">
            Average activity this week
            {data.previous_pct !== null && <div>Last week {data.previous_pct}%</div>}
          </div>
        </div>
      );
    case 'month_summary': {
      const t = data.totals;
      const money = (m: number | null) => (m === null ? '—' : fmtMoney(m, data.currency));
      return (
        <div>
          <KpiStrip
            className="rounded-none border-0"
            items={[
              { label: 'Time logged', value: d(t.logged_seconds), hint: `${t.people_with_time} ${t.people_with_time === 1 ? 'person' : 'people'}` },
              ...(data.money_visible ? [{ label: 'Est. pay', value: money(t.pay_minor), hint: 'From pay rates; final after approval' }] : []),
              { label: 'Billable time', value: d(t.billable_seconds), hint: `${t.billable_clients} ${t.billable_clients === 1 ? 'client' : 'clients'}, ${t.billable_projects} ${t.billable_projects === 1 ? 'project' : 'projects'}` },
              ...(data.money_visible ? [{ label: 'Est. billable', value: money(t.bill_minor), hint: 'From bill rates; final after approval' }] : []),
            ]}
          />
          <Link href={`${b}/insights`} className="block border-t border-border px-4 py-2 text-xs font-medium text-interactive hover:underline">
            Open insights →
          </Link>
        </div>
      );
    }
    case 'hours_by_client':
      return data.length ? (
        <div className="p-4">
          <StackedBars rows={data.map((c: { name: string; seconds: number }) => ({ label: c.name, value: c.seconds }))} format={d} />
        </div>
      ) : (
        <EmptyState title="No time tracked this month" />
      );
    case 'hours_by_project':
      return data.length ? (
        <div className="p-4">
          <StackedBars rows={data.map((p: { name: string; seconds: number; color: string }) => ({ label: p.name, value: p.seconds, color: p.color }))} format={d} />
        </div>
      ) : (
        <EmptyState title="No time tracked this week" />
      );
    case 'active_workers':
      return (
        <div>
          <div className="flex gap-6 border-b border-border px-4 py-2.5 text-sm">
            <span>
              <span className="tabular font-semibold text-success">{data.working}</span> working
            </span>
            <span>
              <span className="tabular font-semibold text-warning">{data.idle}</span> idle
            </span>
            <span className="text-text-muted">of {data.total}</span>
          </div>
          <ul className="divide-y divide-border">
            {(data.workers as LiveWorkerDto[]).slice(0, 8).map((w) => (
              <li key={w.membership_id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <PersonCell name={w.name} sub={w.project_name ? `${w.project_name}${w.task_title ? ` / ${w.task_title}` : ''}` : 'Not tracking'} />
                </div>
                <ActivityBar pct={w.activity_pct} />
                <span className="tabular w-16 text-right text-xs text-text-muted">{d(w.today_seconds)}</span>
                <WorkerStatus status={w.status} />
              </li>
            ))}
          </ul>
          <Link href={`${b}/tracking/live`} className="block border-t border-border px-4 py-2 text-xs font-medium text-interactive hover:underline">
            Open live view →
          </Link>
        </div>
      );
    case 'timesheets_to_approve':
      return (
        <div className="grid grid-cols-2 divide-x divide-border">
          <Link href={`${b}/timesheets/approvals`} className="p-4 hover:bg-surface-muted">
            <div className="tabular text-2xl font-semibold">{data.timesheets}</div>
            <div className="text-xs text-text-muted">timesheets to review</div>
          </Link>
          <Link href={`${b}/timesheets/manual`} className="p-4 hover:bg-surface-muted">
            <div className="tabular text-2xl font-semibold">{data.manual_time}</div>
            <div className="text-xs text-text-muted">manual time requests</div>
          </Link>
        </div>
      );
    case 'my_timesheet':
      return (
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <StatusBadge status={data.status} />
            <div className="mt-1 text-xs text-text-muted">{data.period_start ? `${fmtDate(data.period_start)} – ${fmtDate(data.period_end)}` : 'Current period'}</div>
            {data.comment && <div className="mt-1 text-xs text-danger">“{data.comment}”</div>}
          </div>
          <Link href={`${b}/timesheets`} className="text-sm font-medium text-interactive hover:underline">
            Open
          </Link>
        </div>
      );
    case 'project_budgets':
      return data.length ? (
        <ul className="divide-y divide-border">
          {data.map((x: any) => (
            <li key={x.id} className="px-4 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{x.subject_name}</span>
                <span className="tabular shrink-0 text-xs text-text-muted">
                  {x.kind === 'HOURS' ? `${d(x.spent)} / ${d(x.amount)}` : x.amounts_hidden ? 'Money budget' : `${fmtMoney(x.spent, x.currency)} billed / ${fmtMoney(x.amount, x.currency)}`} · {Math.round(x.pct_used)}%
                </span>
              </div>
              <BudgetProgress pct={x.pct_used} state={x.state} projectedPct={x.projected ? (x.projected / x.amount) * 100 : null} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No budgets yet" action={<Link href={`${b}/finance/budgets`} className="text-sm text-interactive hover:underline">Set a budget</Link>} />
      );
    case 'recent_screenshots':
      return data.length ? (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          {data.map((s: any) => (
            <Link key={s.id} href={`${b}/activity?member=${s.membership_id}&date=${s.captured_at.slice(0, 10)}`} className="group block overflow-hidden rounded-sm border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb_url} alt={`Screenshot of ${s.worker_name} at ${fmtTime(s.captured_at)}`} className={cx('aspect-[16/10] w-full object-cover transition-opacity group-hover:opacity-90', s.blurred && 'blur-[2px]')} loading="lazy" />
              <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-2xs text-text-muted">
                <span className="truncate">{s.worker_name}</span>
                <span className="tabular">{fmtTime(s.captured_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No screenshots" description="Screenshots appear when enabled by your tracking policy." />
      );
    case 'recent_sessions':
      return data.length ? (
        <ul className="divide-y divide-border">
          {(data as SessionDto[]).map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {s.worker_name && <span className="font-medium">{s.worker_name} · </span>}
                {s.project_name}
                {s.task_title && <span className="text-text-muted"> / {s.task_title}</span>}
              </span>
              <span className="text-xs text-text-muted">{fmtDateTime(s.started_at)}</span>
              <span className="tabular w-14 text-right text-xs font-medium">{d(s.worked_seconds)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No sessions this week" />
      );
    case 'time_off_requests':
    case 'upcoming_time_off':
      return data.length ? (
        <ul className="divide-y divide-border">
          {data.map((r: any) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <Avatar name={r.worker_name} size={22} />
              <span className="min-w-0 flex-1 truncate">{r.worker_name}</span>
              <span className="text-xs text-text-muted">
                {fmtDate(r.start_date, { month: 'short', day: 'numeric' })}
                {r.end_date !== r.start_date && ` – ${fmtDate(r.end_date, { month: 'short', day: 'numeric' })}`}
              </span>
              <StatusBadge status={r.status} />
            </li>
          ))}
          <li>
            <Link href={`${b}/time-off`} className="block px-4 py-2 text-xs font-medium text-interactive hover:underline">
              Open time off →
            </Link>
          </li>
        </ul>
      ) : (
        <EmptyState title={k === 'time_off_requests' ? 'No pending requests' : 'Nobody is out soon'} />
      );
    case 'attendance_today':
      return (
        <div>
          <div className="grid grid-cols-4 divide-x divide-border border-b border-border text-center">
            {(['present', 'late', 'absent', 'on_leave'] as const).map((key) => (
              <div key={key} className="px-2 py-3">
                <div className={cx('tabular text-xl font-semibold', key === 'late' && data[key] ? 'text-warning' : key === 'absent' && data[key] ? 'text-danger' : '')}>{data[key]}</div>
                <div className="text-2xs uppercase tracking-wide text-text-muted">{key.replace('_', ' ')}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-border">
            {data.rows.map((r: any) => (
              <li key={r.membership_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.worker_name}</span>
                <StatusBadge status={r.status} />
                {r.late_seconds > 0 && <span className="tabular text-xs text-text-muted">{d(r.late_seconds)} late</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'invoices':
      return (
        <div className="grid grid-cols-2 divide-x divide-border">
          <Link href={`${b}/finance/invoices`} className="p-4 hover:bg-surface-muted">
            <div className="tabular text-xl font-semibold">{fmtMoney(data.outstanding_minor, data.currency)}</div>
            <div className="text-xs text-text-muted">outstanding · {data.draft_count} draft</div>
          </Link>
          <Link href={`${b}/finance/invoices?status=OVERDUE`} className="p-4 hover:bg-surface-muted">
            <div className={cx('tabular text-xl font-semibold', data.overdue_count && 'text-danger')}>{fmtMoney(data.overdue_minor, data.currency)}</div>
            <div className="text-xs text-text-muted">{data.overdue_count} overdue</div>
          </Link>
        </div>
      );
    case 'assigned_tasks':
      return data.length ? (
        <ul className="divide-y divide-border">
          {data.map((t: any) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <StatusBadge status={t.status} />
              <span className="min-w-0 flex-1 truncate">
                {t.title}
                <span className="text-text-muted"> · {t.project_name}</span>
              </span>
              {t.due_date && <span className="text-xs text-text-muted">due {fmtDate(t.due_date, { month: 'short', day: 'numeric' })}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No open tasks assigned to you" />
      );
    case 'devices_offline':
      return data.length ? (
        <ul className="divide-y divide-border">
          {data.map((x: any) => (
            <li key={x.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{x.name}</span>
              <span className="text-xs text-text-muted">last seen {x.last_seen_at ? fmtDateTime(x.last_seen_at) : 'never'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="All devices checked in recently" />
      );
    default:
      return <EmptyState title="Coming soon" />;
  }
}

function CurrentTimerWidget() {
  const org = useOrg();
  const { data, fetchedAt } = useCurrentTracking();
  const live = useLiveSeconds(data as CurrentTrackingDto | undefined, fetchedAt);
  const s = data?.session;
  return (
    <div className="p-5">
      <div className="flex items-center justify-between">
        <StatusBadge status={s ? (s.state === 'ACTIVE' ? 'TRACKING' : s.state) : 'STOPPED'} label={s ? undefined : 'Not tracking'} />
        {s && <span className="text-xs text-text-muted">{s.source === 'DESKTOP' ? 'Desktop app' : 'Web timer'}</span>}
      </div>
      <div className="tabular mt-3 font-mono text-4xl font-medium tracking-tight">{new Date((s ? live.session : 0) * 1000).toISOString().slice(11, 19)}</div>
      <div className="mt-1 truncate text-sm text-text-muted">{s ? `${s.project_name}${s.task_title ? ` / ${s.task_title}` : ''}` : 'No timer running.'}</div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
        <div>
          <div className="text-xs text-text-muted">Today</div>
          <div className="tabular font-semibold">{org.fmtDuration(live.today)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">This week</div>
          <div className="tabular font-semibold">{org.fmtDuration(live.week)}</div>
        </div>
      </div>
    </div>
  );
}
