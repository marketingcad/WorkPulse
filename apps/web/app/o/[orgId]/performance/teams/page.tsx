'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Avatar, Badge, EmptyState, ErrorState, FilterBar, PageHeader, Panel, PermissionState, Select, SkeletonRows, cx, fmtPct } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/teams';
import { PeriodPicker, ratio, scoreText, usePerfPeriod } from '@/components/performance/ui';
import { ScoreLines } from '@/components/performance/score-lines';
import type { TeamPerformance } from '@/components/performance/types';

type Team = TeamPerformance['teams'][number];
const COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)'];
const MAX = 3;
const pctOf = (a: number, b: number) => (b ? (a / b) * 100 : null);

/**
 * Team performance: up to three teams side by side for a period, with their score over time and
 * their people. Managers see only the teams they manage; ranks follow `leaderboard_managers`.
 */
export default function TeamPerformancePage() {
  const org = useOrg();
  const scope = org.grants['performance:read'];
  const allowed = scope === 'team' || scope === 'org';
  const p = usePerfPeriod(todayIn(org.organization.timezone), org.organization.week_start);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [peopleOf, setPeopleOf] = useState('');
  const q = useOrgQuery<TeamPerformance>(allowed ? `/performance/teams${qs({ period: p.period, date: p.date })}` : null);

  if (!allowed) return <PermissionState />;
  const data = q.data;
  // By default the three best-scoring teams; the person's own choice once they make one.
  const ranked = data ? [...data.teams].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : [];
  const chosen = (picked ?? ranked.slice(0, MAX).map((x) => x.id)).filter((id) => ranked.some((x) => x.id === id));
  const shown = chosen.map((id) => ranked.find((x) => x.id === id)!);
  const color = (id: string) => COLORS[chosen.indexOf(id)] ?? 'var(--color-chart-4)';
  const toggle = (id: string) => {
    const cur = chosen;
    setPicked(cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id]);
  };
  const peopleTeam = shown.find((x) => x.id === peopleOf) ?? shown[0] ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title={t('perf.teams.title')} description={t('perf.teams.description')} />
      <FilterBar className="flex-wrap">
        <PeriodPicker p={p} />
      </FilterBar>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <div role="status" aria-label={t('perf.loading')}>
          <SkeletonRows rows={8} cols={3} />
        </div>
      ) : data.teams.length === 0 ? (
        <EmptyState title={t('perf.teams.none')} description={t('perf.teams.noneHint')} action={<Link className="text-sm font-medium text-interactive underline" href={`${org.base}/teams`}>{t('perf.teams.emptyAction')}</Link>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('perf.teams.pickHint')}>
            <span className="mr-1 text-xs text-text-muted">{t('perf.teams.pick')}</span>
            {ranked.map((x) => {
              const on = chosen.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && chosen.length >= MAX}
                  onClick={() => toggle(x.id)}
                  className={cx('inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:border-dashed', on ? 'border-interactive bg-interactive-soft' : 'border-border bg-surface')}
                >
                  {on && <span aria-hidden className="size-2.5 rounded-full" style={{ background: color(x.id) }} />}
                  {x.name}
                </button>
              );
            })}
          </div>
          {data.ranks_hidden && <p className="text-xs text-text-muted">{t('perf.teams.ranksHidden')}</p>}

          {shown.length > 0 && (
            <>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
                {shown.map((x) => (
                  <TeamCard key={x.id} team={x} total={data.teams.length} color={color(x.id)} fmtDuration={org.fmtDuration} />
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel bodyClassName="p-4" title={t('perf.teams.trend')}>
                  {shown.every((x) => x.history.every((v) => v === null)) ? (
                    <EmptyState title={t('perf.teams.trendEmpty')} description={t('perf.trend.emptyHint')} />
                  ) : (
                    <ScoreLines periods={data.periods} label={t('perf.teams.trendLabel')} series={shown.map((x) => ({ key: x.id, name: x.name, color: color(x.id), values: x.history }))} />
                  )}
                </Panel>
                {peopleTeam && <People team={peopleTeam} teams={shown} onTeam={setPeopleOf} fmtDuration={org.fmtDuration} base={org.base} />}
              </div>

              <SideBySide teams={shown} ranksHidden={data.ranks_hidden} total={data.teams.length} fmtDuration={org.fmtDuration} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function TeamCard({ team, total, color, fmtDuration }: { team: Team; total: number; color: string; fmtDuration: (s: number) => string }) {
  const prev = team.history.at(-2) ?? null;
  const change = team.score !== null && prev !== null ? Math.round(team.score - prev) : null;
  const stats: Array<[string, string]> = [
    [t('perf.teams.stat.hours'), fmtDuration(team.approved_seconds)],
    [t('perf.teams.stat.goals'), ratio(team.goals)],
    [t('perf.teams.stat.milestones'), team.milestones.due ? ratio(team.milestones) : t('perf.teams.notMeasured')],
    [t('perf.teams.stat.attendance'), fmtPct(pctOf(team.attendance.on_time, team.attendance.scheduled))],
    [t('perf.teams.stat.achievements'), String(team.achievements)],
  ];
  return (
    <section aria-label={team.name} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-10 w-1.5 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{team.name}</h2>
          <p className="text-xs text-text-muted">
            {t('perf.teams.meta', { count: team.members })}
            {team.rank !== null && <> · {t('perf.teams.rankOf', { rank: team.rank, total })}</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-extrabold leading-none tabular">{scoreText(team.score)}</p>
          <p className={cx('mt-1 text-xs', change !== null && change > 0 ? 'text-success' : 'text-text-muted')}>{change === null ? t('perf.teams.noChange') : t('perf.teams.change', { sign: change > 0 ? '+' : change < 0 ? '−' : '±', n: Math.abs(change) })}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-text-muted">{k}</dt>
            <dd className="text-[15px] font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function People({ team, teams, onTeam, fmtDuration, base }: { team: Team; teams: Team[]; onTeam: (id: string) => void; fmtDuration: (s: number) => string; base: string }) {
  return (
    <Panel
      title={t('perf.teams.peopleOf', { team: team.name })}
      actions={
        teams.length > 1 ? (
          <Select aria-label={t('perf.teams.peopleTeam')} value={team.id} onChange={(e) => onTeam(e.target.value)} className="h-8 w-40">
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        ) : undefined
      }
      footer={t('perf.teams.peopleNote')}
    >
      {team.people.length === 0 ? (
        <div className="p-4">
          <EmptyState title={t('perf.teams.peopleEmpty')} />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {team.people.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={m.name} seed={m.id} size={30} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <Link href={`${base}/performance/workers/${m.id}`} className="truncate hover:underline">
                    {m.name}
                  </Link>
                  {m.manager && <Badge>{t('perf.teams.manager')}</Badge>}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {[m.title, t('perf.teams.personMeta', { hours: fmtDuration(m.approved_seconds) }), m.eligible ? null : t('perf.teams.notRanked')].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken sm:block" aria-hidden>
                <div className="h-full rounded-full bg-interactive" style={{ width: `${Math.max(0, Math.min(100, m.score ?? 0))}%` }} />
              </div>
              <span className="w-8 text-right font-semibold tabular">{scoreText(m.score)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SideBySide({ teams, ranksHidden, total, fmtDuration }: { teams: Team[]; ranksHidden: boolean; total: number; fmtDuration: (s: number) => string }) {
  const rows: Array<{ key: string; label: string; hint?: string; cell: (x: Team) => string }> = [
    { key: 'score', label: t('perf.teams.stat.score'), cell: (x) => scoreText(x.score) },
    ...(ranksHidden ? [] : [{ key: 'rank', label: t('perf.teams.stat.rank'), cell: (x: Team) => (x.rank === null ? '—' : t('perf.teams.rankOf', { rank: x.rank, total })) }]),
    { key: 'goals', label: t('perf.metric.goals'), hint: t('perf.metricSource.goals'), cell: (x) => (x.goals.due ? `${fmtPct(pctOf(x.goals.completed, x.goals.due))} · ${ratio(x.goals)}` : t('perf.teams.notMeasured')) },
    { key: 'milestones', label: t('perf.teams.stat.milestones'), hint: t('perf.metricSource.delivery'), cell: (x) => (x.milestones.due ? `${fmtPct(pctOf(x.milestones.on_time, x.milestones.due))} · ${ratio(x.milestones)}` : t('perf.teams.notMeasured')) },
    { key: 'attendance', label: t('perf.metric.attendance'), hint: t('perf.metricSource.attendance'), cell: (x) => (x.attendance.scheduled ? fmtPct(pctOf(x.attendance.on_time, x.attendance.scheduled)) : t('perf.teams.notMeasured')) },
    { key: 'hours', label: t('perf.teams.stat.hours'), cell: (x) => fmtDuration(x.approved_seconds) },
    { key: 'achievements', label: t('perf.teams.stat.achievements'), cell: (x) => String(x.achievements) },
  ];
  return (
    <Panel title={t('perf.teams.side')}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('perf.teams.side')}>
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left text-xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-4 py-2 font-semibold">
                {t('perf.teams.metric')}
              </th>
              {teams.map((x) => (
                <th key={x.id} scope="col" className="px-4 py-2 font-semibold">
                  {x.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-medium">
                  {r.label}
                  {r.hint && <span className="block text-xs font-normal text-text-muted">{r.hint}</span>}
                </th>
                {teams.map((x) => (
                  <td key={x.id} className="px-4 py-2.5 tabular">
                    {r.cell(x)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
