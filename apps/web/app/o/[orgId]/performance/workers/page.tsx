'use client';
import { useRouter } from 'next/navigation';
import { DataTable, EmptyState, ErrorState, FilterBar, PageHeader, PermissionState, PersonCell, fmtPct, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/workers';
import { PeriodPicker, ratio, scoreText, usePerfPeriod } from '@/components/performance/ui';
import type { MemberPerformanceList } from '@/components/performance/types';

type Row = MemberPerformanceList['rows'][number];

/** Worker performance: the people the viewer may see, with their score for the period. */
export default function WorkerPerformancePage() {
  const org = useOrg();
  const router = useRouter();
  const scope = org.grants['performance:read'];
  const allowed = scope === 'team' || scope === 'org';
  const p = usePerfPeriod(todayIn(org.organization.timezone), org.organization.week_start);
  const q = useOrgQuery<MemberPerformanceList>(allowed ? `/performance/members${qs({ period: p.period, date: p.date })}` : null);

  if (!allowed) return <PermissionState />;
  const profile = (id: string) => `${org.base}/performance/workers/${id}${qs({ period: p.period })}`;

  const columns: Column<Row>[] = [
    { key: 'person', header: t('perf.w.col.person'), priority: 'primary', value: (r) => r.name, cell: (r) => <PersonCell name={r.name} seed={r.id} sub={r.title ?? r.role} /> },
    { key: 'teams', header: t('perf.w.col.teams'), value: (r) => r.teams.join(', '), cell: (r) => <span className="text-sm text-text-muted">{r.teams.join(', ') || '—'}</span> },
    {
      key: 'score',
      header: t('perf.w.col.score'),
      align: 'right',
      priority: 'secondary',
      value: (r) => r.score ?? -1,
      cell: (r) => (
        <span className="tabular">
          <span className="font-semibold">{scoreText(r.score)}</span>
          {!r.eligible && <span className="block text-xs text-text-muted">{t('perf.w.notRanked')}</span>}
        </span>
      ),
    },
    { key: 'hours', header: t('perf.w.col.hours'), align: 'right', value: (r) => r.approved_seconds, cell: (r) => <span className="tabular text-sm">{org.fmtDuration(r.approved_seconds)}</span> },
    { key: 'goals', header: t('perf.w.col.goals'), align: 'right', value: (r) => r.goals?.completed ?? -1, cell: (r) => <span className="tabular text-sm">{ratio(r.goals)}</span> },
    { key: 'attendance', header: t('perf.w.col.attendance'), align: 'right', value: (r) => (r.attendance?.scheduled ? r.attendance.on_time / r.attendance.scheduled : -1), cell: (r) => <span className="tabular text-sm">{r.attendance?.scheduled ? fmtPct((r.attendance.on_time / r.attendance.scheduled) * 100) : '—'}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('perf.w.title')} description={t('perf.w.description')} />
      <FilterBar className="flex-wrap">
        <PeriodPicker p={p} />
      </FilterBar>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data?.rows}
          loading={!q.data}
          columns={columns}
          rowKey={(r) => r.id}
          searchable
          searchPlaceholder={t('perf.w.search')}
          initialSort={{ key: 'score', dir: 'desc' }}
          onRowClick={(r) => router.push(profile(r.id))}
          empty={<EmptyState title={t('perf.w.empty')} description={t('perf.w.emptyHint')} />}
        />
      )}
    </div>
  );
}
