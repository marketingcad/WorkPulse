'use client';
import Link from 'next/link';
import { Award, Flag, Gauge, Target, Trophy, Users } from 'lucide-react';
import { Badge, EmptyState, KpiStrip, Panel, fmtDate, fmtPct, fmtRelative, type Kpi } from '@tallywork/ui';
import { BarList, ColumnChart } from '@/components/charts-lazy';
import { t } from './i18n';
import './messages/overview';
import { HeroBand, HeroTile, HexBadge, METRICS, METRIC_COLOR, ScoreRing, metricLabel, metricSource, scoreText, type MetricKey, type Tier } from './ui';
import type { MilestoneStep, PerformanceOverview } from './types';

/**
 * The body of the Performance overview (everything drawn from the data). Loaded alongside the data,
 * not with the page, so the page's first load stays inside the 250 KB budget.
 */
const TIER_SERIES = [
  { key: 'bronze', color: 'var(--color-tier-bronze)' },
  { key: 'silver', color: 'var(--color-tier-silver)' },
  { key: 'gold', color: 'var(--color-tier-gold)' },
  { key: 'platinum', color: 'var(--color-tier-platinum)' },
] as const;

const STEP_CLASS: Record<MilestoneStep, string> = {
  ON_TIME: 'bg-success',
  LATE: 'bg-warning',
  OVERDUE: 'bg-danger',
  OPEN: 'border border-border-strong bg-surface',
};

export default function Overview({ data, periodLabel, team, ruleVersion, base }: { data: PerformanceOverview; periodLabel: string; team: string | null; ruleVersion: number | null; base: string }) {
  const k = data.kpis;
  const change = k.score !== null && k.previous_score !== null ? Math.round(k.score - k.previous_score) : null;
  const topTeam = data.teams.find((x) => x.score !== null) ?? null;
  const ring = Object.fromEntries(METRICS.map((m) => [m, { value: data.parts[m].value, weight: data.parts[m].weight ?? 0 }])) as Record<MetricKey, { value: number | null; weight: number }>;
  const nothingYet = k.active_workers === 0;

  const kpis: Kpi[] = [
    { label: t('perf.kpi.workers'), value: <span className="tabular">{k.active_workers}</span>, icon: <Users className="size-4" /> },
    { label: t('perf.kpi.teams'), value: <span className="tabular">{k.active_teams}</span>, icon: <Users className="size-4" /> },
    { label: t('perf.kpi.achievements'), value: <span className="tabular">{k.achievements}</span>, hint: t('perf.kpi.achievementsAutomatic', { count: k.achievements_automatic }), icon: <Award className="size-4" /> },
    { label: t('perf.kpi.goals'), value: <span className="tabular">{t('perf.xOfY', { x: k.goals_completed, y: k.goals_due })}</span>, hint: t('perf.kpi.goalsHint'), icon: <Target className="size-4" /> },
    { label: t('perf.kpi.teamGoals'), value: <span className="tabular">{fmtPct(k.team_goal_completion)}</span>, icon: <Trophy className="size-4" /> },
    { label: t('perf.kpi.delivery'), value: <span className="tabular">{fmtPct(k.project_delivery)}</span>, hint: t('perf.kpi.deliveryHint', { x: k.milestones_on_time, y: k.milestones_due }), icon: <Flag className="size-4" /> },
  ];

  return (
    <>
      <HeroBand label={t('perf.hero.label')} className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <ScoreRing parts={ring} score={k.score} onDark />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-nav-muted">{team ? t('perf.hero.teamScore', { team, period: periodLabel }) : t('perf.hero.orgScore', { period: periodLabel })}</p>
            <p className="text-2xl font-semibold">{k.score === null ? t('perf.hero.noScore') : t('perf.hero.score', { score: scoreText(k.score) })}</p>
            <p className="text-sm text-nav-muted">
              {change === null ? t('perf.hero.noComparison') : change === 0 ? t('perf.hero.same') : t(change > 0 ? 'perf.hero.up' : 'perf.hero.down', { n: Math.abs(change) })}
              {ruleVersion !== null && <> · {t('perf.hero.rules', { version: ruleVersion })}</>}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-88 lg:grid-cols-1">
            <HeroTile>
              <Trophy className="size-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-nav-muted">{t('perf.hero.topTeam')}</p>
                <p className="truncate text-sm font-semibold">{topTeam ? t('perf.hero.topTeamValue', { team: topTeam.name, score: scoreText(topTeam.score) }) : t('perf.hero.none')}</p>
              </div>
            </HeroTile>
            <HeroTile>
              <Target className="size-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-nav-muted">{t('perf.hero.goals')}</p>
                <p className="text-sm font-semibold tabular">{k.goals_due ? t('perf.hero.goalsValue', { x: k.goals_completed, y: k.goals_due }) : t('perf.hero.noGoals')}</p>
              </div>
            </HeroTile>
          </div>
        </div>
      </HeroBand>

      {nothingYet && <EmptyState icon={<Gauge className="size-5" />} title={t('perf.empty.title')} description={t('perf.empty.description')} action={<Link className="text-sm font-medium text-interactive underline" href={`${base}/workers`}>{t('perf.empty.action')}</Link>} />}

      <KpiStrip items={kpis} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel bodyClassName="p-4" title={t('perf.panel.trend')}>
          {data.score_trend.every((s) => s.score === null) ? (
            <EmptyState title={t('perf.trend.empty')} description={t('perf.trend.emptyHint')} />
          ) : (
            <ColumnChart title={t('perf.panel.trend')} data={data.score_trend.map((s) => ({ start: s.start, score: s.score }))} x="start" series={[{ key: 'score', label: t('perf.score'), color: 'var(--color-chart-1)' }]} format={(v) => String(Math.round(v))} xFormat={(d) => fmtDate(d, { month: 'short', day: 'numeric' })} height={180} />
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.panel.parts')} actions={ruleVersion !== null ? <Badge>{t('perf.hero.rules', { version: ruleVersion })}</Badge> : undefined}>
          <ul className="space-y-3">
            {METRICS.map((m) => {
              const part = data.parts[m];
              return (
                <li key={m}>
                  <div className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: METRIC_COLOR[m] }} />
                    <span className="font-medium">{metricLabel(m)}</span>
                    <span className="text-xs text-text-muted">{part.weight === null ? '' : t('perf.parts.weight', { weight: part.weight })}</span>
                    <span className="ml-auto font-semibold tabular">{part.value === null ? t('perf.notMeasured') : scoreText(part.value)}</span>
                  </div>
                  <p className="ml-4.5 text-xs text-text-muted">
                    {metricSource(m)}
                    {part.value !== null && <> · {t('perf.parts.measuredFor', { count: part.measured_for })}</>}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">{t('perf.parts.note')}</p>
        </Panel>

        <Panel
          bodyClassName="p-4"
          title={t('perf.panel.teams')}
          actions={
            data.teams.length > 1 ? (
              <Link href={`${base}/performance/teams`} className="text-xs font-medium text-interactive hover:underline">
                {t('perf.overview.compareTeams')}
              </Link>
            ) : undefined
          }
        >
          {data.teams.length === 0 ? (
            <EmptyState title={t('perf.teams.empty')} description={t('perf.teams.emptyHint')} action={<Link className="text-sm font-medium text-interactive underline" href={`${base}/teams`}>{t('perf.teams.emptyAction')}</Link>} />
          ) : (
            <ol className="divide-y divide-border">
              {data.teams.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                  <span className="text-xs text-text-muted">{t('perf.teams.members', { count: x.members })}</span>
                  <span className="w-12 text-right font-semibold tabular">{scoreText(x.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.panel.attendance')}>
          {data.teams.some((x) => x.attendance.scheduled > 0) ? (
            <BarList rows={data.teams.filter((x) => x.attendance.scheduled > 0).map((x) => ({ label: x.name, value: Math.round((x.attendance.on_time / x.attendance.scheduled) * 100), sub: t('perf.attendance.sub', { x: x.attendance.on_time, y: x.attendance.scheduled }) }))} format={(v) => `${v}%`} max={100} />
          ) : (
            <EmptyState title={t('perf.attendance.empty')} description={t('perf.attendance.emptyHint')} />
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.panel.achievements')}>
          {data.achievements_by_month.every((m) => m.bronze + m.silver + m.gold + m.platinum === 0) ? (
            <EmptyState title={t('perf.achievements.empty')} description={t('perf.achievements.emptyHint')} />
          ) : (
            <ColumnChart title={t('perf.panel.achievements')} data={data.achievements_by_month} x="month" series={TIER_SERIES.map((s) => ({ key: s.key, label: t(`perf.tier.${s.key}`), color: s.color }))} format={(v) => String(v)} axisUnit={1} xFormat={(d) => fmtDate(d, { month: 'short' })} height={180} />
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.panel.goals')}>
          {data.goals_by_month.every((m) => m.due === 0) ? (
            <EmptyState title={t('perf.goals.empty')} description={t('perf.goals.emptyHint')} />
          ) : (
            <ColumnChart
              title={t('perf.panel.goals')}
              data={data.goals_by_month.map((m) => ({ month: m.month, completed: m.completed, missed: m.due - m.completed }))}
              x="month"
              series={[
                { key: 'completed', label: t('perf.goals.completed'), color: 'var(--color-success)' },
                { key: 'missed', label: t('perf.goals.notCompleted'), color: 'var(--color-chart-5)' },
              ]}
              format={(v) => String(v)}
              axisUnit={1}
              xFormat={(d) => fmtDate(d, { month: 'short' })}
              height={180}
            />
          )}
        </Panel>

        <Panel bodyClassName="p-4" title={t('perf.panel.delivery')}>
          {data.projects.length === 0 ? (
            <EmptyState title={t('perf.delivery.empty')} description={t('perf.delivery.emptyHint')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.projects.map((pr) => (
                <li key={pr.id} className="space-y-1 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Link href={`${base}/projects/${pr.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {pr.name}
                    </Link>
                    {pr.status && <Badge tone={pr.status === 'AT_RISK' ? 'warning' : pr.status === 'DONE' ? 'success' : 'info'}>{t(`perf.delivery.status.${pr.status}`)}</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1" role="img" aria-label={t('perf.delivery.steps', { done: pr.done, total: pr.total })}>
                    {pr.steps.map((s, i) => (
                      <span key={i} title={t(`perf.delivery.step.${s}`)} className={`h-2 w-6 rounded-full ${STEP_CLASS[s]}`} />
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">{pr.next ? t('perf.delivery.next', { title: pr.next.title, date: fmtDate(pr.next.due_date) }) : t('perf.delivery.allDone')}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          bodyClassName="p-4"
          title={t('perf.panel.recognition')}
          actions={
            <Link href={`${base}/performance/achievements?tab=awarded`} className="text-xs font-medium text-interactive hover:underline">
              {t('perf.overview.allAchievements')}
            </Link>
          }
        >
          {data.recognition.length === 0 ? (
            <EmptyState title={t('perf.recognition.empty')} description={t('perf.recognition.emptyHint')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.recognition.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <HexBadge icon={a.icon} tier={a.tier as Tier | null} size={30} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate">{t('perf.recognition.earned', { who: a.recipient.name, what: a.name })}</p>
                    <p className="text-xs text-text-muted">
                      {t(`perf.recognition.source.${a.source}`)} · {fmtRelative(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
