'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Info, Minus, ShieldCheck } from 'lucide-react';
import type { PerformanceSettingsDto } from '@tallywork/contracts';
import { Avatar, Badge, DataTable, EmptyState, ErrorState, FilterBar, PageHeader, Panel, PermissionState, SegmentedControl, SkeletonRows, Switch, cx, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/leaderboards';
import { PeriodPicker, Sparkline, ratio, scoreText, usePerfPeriod } from '@/components/performance/ui';
import type { Leaderboard, LeaderboardRow } from '@/components/performance/types';

type Kind = Leaderboard['type'];

/**
 * Leaderboards: people, teams and projects ranked by their performance score for a period. People
 * are compared within their role family unless "Everyone" is chosen. The API decides who is listed
 * and whether the viewer may see rankings at all (`leaderboard_managers`).
 */
export default function LeaderboardsPage() {
  const org = useOrg();
  const router = useRouter();
  // A person on the board opens their profile (teams and projects have none).
  const profile = (id: string) => `${org.base}/performance/workers/${id}`;
  const scope = org.grants['performance:read'];
  const allowed = scope === 'team' || scope === 'org';
  const canManage = org.can('performance:manage');
  const p = usePerfPeriod(todayIn(org.organization.timezone), org.organization.week_start);
  const [kind, setKind] = useState<Kind>('workers');
  const [compare, setCompare] = useState<'role' | 'everyone'>('role');
  const q = useOrgQuery<Leaderboard>(allowed ? `/performance/leaderboard${qs({ type: kind, period: p.period, date: p.date, compare: kind === 'workers' ? compare : undefined })}` : null, { retry: false });
  const settingsQ = useOrgQuery<PerformanceSettingsDto>(allowed ? '/performance/settings' : null);

  if (!allowed) return <PermissionState />;
  const data = q.data;
  const turnedOff = q.error instanceof ApiError && q.error.status === 403;

  return (
    <div className="space-y-4">
      <PageHeader title={t('perf.lb.title')} description={t('perf.lb.description')} />
      <FilterBar className="flex-wrap">
        <SegmentedControl
          label={t('perf.lb.typeLabel')}
          value={kind}          
          onChange={setKind}
          options={(['workers', 'teams', 'projects'] as const).map((k) => ({ value: k, label: t(`perf.lb.type.${k}`) }))}
        />
        <PeriodPicker p={p} />
        {kind === 'workers' && (
          <SegmentedControl
            label={t('perf.lb.compare')}
            value={compare}
            onChange={setCompare}
            options={[
              { value: 'role', label: t('perf.lb.compare.role') },
              { value: 'everyone', label: t('perf.lb.compare.everyone') },
            ]}
          />
        )}
      </FilterBar>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {turnedOff ? (
            <PermissionState message={(q.error as ApiError).title} />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !data ? (
            <div role="status" aria-label={t('perf.loading')}>
              <SkeletonRows rows={8} cols={5} />
            </div>
          ) : (
            <>
              <Podium data={data} profile={profile} />
              <Panel title={t(`perf.lb.type.${data.type}`)} actions={<span className="text-xs text-text-muted">{t('perf.lb.ranked', { count: data.ranked })}</span>}>
                <RankTable data={data} onOpen={data.type === 'workers' ? (id) => router.push(profile(id)) : undefined} />
              </Panel>
            </>
          )}
        </div>

        <aside className="space-y-4">
          <Panel bodyClassName="p-4" title={t('perf.lb.how.title')} actions={settingsQ.data ? <Badge>{t('perf.lb.how.rules', { version: settingsQ.data.rules.version })}</Badge> : undefined}>
            <ol className="list-decimal space-y-2 pl-4 text-sm text-text-muted">
              <li>{t('perf.lb.how.1')}</li>
              <li>{t('perf.lb.how.2')}</li>
              <li>{t('perf.lb.how.3', { days: data?.min_eligible_days ?? settingsQ.data?.rules.min_eligible_days ?? 10 })}</li>
              <li>{t('perf.lb.how.4')}</li>
            </ol>
          </Panel>
          <WhoCanSee settings={settingsQ.data} canManage={canManage} />
        </aside>
      </div>
    </div>
  );
}

function Movement({ n }: { n: number | null }) {
  if (n === null) return null;
  if (n === 0)
    return (
      <span className="inline-flex items-center text-xs text-text-muted" title={t('perf.lb.moveSame')}>
        <Minus className="size-3" aria-hidden />
        <span className="sr-only">{t('perf.lb.moveSame')}</span>
      </span>
    );
  const up = n > 0;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium tabular', up ? 'text-success' : 'text-danger')}>
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {Math.abs(n)}
      <span className="sr-only">{t(up ? 'perf.lb.moveUp' : 'perf.lb.moveDown', { n: Math.abs(n) })}</span>
    </span>
  );
}

/** The top three (ties share a place), largest in the middle. */
function Podium({ data, profile }: { data: Leaderboard; profile: (id: string) => string }) {
  const top = data.rows.filter((r) => r.rank !== null && r.rank <= 3).slice(0, 3);
  if (!top.length) return null;
  const order = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top;
  return (
    <section aria-label={t('perf.lb.podium')} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {order.map((r) => (
        <div key={r.id} className={cx('flex flex-col items-center gap-1 rounded-md border border-border bg-surface p-4 text-center shadow-card', r.rank === 1 && 'sm:pb-8 sm:pt-6')}>
          <span className="text-xs font-semibold text-text-muted">{t('perf.lb.rank', { rank: r.rank! })}</span>
          {data.type === 'projects' ? null : <Avatar name={r.name} seed={r.id} size={r.rank === 1 ? 48 : 40} />}
          {data.type === 'workers' ? (
            <Link href={profile(r.id)} className="max-w-full truncate font-semibold hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="max-w-full truncate font-semibold">{r.name}</span>
          )}
          {r.sub && <span className="max-w-full truncate text-xs text-text-muted">{r.sub}</span>}
          <span className="text-2xl font-extrabold tabular">{scoreText(r.score)}</span>
          <Movement n={r.movement} />
        </div>
      ))}
    </section>
  );
}

function RankTable({ data, onOpen }: { data: Leaderboard; onOpen?: (id: string) => void }) {
  const columns: Column<LeaderboardRow>[] = [
    {
      key: 'rank',
      header: t('perf.lb.col.rank'),
      priority: 'secondary',
      value: (r) => r.rank ?? Number.MAX_SAFE_INTEGER,
      cell: (r) =>
        r.rank === null ? (
          <span className="text-xs text-text-muted" title={t('perf.lb.notRankedHint', { days: data.min_eligible_days })}>
            {t('perf.lb.notRanked')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="font-semibold tabular">{r.rank}</span>
            <Movement n={r.movement} />
          </span>
        ),
    },
    {
      key: 'name',
      header: t('perf.lb.col.name'),
      priority: 'primary',
      value: (r) => r.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {data.type !== 'projects' && <Avatar name={r.name} seed={r.id} size={24} />}
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.name}</span>
            {r.sub && <span className="block truncate text-xs text-text-muted">{r.sub}</span>}
          </span>
        </span>
      ),
    },
    { key: 'score', header: t('perf.lb.col.score'), align: 'right', value: (r) => r.score ?? -1, cell: (r) => <span className="font-semibold tabular">{scoreText(r.score)}</span> },
    ...(data.summary_only
      ? []
      : [
          ...(data.type !== 'projects' ? [{ key: 'goals', header: t('perf.lb.col.goals'), align: 'right' as const, value: (r: LeaderboardRow) => r.goals?.completed ?? -1, cell: (r: LeaderboardRow) => <span className="tabular text-sm">{ratio(r.goals)}</span> }] : []),
          { key: 'delivery', header: t('perf.lb.col.delivery'), align: 'right' as const, value: (r: LeaderboardRow) => r.delivery?.on_time ?? -1, cell: (r: LeaderboardRow) => <span className="tabular text-sm">{ratio(r.delivery)}</span> },
          ...(data.type !== 'projects' ? [{ key: 'achievements', header: t('perf.lb.col.achievements'), align: 'right' as const, value: (r: LeaderboardRow) => r.achievements, cell: (r: LeaderboardRow) => <span className="tabular text-sm">{r.achievements}</span> }] : []),
          { key: 'trend', header: t('perf.lb.col.trend'), align: 'right' as const, cell: (r: LeaderboardRow) => <Sparkline values={r.trend} label={t('perf.lb.trendLabel', { name: r.name })} className="ml-auto" /> },
        ]),
  ];
  return (
    <DataTable
      rows={data.rows}
      columns={columns}
      rowKey={(r) => r.id}
      initialSort={{ key: 'rank', dir: 'asc' }}
      onRowClick={onOpen ? (r) => onOpen(r.id) : undefined}
      empty={<EmptyState title={t('perf.lb.empty')} description={t('perf.lb.emptyHint', { days: data.min_eligible_days })} />}
    />
  );
}

/** Who sees rankings; admins switch managers and workers on or off here. */
function WhoCanSee({ settings, canManage }: { settings: PerformanceSettingsDto | undefined; canManage: boolean }) {
  const toast = useToast();
  const save = useOrgMutation<{ leaderboard_managers?: boolean; leaderboard_workers?: boolean }, PerformanceSettingsDto>('PUT', '/performance/settings', { invalidate: ['/performance'] });
  const set = async (body: { leaderboard_managers?: boolean; leaderboard_workers?: boolean }) => {
    try {
      await save.mutateAsync(body);
      toast.success(t('perf.lb.who.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const row = (label: string, hint: string, value: boolean | null, onChange?: (v: boolean) => void) =>
    canManage && onChange && value !== null ? (
      <Switch label={label} description={hint} checked={value} disabled={save.isPending} onCheckedChange={onChange} />
    ) : (
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block text-xs text-text-muted">{hint}</span>
        </span>
        {value !== null && <Badge tone={value ? 'success' : 'neutral'}>{t(value ? 'perf.lb.who.on' : 'perf.lb.who.off')}</Badge>}
      </div>
    );
  return (
    <Panel bodyClassName="space-y-3 p-4" title={t('perf.lb.who.title')} actions={<ShieldCheck className="size-4 text-text-muted" aria-hidden />}>
      {!settings ? (
        <SkeletonRows rows={3} cols={1} />
      ) : (
        <>
          {row(t('perf.lb.who.admins'), t('perf.lb.who.adminsHint'), null)}
          {row(t('perf.lb.who.managers'), t('perf.lb.who.managersHint'), settings.leaderboard_managers, (v) => set({ leaderboard_managers: v }))}
          {row(t('perf.lb.who.workers'), t('perf.lb.who.workersHint'), settings.leaderboard_workers, (v) => set({ leaderboard_workers: v }))}
          <p className="flex gap-1.5 text-xs text-text-muted">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            {t('perf.parts.note')}
          </p>
        </>
      )}
    </Panel>
  );
}
