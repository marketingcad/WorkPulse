'use client';
import { Suspense, lazy, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Award, MessageSquarePlus, Target } from 'lucide-react';
import { MemberAvatar } from '@/lib/avatars';
import type { PerformanceSettingsDto } from '@tallywork/contracts';
import type { PerformancePeriod } from '@tallywork/domain';
import { PERFORMANCE_PERIODS } from '@tallywork/domain';
import { Badge, Button, EmptyState, ErrorState, FilterBar, KpiStrip, PageHeader, Panel, PermissionState, SkeletonRows, fmtDate, type Kpi } from '@tallywork/ui';
import { ApiError, qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/workers';
import { HexBadge, METRICS, METRIC_COLOR, PeriodPicker, ScoreRing, metricLabel, metricSource, ratio, scoreText, usePerfPeriod, type MetricKey, type Tier } from '@/components/performance/ui';
import { ScoreLines } from '@/components/performance/score-lines';
import type { MemberProfile, Review } from '@/components/performance/types';

// Opened on demand: not part of the page's first load (the 250 KB budget).
// Manager feedback is fetched as soon as the page loads, in parallel with the data.
const reviewsPanel = import('@/components/performance/reviews-panel');
const Reviews = lazy(() => reviewsPanel);
const ReviewDialog = lazy(() => import('@/components/performance/review-dialog'));

/**
 * One person's performance: score and rank for the period, what it is made of, their work, goals,
 * badges, score history and manager feedback. For their managers and admins; the person sees their
 * own progress in the desktop app.
 */
export default function WorkerProfilePage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const initial = (PERFORMANCE_PERIODS as readonly string[]).includes(search.get('period') ?? '') ? (search.get('period') as PerformancePeriod) : 'MONTH';
  const scope = org.grants['performance:read'];
  const allowed = scope === 'team' || scope === 'org';
  const canReadReviews = !!org.grants['reviews:read'] && org.grants['reviews:read'] !== 'own';
  const canWriteReviews = !!org.grants['reviews:manage'] && org.grants['reviews:manage'] !== 'own';
  const canSetGoals = !!org.grants['goals:manage'] && org.grants['goals:manage'] !== 'own';
  const p = usePerfPeriod(todayIn(org.organization.timezone), org.organization.week_start, initial);
  const q = useOrgQuery<MemberProfile>(allowed ? `/performance/members/${id}/profile${qs({ period: p.period, date: p.date })}` : null, { retry: false });
  const settingsQ = useOrgQuery<PerformanceSettingsDto>(allowed ? '/performance/settings' : null);
  const reviewsQ = useOrgQuery<Review[]>(allowed && canReadReviews ? `/performance/members/${id}/reviews` : null, { retry: false });
  const [editing, setEditing] = useState<Review | 'new' | null>(null);

  if (!allowed) return <PermissionState />;
  const data = q.data;
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const back = (
    <Link href={`${org.base}/performance/workers`} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
      <ArrowLeft className="size-3.5" aria-hidden />
      {t('perf.w.back')}
    </Link>
  );

  if (notFound) return <EmptyState title={t('perf.w.notFound')} action={back} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={back}
        title={
          data ? (
            <span className="flex items-center gap-3">
              <span aria-hidden className="contents">
                <MemberAvatar membershipId={data.member.id} name={data.member.name} size={40} />
              </span>
              {data.member.name}
            </span>
          ) : (
            t('perf.w.title')
          )
        }
        description={
          data ? (
            <span className="space-y-1.5">
              <span className="block">
                {[data.member.title ?? data.member.role, ...data.member.teams.map((x) => x.name), t('perf.w.badgeCount', { count: data.achievements.length })].join(' · ')}
              </span>
              {data.member.projects.length > 0 && (
                <span className="flex flex-wrap gap-1.5" aria-label={t('perf.w.projects')}>
                  {data.member.projects.slice(0, 4).map((p) => (
                    <Link key={p.id} href={`${org.base}/projects/${p.id}`} className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs hover:bg-surface-sunken">
                      {p.name}
                    </Link>
                  ))}
                  {data.member.projects.length > 4 && <span className="px-1 py-0.5 text-xs text-text-muted">{t('perf.w.moreProjects', { count: data.member.projects.length - 4 })}</span>}
                </span>
              )}
            </span>
          ) : undefined
        }
        actions={
          data && (
            <>
              {canSetGoals && (
                <Link href={`${org.base}/performance/goals?new=1&member=${data.member.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken">
                  <Target className="size-4" aria-hidden />
                  {t('perf.w.setGoal')}
                </Link>
              )}
              {canWriteReviews && (
                <Button icon={<MessageSquarePlus className="size-4" />} onClick={() => setEditing('new')}>
                  {t('perf.w.addReview')}
                </Button>
              )}
              {org.can('achievements:award') && (
                <Link href={`${org.base}/performance/achievements`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken">
                  <Award className="size-4" aria-hidden />
                  {t('perf.w.recognize')}
                </Link>
              )}
            </>
          )
        }
      />
      <FilterBar className="flex-wrap">
        <PeriodPicker p={p} />
      </FilterBar>

      {!data ? (
        <div role="status" aria-label={t('perf.loading')}>
          <SkeletonRows rows={8} cols={4} />
        </div>
      ) : (
        <Profile data={data} minDays={settingsQ.data?.rules.min_eligible_days ?? null} fmtDuration={org.fmtDuration} base={org.base} reviews={canReadReviews ? reviewsQ : null} canWriteReviews={canWriteReviews} onEdit={setEditing} />
      )}

      {editing && data && (
        <Suspense fallback={null}>
          <ReviewDialog member={{ id: data.member.id, name: data.member.name }} review={editing === 'new' ? null : editing} period={{ start: data.period.start, end: data.period.end }} onClose={() => setEditing(null)} />
        </Suspense>
      )}
    </div>
  );
}

function Profile({ data, minDays, fmtDuration, base, reviews, canWriteReviews, onEdit }: { data: MemberProfile; minDays: number | null; fmtDuration: (s: number) => string; base: string; reviews: { data?: Review[]; error: unknown; refetch: () => unknown } | null; canWriteReviews: boolean; onEdit: (r: Review) => void }) {
  const s = data.score;
  const k = data.kpis;
  const ring = Object.fromEntries(METRICS.map((m) => [m, { value: s.parts[m as MetricKey].value, weight: s.parts[m as MetricKey].weight }])) as Record<MetricKey, { value: number | null; weight: number }>;
  const history = [...data.history].slice(0, 6).reverse();
  const kpis: Kpi[] = [
    { label: t('perf.w.kpi.hours'), value: <span className="tabular">{fmtDuration(k.approved_seconds)}</span> },
    { label: t('perf.w.kpi.attendance'), value: <span className="tabular">{ratio({ on_time: k.attendance.on_time, due: k.attendance.scheduled })}</span> },
    { label: t('perf.w.kpi.goals'), value: <span className="tabular">{ratio(k.goals)}</span> },
    { label: t('perf.w.kpi.tasks'), value: <span className="tabular">{k.tasks_done}</span> },
    { label: t('perf.w.kpi.milestones'), value: <span className="tabular">{k.milestones_done}</span>, hint: t('perf.w.kpi.milestonesHint', { n: k.milestones_on_time }) },
  ];

  return (
    <>
      <section aria-label={t('perf.w.score')} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center">
        <ScoreRing parts={ring} score={s.score} size={132} />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          {data.ranks_hidden ? (
            <p className="text-text-muted">{t('perf.w.rankHidden')}</p>
          ) : data.rank !== null && data.rank_group_size ? (
            <p className="text-base font-semibold">{t('perf.w.rank', { rank: data.rank, size: data.rank_group_size, group: data.rank_group ?? '' })}</p>
          ) : (
            minDays !== null && <p className="text-text-muted">{t('perf.w.notRankedWhy', { days: s.approved_days, min: minDays })}</p>
          )}
          <p className="text-text-muted">{t('perf.w.coverage', { coverage: s.coverage, version: s.rule_version })}</p>
        </div>
      </section>

      <KpiStrip items={kpis} minItemWidth={170} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel bodyClassName="p-4" title={t('perf.w.trend')}>
          {history.every((h) => h.score === null) ? (
            <EmptyState title={t('perf.w.historyEmpty')} />
          ) : (
            <ScoreLines periods={history.map((h) => h.period_start)} label={t('perf.w.trendLabel', { name: data.member.name })} series={[{ key: 'me', name: data.member.name, color: 'var(--color-chart-1)', values: history.map((h) => h.score) }]} />
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.w.breakdown')} footer={t('perf.w.breakdownHint')}>
          <ul className="space-y-3">
            {METRICS.map((m) => {
              const part = s.parts[m as MetricKey];
              return (
                <li key={m}>
                  <div className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: METRIC_COLOR[m] }} />
                    <span className="font-medium">{metricLabel(m)}</span>
                    <span className="text-xs text-text-muted">{part.value === null ? '' : t('perf.w.effective', { weight: part.effective_weight })}</span>
                    <span className="ml-auto font-semibold tabular">{part.value === null ? t('perf.notMeasured') : scoreText(part.value)}</span>
                  </div>
                  <div className="ml-4.5 mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    {part.value !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, part.value))}%`, background: METRIC_COLOR[m] }} />}
                  </div>
                  <p className="ml-4.5 mt-0.5 text-xs text-text-muted">{metricSource(m)}</p>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.w.contrib')}>
          {data.contributions.length === 0 ? (
            <EmptyState title={t('perf.w.contribEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.contributions.map((c) => (
                <li key={c.project_id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/projects/${c.project_id}`} className="block truncate font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs text-text-muted">{t('perf.w.contribMeta', { tasks: c.tasks_done, milestones: c.milestones_done })}</span>
                  </div>
                  <span className="font-semibold tabular">{fmtDuration(c.approved_seconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.w.goals')}>
          {data.goals.length === 0 ? (
            <EmptyState title={t('perf.w.goalsEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.goals.map((g) => (
                <li key={g.id} className="space-y-1 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                    <Badge tone={g.status === 'COMPLETED' ? 'success' : g.status === 'MISSED' ? 'danger' : g.pace === 'AT_RISK' ? 'warning' : 'info'}>{g.status === 'ACTIVE' && g.pace ? t(`perf.w.pace.${g.pace}`) : t(`perf.w.goalStatus.${g.status}`)}</Badge>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${g.progress_pct}%`}>
                    <div className="h-full rounded-full bg-interactive" style={{ width: `${Math.max(0, Math.min(100, g.progress_pct))}%` }} />
                  </div>
                  <p className="text-xs text-text-muted tabular">{t('perf.w.goalMeta', { current: g.current, target: g.target, date: fmtDate(g.end_date) })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.w.badges')}>
          {data.achievements.length === 0 ? (
            <EmptyState title={t('perf.w.badgesEmpty')} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
              {data.achievements.map((a) => (
                <li key={a.id} className="flex flex-col items-center gap-1 text-center">
                  <HexBadge icon={a.icon} tier={(a.tier as Tier | null) ?? 'GOLD'} size={44} />
                  <span className="text-xs font-medium">{a.name}</span>
                  <span className="text-2xs text-text-muted">{fmtDate(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.w.history')}>
          {data.history.length === 0 ? (
            <EmptyState title={t('perf.w.historyEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.history.map((h) => (
                <li key={h.period_start} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">
                      {fmtDate(h.period_start)} – {fmtDate(h.period_end)}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {t(h.final ? 'perf.w.historyFinal' : 'perf.w.historyOpen')} · {t('perf.w.historyRules', { version: h.rule_version })}
                    </span>
                  </div>
                  <span className="font-semibold tabular">{scoreText(h.score)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {reviews && (
        <Suspense fallback={<SkeletonRows rows={3} cols={1} />}>
          <Reviews name={data.member.name} reviews={reviews} canWrite={canWriteReviews} onEdit={onEdit} />
        </Suspense>
      )}
    </>
  );
}
