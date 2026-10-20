'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCheck, ExternalLink } from 'lucide-react';
import type { ApprovalQueueItemDto, OffsetPage } from '@tallywork/contracts';
import { ActivityBar, Button, DataTable, Drawer, EmptyState, ErrorState, Input, Panel, PersonCell, StatusBadge, Tabs, cx, fmtDateTime, useToast, type Column } from '@tallywork/ui';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { TimesheetView } from '@/components/timesheets/timesheet-view';
import { FlagBadges, periodLabel, type BulkResult } from '@/components/timesheets/shared';

type Status = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** Timesheets waiting for a decision (and decided ones), with bulk approve and a drawer per sheet. */
export function ApprovalQueue() {
  const org = useOrg();
  const toast = useToast();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('SUBMITTED');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ApprovalQueueItemDto | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; failed: Array<{ name: string; error: string }> } | null>(null);
  const allowed = org.can('timesheets:approve');
  const search = useSearch();
  // The server pages the queue (approved timesheets keep growing) and counts every pending one.
  const filters = { status, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<ApprovalQueueItemDto>>(allowed ? `/timesheets/approvals${qs({ ...filters, ...paging.params })}` : null, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const pendingQ = useOrgQuery<OffsetPage<ApprovalQueueItemDto>>(allowed ? '/timesheets/approvals?status=SUBMITTED&page=1&page_size=1' : null);

  if (!allowed) return null;

  const d = org.fmtDuration;
  const bulkApprove = async (ids: string[]) => {
    setBulkBusy(true);
    setBulkSummary(null);
    try {
      const res = await api<BulkResult[]>(`/orgs/${orgId}/timesheets/bulk-approve`, { method: 'POST', body: { ids } });
      const byId = new Map((q.data?.data ?? []).map((r) => [r.timesheet_id, r.worker_name]));
      const ok = res.filter((r) => r.ok).length;
      const failed = res.filter((r) => !r.ok).map((r) => ({ name: byId.get(r.id) ?? r.id, error: r.error ?? 'Failed' }));
      setBulkSummary({ ok, failed });
      setSelected(new Set(failed.length ? res.filter((r) => !r.ok).map((r) => r.id) : []));
      if (failed.length) toast.error(`${ok} approved, ${failed.length} could not be approved`);
      else toast.success(`${ok} timesheet${ok === 1 ? '' : 's'} approved`);
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: Column<ApprovalQueueItemDto>[] = [
    { key: 'member', header: 'Member', cell: (r) => <PersonCell name={r.worker_name} />, value: (r) => r.worker_name, priority: 'primary' },
    { key: 'period', header: 'Period', cell: (r) => <span className="tabular whitespace-nowrap">{periodLabel(r.period_start, r.period_end)}</span>, value: (r) => r.period_start, priority: 'secondary' },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <span className="font-medium">{d(r.total_seconds)}</span>, value: (r) => r.total_seconds, priority: 'secondary' },
    { key: 'expected', header: 'Expected', align: 'right', cell: (r) => (r.expected_seconds != null ? d(r.expected_seconds) : <span className="text-text-faint">—</span>), value: (r) => r.expected_seconds ?? -1 },
    {
      key: 'variance',
      header: 'Variance',
      align: 'right',
      value: (r) => (r.expected_seconds != null ? r.total_seconds - r.expected_seconds : null),
      cell: (r) => {
        if (r.expected_seconds == null) return <span className="text-text-faint">—</span>;
        const v = r.total_seconds - r.expected_seconds;
        return <span className={cx(v < 0 ? 'text-warning' : 'text-text-muted')}>{v < 0 ? '−' : '+'}{d(Math.abs(v))}</span>;
      },
    },
    {
      key: 'manual',
      header: 'Manual',
      align: 'right',
      value: (r) => (r.total_seconds ? r.manual_seconds / r.total_seconds : 0),
      cell: (r) => <span className="text-text-muted">{r.total_seconds ? `${Math.round((r.manual_seconds / r.total_seconds) * 100)}%` : '–'}</span>,
    },
    { key: 'activity', header: 'Avg activity', cell: (r) => <ActivityBar pct={r.avg_activity_pct} />, value: (r) => r.avg_activity_pct ?? -1 },
    { key: 'flags', header: 'Flags', cell: (r) => <FlagBadges flags={r.flags} />, value: (r) => r.flags.length, priority: 'secondary' },
    { key: 'submitted', header: 'Submitted', cell: (r) => <span className="whitespace-nowrap text-xs text-text-muted">{fmtDateTime(r.submitted_at)}</span>, value: (r) => r.submitted_at ?? '' },
    ...(status !== 'SUBMITTED' ? [{ key: 'status', header: 'Status', cell: (r: ApprovalQueueItemDto) => <StatusBadge status={r.status} />, value: (r: ApprovalQueueItemDto) => r.status } satisfies Column<ApprovalQueueItemDto>] : []),
  ];

  return (
    <>
      <Panel
        title="Timesheets"
        actions={<Input aria-label="Search timesheets" placeholder="Search members…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-56" />}
      >
        <p className="border-b border-border px-5 py-2 text-xs text-text-muted">Submitted timesheets. Flags point to periods worth a closer look.</p>
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as Status);
            setSelected(new Set());
            setBulkSummary(null);
          }}
          items={[
            { value: 'SUBMITTED', label: 'Pending', count: pendingQ.data?.total },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        {bulkSummary && (
          <div role="status" className={cx('border-b border-border px-4 py-2.5 text-sm', bulkSummary.failed.length ? 'bg-warning-soft' : 'bg-success-soft')}>
            <span className="font-medium">{bulkSummary.ok} approved</span>
            {bulkSummary.failed.length > 0 && (
              <>
                <span>, {bulkSummary.failed.length} not approved:</span>
                <ul className="mt-1 list-inside list-disc text-text-muted">
                  {bulkSummary.failed.map((f, i) => (
                    <li key={i}>
                      <span className="text-text">{f.name}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button onClick={() => setBulkSummary(null)} className="ml-2 text-xs text-text-muted hover:text-text">
              Dismiss
            </button>
          </div>
        )}
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            loading={q.isLoading}
            columns={columns.map((c) => ({ ...c, sortable: false }))}
            rowKey={(r) => r.timesheet_id}
            pagination={paging.pagination(q.data)}
            onRowClick={setOpen}
            selectable={status === 'SUBMITTED'}
            selected={selected}
            onSelectedChange={setSelected}
            bulkActions={(ids) => (
              <Button size="xs" variant="primary" icon={<CheckCheck className="size-3.5" />} loading={bulkBusy} onClick={() => bulkApprove(ids)}>
                Approve {ids.length}
              </Button>
            )}
            caption="Timesheets"
            empty={
              <EmptyState
                title={search.term ? 'No timesheets match your search' : status === 'SUBMITTED' ? 'Nothing waiting for approval' : status === 'APPROVED' ? 'No approved timesheets' : 'No rejected timesheets'}
                description={status === 'SUBMITTED' ? 'Submitted timesheets from your team appear here.' : undefined}
              />
            }
          />
        )}
      </Panel>

      {open && (
        <Drawer
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={open.worker_name}
          subtitle={periodLabel(open.period_start, open.period_end)}
          width={820}
          actions={
            <Link href={`${org.base}/timesheets?member=${open.membership_id}&date=${open.period_start}`} className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-interactive hover:bg-surface-muted">
              <ExternalLink className="size-3.5" /> Open full page
            </Link>
          }
        >
          {open.flags.length > 0 && (
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-text-muted">
              Flags <FlagBadges flags={open.flags} />
            </div>
          )}
          <TimesheetView
            membershipId={open.membership_id}
            date={open.period_start}
            compact
            decisions
            onDecided={(_ts, action) => {
              if (action !== 'reopen') setOpen(null);
            }}
          />
        </Drawer>
      )}
    </>
  );
}
