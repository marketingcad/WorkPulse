'use client';
import { useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { UsageRowDto } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, ErrorState, FilterBar, Panel, PermissionState, SegmentedControl, SkeletonRows, fmtPct, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { StackedBars } from '@/components/charts';
import { DateRangeFilter, MemberFilter, useDefaultRange } from './filters';
import { SpansDrawer } from './spans-drawer';
import type { DateRange } from './time';

type GroupBy = 'name' | 'worker' | 'project';
interface GroupRow {
  key: string;
  label: string;
  seconds: number;
  top: string[];
}

export function UsageView({ kind, initialMember }: { kind: 'apps' | 'urls'; initialMember?: string }) {
  const org = useOrg();
  const [range, setRange] = useState<DateRange>(useDefaultRange('this_week'));
  const [member, setMember] = useState(org.isManagerView ? (initialMember ?? '') : '');
  const [groupBy, setGroupBy] = useState<GroupBy>('name');
  const [spans, setSpans] = useState<{ membershipId: string; name: string; date: string } | null>(null);
  const allowed = org.can('apps:read');
  const noun = kind === 'apps' ? 'App' : 'Site';
  const q = useOrgQuery<UsageRowDto[] | GroupRow[]>(allowed ? `/${kind}${qs({ from: range.from, to: range.to, membership_ids: member || undefined, group_by: groupBy })}` : null);

  const tz = org.membership.timezone || org.organization.timezone;
  const today = todayIn(tz);
  const spanDate = range.to > today ? today : range.to;
  const byName = groupBy === 'name' ? (q.data as UsageRowDto[] | undefined) : undefined;
  const grouped = groupBy !== 'name' ? (q.data as GroupRow[] | undefined) : undefined;
  const total = useMemo(() => (q.data ?? []).reduce((s, r) => s + r.seconds, 0), [q.data]);

  if (!allowed) return <PermissionState message={`You don’t have access to ${kind === 'apps' ? 'app' : 'URL'} usage.`} />;

  const nameCols: Column<UsageRowDto>[] = [
    { key: 'name', header: noun, cell: (r) => <span className="block max-w-96 truncate font-medium" title={r.name}>{r.name}</span>, value: (r) => r.name, priority: 'primary' },
    { key: 'time', header: 'Time', cell: (r) => org.fmtDuration(r.seconds), value: (r) => r.seconds, align: 'right', priority: 'secondary' },
    { key: 'pct', header: 'Share', cell: (r) => fmtPct(r.pct), value: (r) => r.pct, align: 'right', priority: 'secondary' },
    { key: 'workers', header: 'Members', cell: (r) => r.workers, value: (r) => r.workers, align: 'right' },
  ];
  const groupCols: Column<GroupRow>[] = [
    { key: 'label', header: groupBy === 'worker' ? 'Member' : 'Project', cell: (r) => <span className="font-medium">{r.label || '—'}</span>, value: (r) => r.label, priority: 'primary' },
    { key: 'time', header: 'Time', cell: (r) => org.fmtDuration(r.seconds), value: (r) => r.seconds, align: 'right', priority: 'secondary' },
    { key: 'pct', header: 'Share', cell: (r) => fmtPct(total ? (r.seconds / total) * 100 : 0), value: (r) => r.seconds, align: 'right' },
    { key: 'top', header: `Top ${kind === 'apps' ? 'apps' : 'sites'}`, sortable: false, cell: (r) => <span className="block max-w-96 truncate text-xs text-text-muted" title={r.top.join(', ')}>{r.top.join(' · ') || '—'}</span>, priority: 'secondary' },
    ...(groupBy === 'worker'
      ? [
          {
            key: 'spans',
            header: <span className="sr-only">Timeline</span>,
            sortable: false,
            cell: (r: GroupRow) => (
              <div className="flex justify-end">
                <Button size="xs" variant="ghost" icon={<ListTree className="size-3.5" />} onClick={() => setSpans({ membershipId: r.key, name: r.label, date: spanDate })}>
                  Day timeline
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const chartRows = (byName ?? []).slice(0, 10).map((r) => ({ label: r.name, value: r.seconds }));
  const chartGroupRows = (grouped ?? []).slice(0, 10).map((r) => ({ label: r.label || '—', value: r.seconds, sub: r.top[0] }));
  const empty = <EmptyState title={`No ${kind === 'apps' ? 'app' : 'URL'} usage in this period`} description="Usage is recorded by the desktop app when your tracking policy enables it. Try a wider date range." />;

  return (
    <>
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} />
        <SegmentedControl
          label="Group by"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'name', label: noun },
            ...(org.isManagerView ? [{ value: 'worker' as const, label: 'Member' }] : []),
            { value: 'project', label: 'Project' },
          ]}
        />
        {!org.isManagerView && (
          <Button size="sm" icon={<ListTree className="size-3.5" />} onClick={() => setSpans({ membershipId: org.membership.id, name: 'You', date: spanDate })}>
            Day timeline
          </Button>
        )}
      </FilterBar>
      {q.error ? (
        <Panel>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title={`${kind === 'apps' ? 'Apps' : 'URLs'} by ${groupBy === 'name' ? (kind === 'apps' ? 'app' : 'site') : groupBy === 'worker' ? 'member' : 'project'}`} actions={q.data && <span className="tabular text-xs text-text-muted">{org.fmtDuration(total)} total</span>}>
            {groupBy === 'name' ? (
              <DataTable rows={byName} columns={nameCols} rowKey={(r) => r.name} loading={q.isLoading} searchable searchPlaceholder={`Search ${kind === 'apps' ? 'apps' : 'sites'}…`} initialSort={{ key: 'time', dir: 'desc' }} empty={empty} caption={`${noun} usage`} />
            ) : (
              <DataTable rows={grouped} columns={groupCols} rowKey={(r) => r.key} loading={q.isLoading} searchable initialSort={{ key: 'time', dir: 'desc' }} empty={empty} caption={`${noun} usage by ${groupBy}`} />
            )}
          </Panel>
          <Panel title={`Top 10 ${groupBy === 'name' ? (kind === 'apps' ? 'apps' : 'sites') : groupBy === 'worker' ? 'members' : 'projects'} by time`}>
            {q.isLoading ? (
              <SkeletonRows rows={5} cols={2} />
            ) : (groupBy === 'name' ? chartRows : chartGroupRows).length ? (
              <div className="p-4">
                <StackedBars rows={groupBy === 'name' ? chartRows : chartGroupRows} format={org.fmtDuration} />
              </div>
            ) : (
              <EmptyState title="Nothing to chart" />
            )}
          </Panel>
        </div>
      )}
      <SpansDrawer kind={kind} target={spans} onDateChange={(date) => setSpans((s) => (s ? { ...s, date } : s))} onClose={() => setSpans(null)} />
    </>
  );
}
