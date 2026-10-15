'use client';
import { useState } from 'react';
import type { OffsetPage, SessionDto } from '@tallywork/contracts';
import { DataTable, EmptyState, ErrorState, FilterBar, Input, PageHeader, Panel, PermissionState, PersonCell, StatusBadge, fmtDateTime, fmtTime, humanize, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { DateRangeFilter, MemberFilter, useDefaultRange } from '@/components/tracking/filters';
import { SessionDrawer } from '@/components/tracking/session-drawer';
import type { DateRange } from '@/components/tracking/time';

export default function SessionsPage() {
  const org = useOrg();
  const [range, setRange] = useState<DateRange>(useDefaultRange('this_week'));
  const [member, setMember] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const allowed = org.can('tracking:read');
  const search = useSearch();
  // The server pages every session in the range and adds up the time worked across all of them.
  const filters = { from: range.from, to: range.to, membership_ids: member || undefined, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<SessionDto> & { summary: { worked_seconds: number } }>(allowed ? `/sessions${qs({ ...filters, ...paging.params })}` : null, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);

  if (!allowed) return <PermissionState />;

  const sameDay = (a: string, b: string | null) => !!b && new Date(a).toDateString() === new Date(b).toDateString();
  // Rows arrive ordered (newest first) and paged by the server, so columns are not client-sortable.
  const columns: Column<SessionDto>[] = [
    ...(org.isManagerView ? [{ key: 'member', header: 'Member', cell: (s: SessionDto) => <PersonCell name={s.worker_name ?? ''} />, sortable: false, priority: 'primary' as const }] : []),
    {
      key: 'project',
      header: 'Project / task',
      cell: (s) => (
        <span className="block max-w-72 truncate">
          {s.project_name}
          {s.task_title && <span className="text-text-muted"> / {s.task_title}</span>}
        </span>
      ),
      sortable: false,
      priority: org.isManagerView ? 'secondary' : 'primary',
    },
    { key: 'source', header: 'Source', cell: (s) => <StatusBadge status={s.source} />, sortable: false },
    { key: 'state', header: 'State', cell: (s) => <StatusBadge status={s.state === 'ACTIVE' ? 'TRACKING' : s.state} />, sortable: false, priority: 'secondary' },
    { key: 'start', header: 'Start', cell: (s) => <span className="tabular whitespace-nowrap">{fmtDateTime(s.started_at)}</span>, sortable: false, priority: 'secondary' },
    { key: 'end', header: 'End', cell: (s) => <span className="tabular whitespace-nowrap text-text-muted">{s.ended_at ? (sameDay(s.started_at, s.ended_at) ? fmtTime(s.ended_at) : fmtDateTime(s.ended_at)) : 'Running'}</span>, sortable: false },
    { key: 'worked', header: 'Worked', cell: (s) => org.fmtDuration(s.worked_seconds), sortable: false, align: 'right', priority: 'secondary' },
    { key: 'reason', header: 'End reason', cell: (s) => <span className="text-xs text-text-muted">{s.end_reason ? humanize(s.end_reason) : '—'}</span>, sortable: false },
  ];

  return (
    <>
      <PageHeader title="Sessions" description="Every tracking session with its source, state and how it ended. Open one to see its full state history." />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} />
        <Input aria-label="Search sessions" placeholder="Search member or project…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-64" />
      </FilterBar>
      <Panel title="Sessions" actions={q.data && <span className="tabular text-xs text-text-muted">{q.data.total} sessions · {org.fmtDuration(q.data.summary.worked_seconds)} worked</span>}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            columns={columns}
            rowKey={(s) => s.id}
            loading={q.isLoading}
            pagination={paging.pagination(q.data)}
            onRowClick={(s) => setOpen(s.id)}
            caption="Tracking sessions"
            empty={
              search.term ? (
                <EmptyState title="No sessions match your search" />
              ) : (
                <EmptyState title="No sessions in this period" description="Try a wider date range. Sessions appear when someone tracks time in the desktop app or with the web timer." />
              )
            }
          />
        )}
      </Panel>
      <SessionDrawer sessionId={open} onClose={() => setOpen(null)} />
    </>
  );
}
