'use client';
import { useMemo, useState } from 'react';
import type { SessionDto } from '@tallywork/contracts';
import { DataTable, EmptyState, ErrorState, FilterBar, PageHeader, Panel, PermissionState, PersonCell, StatusBadge, fmtDateTime, fmtTime, humanize, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { DateRangeFilter, MemberFilter, useDefaultRange } from '@/components/tracking/filters';
import { SessionDrawer } from '@/components/tracking/session-drawer';
import type { DateRange } from '@/components/tracking/time';

export default function SessionsPage() {
  const org = useOrg();
  const [range, setRange] = useState<DateRange>(useDefaultRange('this_week'));
  const [member, setMember] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const allowed = org.can('tracking:read');
  const q = useOrgQuery<SessionDto[]>(allowed ? `/sessions${qs({ from: range.from, to: range.to, membership_ids: member || undefined })}` : null);
  const total = useMemo(() => (q.data ?? []).reduce((s, x) => s + x.worked_seconds, 0), [q.data]);

  if (!allowed) return <PermissionState />;

  const sameDay = (a: string, b: string | null) => !!b && new Date(a).toDateString() === new Date(b).toDateString();
  const columns: Column<SessionDto>[] = [
    ...(org.isManagerView ? [{ key: 'member', header: 'Member', cell: (s: SessionDto) => <PersonCell name={s.worker_name ?? ''} />, value: (s: SessionDto) => s.worker_name ?? '', priority: 'primary' as const }] : []),
    {
      key: 'project',
      header: 'Project / task',
      cell: (s) => (
        <span className="block max-w-72 truncate">
          {s.project_name}
          {s.task_title && <span className="text-text-muted"> / {s.task_title}</span>}
        </span>
      ),
      value: (s) => `${s.project_name ?? ''} ${s.task_title ?? ''}`,
      priority: org.isManagerView ? 'secondary' : 'primary',
    },
    { key: 'source', header: 'Source', cell: (s) => <StatusBadge status={s.source} />, value: (s) => s.source },
    { key: 'state', header: 'State', cell: (s) => <StatusBadge status={s.state === 'ACTIVE' ? 'TRACKING' : s.state} />, value: (s) => s.state, priority: 'secondary' },
    { key: 'start', header: 'Start', cell: (s) => <span className="tabular whitespace-nowrap">{fmtDateTime(s.started_at)}</span>, value: (s) => s.started_at, priority: 'secondary' },
    { key: 'end', header: 'End', cell: (s) => <span className="tabular whitespace-nowrap text-text-muted">{s.ended_at ? (sameDay(s.started_at, s.ended_at) ? fmtTime(s.ended_at) : fmtDateTime(s.ended_at)) : 'Running'}</span>, value: (s) => s.ended_at ?? '' },
    { key: 'worked', header: 'Worked', cell: (s) => org.fmtDuration(s.worked_seconds), value: (s) => s.worked_seconds, align: 'right', priority: 'secondary' },
    { key: 'reason', header: 'End reason', cell: (s) => <span className="text-xs text-text-muted">{s.end_reason ? humanize(s.end_reason) : '—'}</span>, value: (s) => s.end_reason ?? '' },
  ];

  return (
    <>
      <PageHeader title="Sessions" description="Every tracking session with its source, state and how it ended. Open one to see its full state history." />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} />
      </FilterBar>
      <Panel title="Sessions" actions={q.data && <span className="tabular text-xs text-text-muted">{q.data.length} sessions · {org.fmtDuration(total)} worked</span>}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            columns={columns}
            rowKey={(s) => s.id}
            loading={q.isLoading}
            searchable
            searchPlaceholder="Search sessions…"
            onRowClick={(s) => setOpen(s.id)}
            initialSort={{ key: 'start', dir: 'desc' }}
            caption="Tracking sessions"
            empty={<EmptyState title="No sessions in this period" description="Try a wider date range. Sessions appear when someone tracks time in the desktop app or with the web timer." />}
          />
        )}
        {q.data && q.data.length >= 500 && <p className="border-t border-border px-4 py-2 text-xs text-text-muted">Showing the 500 most recent sessions. Narrow the date range to see older ones.</p>}
      </Panel>
      <SessionDrawer sessionId={open} onClose={() => setOpen(null)} />
    </>
  );
}
