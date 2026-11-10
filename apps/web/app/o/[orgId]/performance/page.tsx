'use client';
import { Suspense, lazy, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Scale } from 'lucide-react';
import type { PerformanceSettingsDto, ProjectDto, TeamDto } from '@tallywork/contracts';
import { Button, ErrorState, FilterBar, PageHeader, PermissionState, Select, SkeletonRows, useToast } from '@tallywork/ui';
import { errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/overview';
import { PeriodPicker, usePerfPeriod } from '@/components/performance/ui';
// Opened on demand: not part of the page's first load (the 250 KB budget).
// Fetched as soon as the page loads, in parallel with the data (not part of the first load).
const overviewBody = import('@/components/performance/overview-body');
const Overview = lazy(() => overviewBody);
const ScoringRulesDialog = lazy(() => import('@/components/performance/scoring-rules-dialog').then((m) => ({ default: m.ScoringRulesDialog })));
import type { PerformanceOverview } from '@/components/performance/types';


/**
 * Performance overview: the organization's (or one team's) score for a period, what it is made of,
 * and the goals, delivery and recognition behind it. Admins and managers only; the API counts only
 * the people, teams and projects the viewer may see.
 */
export default function PerformanceOverviewPage() {
  const org = useOrg();
  const toast = useToast();
  const scope = org.grants['performance:read'];
  const allowed = scope === 'team' || scope === 'org';
  const canManage = org.can('performance:manage');
  const canSetGoals = !!org.grants['goals:manage'] && org.grants['goals:manage'] !== 'own';
  const p = usePerfPeriod(todayIn(org.organization.timezone), org.organization.week_start);
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  const q = useOrgQuery<PerformanceOverview>(allowed ? `/performance/overview${qs({ period: p.period, date: p.date, team_id: teamId || undefined, project_id: projectId || undefined })}` : null);
  const settingsQ = useOrgQuery<PerformanceSettingsDto>(allowed ? '/performance/settings' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(allowed && org.can('teams:read') ? '/teams' : null);
  const projectsQ = useOrgQuery<ProjectDto[]>(allowed && org.can('projects:read') ? '/projects' : null);
  const recalc = useOrgMutation<{ period: string; date: string }, { members: number }>('POST', '/performance/recalculate', { invalidate: ['/performance'] });

  if (!allowed) return <PermissionState />;

  const data = q.data;
  const recalculate = async () => {
    try {
      await recalc.mutateAsync({ period: p.period, date: p.date });
      toast.success(t('perf.overview.recalculated'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('perf.overview.title')}
        description={t('perf.overview.description')}
        actions={
          <>
            <Button icon={<Scale className="size-4" />} onClick={() => setRulesOpen(true)}>
              {t('perf.rules.open')}
            </Button>
            {canManage && (
              <Button icon={<RefreshCw className="size-4" />} onClick={recalculate} loading={recalc.isPending}>
                {t('perf.overview.recalculate')}
              </Button>
            )}
            {canSetGoals && (
              <Link href={`${org.base}/performance/goals?new=1`} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-interactive px-3 text-sm font-medium text-on-accent hover:bg-interactive-hover">
                <Plus className="size-4" aria-hidden />
                {t('perf.overview.newGoal')}
              </Link>
            )}                   
          </>
        }
      />

      <FilterBar className="flex-wrap">
        <PeriodPicker p={p} />
        {teamsQ.data && teamsQ.data.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="perf-team" className="text-text-muted">
              {t('perf.filter.team')}
            </label>
            <Select id="perf-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-44">
              <option value="">{t('perf.filter.allTeams')}</option>
              {teamsQ.data
                .filter((x) => !x.archived_at)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
        {projectsQ.data && projectsQ.data.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="perf-project" className="text-text-muted">
              {t('perf.filter.project')}
            </label>
            <Select id="perf-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-44">
              <option value="">{t('perf.filter.allProjects')}</option>
              {projectsQ.data
                .filter((x) => !x.archived_at)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </FilterBar>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <div role="status" aria-label={t('perf.loading')}>
          <SkeletonRows rows={8} cols={4} />
        </div>
      ) : (
        <Suspense fallback={<div role="status" aria-label={t('perf.loading')}><SkeletonRows rows={8} cols={4} /></div>}>
          <Overview data={data} periodLabel={p.label} team={teamsQ.data?.find((x) => x.id === teamId)?.name ?? null} ruleVersion={settingsQ.data?.rules.version ?? null} base={org.base} />
        </Suspense>
      )}

      {rulesOpen && (
        <Suspense fallback={null}>
          <ScoringRulesDialog open onClose={() => setRulesOpen(false)} settings={settingsQ.data} canManage={canManage} />
        </Suspense>
      )}
    </div>
  );
}
