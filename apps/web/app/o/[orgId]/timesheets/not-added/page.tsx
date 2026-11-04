'use client';
import Link from 'next/link';
import type { RefusedTimeDto } from '@tallywork/contracts';
import { refusedReason } from '@tallywork/domain';
import { Badge, DataTable, EmptyState, ErrorState, FilterBar, PageHeader, Panel, PermissionState, PersonCell, SegmentedControl, fmtDateTime, fmtTime, type Column, type Tone } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useUrlRange, useUrlValue } from '@/lib/url-state';
import { DateRangeFilter } from '@/components/tracking/filters';

const STATUS: Record<RefusedTimeDto['status'], { label: string; tone: Tone; next: string }> = {
  OPEN: { label: 'Not resolved', tone: 'warning', next: 'The member can ask for this time from the desktop app. It then waits for approval in Manual time.' },
  CORRECTION_REQUESTED: { label: 'Waiting for approval', tone: 'info', next: 'The member asked for this time as manual time. Approve or reject it in Approvals.' },
  CORRECTED: { label: 'Added after approval', tone: 'success', next: 'Approved as manual time: it is in the member’s timesheet.' },
  CORRECTION_DECLINED: { label: 'Request rejected', tone: 'neutral', next: 'The member’s manual time request for it was rejected or cancelled.' },
  DISMISSED: { label: 'Removed by the member', tone: 'neutral', next: 'The member removed it without asking for the time.' },
};

/**
 * Time not added: time a member's desktop app recorded (usually offline) that the server refused when
 * it arrived, because something changed meanwhile. It is never added on its own: the member asks for
 * it as manual time, which goes through the usual approval. Shows who, when, how long, why, and where
 * each one stands, for the members this person may see.
 */
export default function TimeNotAddedPage() {
  const org = useOrg();
  const [range, setRange] = useUrlRange('this_week');
  const [show, setShow] = useUrlValue<'open' | 'all'>('show', 'open', ['open', 'all']);
  const allowed = org.can('tracking:read');
  const q = useOrgQuery<RefusedTimeDto[]>(allowed ? `/time-not-added${qs({ from: range.from, to: range.to, status: show })}` : null);
  const canApprove = org.can('manual_time:approve');

  if (!allowed) return <PermissionState />;

  const columns: Column<RefusedTimeDto>[] = [
    { key: 'member', header: 'Member', cell: (r) => <PersonCell name={r.worker_name} />, value: (r) => r.worker_name, priority: 'primary' },
    {
      key: 'when',
      header: 'When',
      cell: (r) => (
        <span className="tabular whitespace-nowrap">
          {fmtDateTime(r.started_at)} – {fmtTime(r.ended_at)}
        </span>
      ),
      value: (r) => r.started_at,
      priority: 'secondary',
    },
    { key: 'duration', header: 'Duration', align: 'right', cell: (r) => org.fmtDuration(r.duration_seconds), value: (r) => r.duration_seconds, priority: 'secondary' },
    { key: 'project', header: 'Project', cell: (r) => r.project_name ?? <span className="text-text-muted">Unknown project</span>, value: (r) => r.project_name ?? '' },
    {
      key: 'why',
      header: 'Why it was not added',
      cell: (r) => (
        <span className="block max-w-80 text-xs">
          {refusedReason(r.code, r.message, { audience: 'manager' })}
          {r.worker_reason && <span className="mt-0.5 block text-text-muted">Member’s reason: “{r.worker_reason}”</span>}
        </span>
      ),
      sortable: false,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="block max-w-64">
          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
          <span className="mt-0.5 block text-2xs text-text-muted">{STATUS[r.status].next}</span>
        </span>
      ),
      value: (r) => r.status,
      priority: 'secondary',
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        r.status === 'CORRECTION_REQUESTED' && canApprove ? (
          <Link href={`${org.base}/timesheets/approvals`} className="text-sm font-medium text-interactive hover:underline">
            Review request
          </Link>
        ) : null,
      sortable: false,
    },
  ];

  return (
    <>
      <PageHeader
        title="Time not added"
        description="Time a member’s desktop app recorded but the server could not add, usually because something changed while they were offline. It is never added on its own: the member asks for it as manual time, and you approve it as usual."
       
      />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <SegmentedControl
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'open', label: 'Needs attention' },
            { value: 'all', label: 'All' },
          ]}
        />
      </FilterBar>
      <Panel title="Time not added" actions={q.data && <span className="tabular text-xs text-text-muted">{q.data.length} {q.data.length === 1 ? 'item' : 'items'} · {org.fmtDuration(q.data.reduce((s, r) => s + r.duration_seconds, 0))}</span>}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            columns={columns}
            rowKey={(r) => r.id}
            loading={q.isLoading}
            caption="Time not added"
            initialSort={{ key: 'when', dir: 'desc' }}
            empty={
              <EmptyState
                title={show === 'open' ? 'Nothing needs attention' : 'No time was refused in this period'}
                description={show === 'open' ? 'Time the server could not add, and corrections waiting for approval, show here.' : 'Try a wider date range.'}
              />
            }
          />
        )}
      </Panel>
    </>
  );
}
