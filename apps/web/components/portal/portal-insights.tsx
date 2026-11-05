'use client';
import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Flag, Heart } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Field, KpiStrip, Panel, Select, SkeletonRows, Textarea, cx, fmtDate, fmtPct, type Kpi } from '@tallywork/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { ColumnChart } from '@/components/charts-lazy';
import { t } from '@/lib/i18n';
import '@/components/performance/messages/portal-insights';

/** GET /portal/:accessId/insights (packages/api/src/services/portal-insights.ts). Delivery facts only. */
interface PortalInsights {
  totals: { completion_pct: number | null; tasks_done: number | null; tasks_open: number | null; tasks_done_this_week: number | null; milestones_done: number; milestones_total: number; on_time_pct: number | null; next_milestone: { title: string; due_date: string } | null };
  projects: Array<{ id: string; name: string; color: string | null; status: string; completion_pct: number | null; tasks: { done: number; open: number } | null; milestones: { done: number; total: number; on_time: number; due: number }; delivery: 'DONE' | 'BEHIND' | 'ON_TRACK' | null; next_milestone: { title: string; due_date: string } | null }>;
  milestones: Array<{ id: string; project_id: string; title: string; due_date: string; status: 'DONE' | 'IN_PROGRESS' | 'PLANNED'; on_time: boolean | null; overdue: boolean }>;
  weeks: Array<{ start: string; tasks_done: number }>;
  contributors: Array<{ membership_id: string; name: string; project_id: string }>;
}

/**
 * The client portal's Insights tab: how the client's own projects are being delivered, and a way to
 * thank the team (held for the organization's review). Loaded when the tab opens.
 */
export default function PortalInsightsTab({ accessId }: { accessId: string }) {
  const q = useQuery({ queryKey: ['portal', accessId, 'insights'], queryFn: () => api<PortalInsights>(`/portal/${accessId}/insights`) });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d)
    return (
      <div role="status" aria-label={t('portal.ins.loading')}>
        <SkeletonRows rows={6} cols={3} />
      </div>
    );
  const k = d.totals;
  const kpis: Kpi[] = [
    { label: t('portal.ins.kpi.completion'), value: <span className="tabular">{fmtPct(k.completion_pct)}</span>, hint: t('portal.ins.kpi.completionHint') },
    ...(k.tasks_done !== null ? [{ label: t('portal.ins.kpi.tasksDone'), value: <span className="tabular">{k.tasks_done}</span>, hint: t('portal.ins.kpi.tasksDoneHint', { n: k.tasks_done_this_week ?? 0 }) }] : []),
    ...(k.tasks_open !== null ? [{ label: t('portal.ins.kpi.tasksOpen'), value: <span className="tabular">{k.tasks_open}</span> }] : []),
    { label: t('portal.ins.kpi.milestones'), value: <span className="tabular">{t('portal.ins.xOfY', { x: k.milestones_done, y: k.milestones_total })}</span>, hint: k.next_milestone ? t('portal.ins.kpi.next', { title: k.next_milestone.title, date: fmtDate(k.next_milestone.due_date) }) : undefined },
    { label: t('portal.ins.kpi.onTime'), value: <span className="tabular">{fmtPct(k.on_time_pct)}</span>, hint: t('portal.ins.kpi.onTimeHint') },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t('portal.ins.intro')}</p>
      <KpiStrip items={kpis} minItemWidth={170} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel bodyClassName="p-4" title={t('portal.ins.projects')}>
          {d.projects.length === 0 ? (
            <EmptyState title={t('portal.ins.projectsEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {d.projects.map((p) => (
                <li key={p.id} className="space-y-1.5 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: p.color ?? 'var(--color-chart-1)' }} />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    {p.delivery && <Badge tone={p.delivery === 'DONE' ? 'success' : p.delivery === 'BEHIND' ? 'warning' : 'info'}>{t(`portal.ins.delivery.${p.delivery}`)}</Badge>}
                  </div>
                  {p.completion_pct !== null && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={t('portal.ins.completeLabel', { project: p.name, pct: Math.round(p.completion_pct) })}>
                      <div className="h-full rounded-full bg-interactive" style={{ width: `${Math.max(0, Math.min(100, p.completion_pct))}%` }} />
                    </div>
                  )}
                  <p className="text-xs text-text-muted">
                    {[p.completion_pct !== null ? t('portal.ins.complete', { pct: Math.round(p.completion_pct) }) : null, p.milestones.total ? t('portal.ins.projectMilestones', { done: p.milestones.done, total: p.milestones.total }) : null, p.tasks ? t('portal.ins.projectTasks', { done: p.tasks.done, open: p.tasks.open }) : null].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <MilestoneStepper insights={d} />

        {d.weeks.length > 0 && (
          <Panel bodyClassName="p-4 pt-6" title={t('portal.ins.weekly')}>
            <ColumnChart title={t('portal.ins.weeklyTitle')} data={d.weeks} x="start" series={[{ key: 'tasks_done', label: t('portal.ins.weeklySeries'), color: 'var(--color-chart-1)' }]} format={(v) => String(v)} axisUnit={1} xFormat={(s) => fmtDate(s, { month: 'short', day: 'numeric' })} height={160} />
          </Panel>
        )}

        {d.projects.length > 0 && <Appreciate accessId={accessId} insights={d} />}
      </div>
    </div>
  );
}

/**
 * A project's shared milestones as a horizontal stepper (done, next, planned or overdue), one project
 * at a time. On a narrow screen the row scrolls sideways, and it can be scrolled with the keyboard.
 */
function MilestoneStepper({ insights }: { insights: PortalInsights }) {
  const withMilestones = insights.projects.filter((p) => insights.milestones.some((m) => m.project_id === p.id));
  const [projectId, setProjectId] = useState(withMilestones[0]?.id ?? '');
  const id = useId();
  const steps = insights.milestones.filter((m) => m.project_id === projectId);
  const lastDone = steps.reduce((n, m, i) => (m.status === 'DONE' ? i : n), -1);
  const filled = steps.length > 1 && lastDone >= 0 ? (lastDone / (steps.length - 1)) * 100 : 0;
  const project = withMilestones.find((p) => p.id === projectId);
  return (
    <Panel
      className="lg:col-span-2"
      bodyClassName="p-4"
      title={t('portal.ins.timeline')}
      actions={
        withMilestones.length > 1 ? (
          <Select aria-label={t('portal.ins.thank.project')} value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 w-56">
            {withMilestones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : project ? (
          <span className="text-xs text-text-muted">{project.name}</span>
        ) : undefined
      }
    >
      {steps.length === 0 ? (
        <EmptyState title={t('portal.ins.timelineEmpty')} description={t('portal.ins.timelineEmptyHint')} />
      ) : (
        <div className="overflow-x-auto pb-1" tabIndex={0} role="region" aria-labelledby={`${id}-steps`}>
          <span id={`${id}-steps`} className="sr-only">
            {t('portal.ins.timeline')}
            {project ? `: ${project.name}` : ''}
          </span>
          <div className="relative" style={{ minWidth: `${Math.max(steps.length, 3) * 8}rem` }}>
            {/* The track, filled up to the last done milestone. */}
            <div aria-hidden className="absolute top-3 h-1 rounded-full bg-surface-sunken" style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }}>
              <div className="h-full rounded-full bg-success" style={{ width: `${filled}%` }} />
            </div>
            <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
              {steps.map((m) => {
                const state = m.status === 'DONE' ? 'done' : m.overdue ? 'overdue' : m.status === 'IN_PROGRESS' ? 'next' : 'planned';
                return (
                  <li key={m.id} className="flex flex-col items-center gap-1.5 px-1.5 text-center">
                    <span
                      aria-hidden
                      className={cx(
                        'grid size-7 place-items-center rounded-full border-2 ring-4 ring-surface',
                        state === 'done' && 'border-success bg-success text-on-accent',
                        state === 'next' && 'border-interactive bg-surface text-interactive',
                        state === 'overdue' && 'border-danger bg-surface text-danger',
                        state === 'planned' && 'border-border-strong bg-surface text-text-muted',
                      )}
                    >
                      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : state === 'next' ? <Flag className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                    <span className="text-sm font-semibold leading-tight">{m.title}</span>
                    <span className="text-xs text-text-muted tabular">{fmtDate(m.due_date, { month: 'short', day: 'numeric' })}</span>
                    <Badge tone={state === 'done' ? 'success' : state === 'next' ? 'info' : state === 'overdue' ? 'danger' : 'neutral'}>
                      {state === 'overdue' ? t('portal.ins.ms.overdue') : t(`portal.ins.ms.${m.status}`)}
                      {m.on_time !== null && ` · ${t(m.on_time ? 'portal.ins.ms.onTime' : 'portal.ins.ms.late')}`}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Thank a project team or one person on it. Nobody sees it until the organization approves it. */
function Appreciate({ accessId, insights }: { accessId: string; insights: PortalInsights }) {
  const id = useId();
  const [project, setProject] = useState(insights.projects.length === 1 ? insights.projects[0]!.id : '');
  const [who, setWho] = useState('');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);
  const send = useMutation<{ id: string }, ApiError, { project_id: string; membership_id: string | null; message: string }>({
    mutationFn: (body) => api(`/portal/${accessId}/appreciations`, { method: 'POST', body }),
  });
  const people = insights.contributors.filter((c) => c.project_id === project);
  const bad = { project: !project, message: !message.trim() };
  const submit = async () => {
    setTried(true);
    setSent(false);
    if (bad.project || bad.message) return;
    try {
      await send.mutateAsync({ project_id: project, membership_id: who || null, message: message.trim() });
      setSent(true);
      setMessage('');
      setWho('');
      setTried(false);
    } catch {
      // Shown below from send.error.
    }
  };
  return (
    <Panel bodyClassName="p-4" title={t('portal.ins.thank.title')} actions={<Heart className="size-4 text-text-muted" aria-hidden />}>
      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-text-muted">{t('portal.ins.thank.intro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('portal.ins.thank.project')} htmlFor={`${id}-project`} required error={tried && bad.project ? t('portal.ins.thank.needProject') : null}>
            <Select id={`${id}-project`} value={project} onChange={(e) => (setProject(e.target.value), setWho(''))} aria-invalid={tried && bad.project}>
              <option value="">{t('portal.ins.thank.choose')}</option>
              {insights.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('portal.ins.thank.who')} htmlFor={`${id}-who`}>
            <Select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} disabled={!project}>
              <option value="">{t('portal.ins.thank.team')}</option>
              {people.map((c) => (
                <option key={c.membership_id} value={c.membership_id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('portal.ins.thank.message')} htmlFor={`${id}-msg`} required error={tried && bad.message ? t('portal.ins.thank.needMessage') : null}>
          <Textarea id={`${id}-msg`} rows={3} maxLength={1000} placeholder={t('portal.ins.thank.messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={tried && bad.message} />
        </Field>
        {send.error && (
          <p role="alert" className="text-sm text-danger">
            {send.error instanceof ApiError ? send.error.title : errorMessage(send.error)}
          </p>
        )}
        {sent && (
          <p role="status" className="flex items-start gap-1.5 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('portal.ins.thank.sent')}
          </p>
        )}
        <Button type="submit" variant="primary" loading={send.isPending}>
          {t('portal.ins.thank.send')}
        </Button>
      </form>
    </Panel>
  );
}
