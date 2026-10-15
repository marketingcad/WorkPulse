'use client';
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { OffsetPage } from '@tallywork/contracts';
import { Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, Panel, PersonCell, SegmentedControl, StatusBadge, Textarea, fmtRelative, useToast, type Column } from '@tallywork/ui';
import { api, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { useQueryClient } from '@tanstack/react-query';
import { dateRangeLabel, fmtHours, type TimeOffRequest, type TimeOffStatus } from './shared';

type Decision = { id: string; action: 'approve' | 'reject' | 'cancel'; comment?: string | null };

export function TimeOffRequests() {
  const org = useOrg();
  const toast = useToast();
  const qc = useQueryClient();
  const me = org.membership.id;
  const [status, setStatus] = useState<TimeOffStatus>('PENDING');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<TimeOffRequest | null>(null);
  const [cancelling, setCancelling] = useState<TimeOffRequest | null>(null);
  const [comment, setComment] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const search = useSearch();
  // The server searches and pages every request (approved ones keep growing), not only the latest 500.
  const filters = { status, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<TimeOffRequest>>(`/time-off/requests${qs({ ...filters, ...paging.params })}`, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const decide = useOrgMutation<Decision>('POST', (b) => `/time-off/requests/${b.id}/${b.action}`);

  const run = async (b: Decision, msg: string) => {
    try {
      await decide.mutateAsync({ ...b, comment: b.comment?.trim() || null });
      toast.success(msg);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const bulkApprove = async (ids: string[]) => {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await api(`/orgs/${org.organization.id}/time-off/requests/${id}/approve`, { method: 'POST', body: {} });
        ok++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ['org', org.organization.id] });
    if (ok) toast.success(`${ok} request${ok === 1 ? '' : 's'} approved`);
    if (failed) toast.error(`${failed} request${failed === 1 ? '' : 's'} could not be approved`);
  };

  const columns: Column<TimeOffRequest>[] = [
    { key: 'member', header: 'Member', cell: (r) => <PersonCell name={r.worker_name} sub={r.policy_name} />, value: (r) => r.worker_name, priority: 'primary' },
    { key: 'dates', header: 'Dates', cell: (r) => <span className="tabular whitespace-nowrap">{dateRangeLabel(r.start_date, r.end_date)}</span>, value: (r) => r.start_date, priority: 'secondary' },
    { key: 'hours', header: 'Hours', align: 'right', cell: (r) => `${fmtHours(r.hours)}${r.half_day ? ' (½)' : ''}`, value: (r) => r.hours, priority: 'secondary' },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-64 text-xs text-text-muted" title={r.reason ?? undefined}>{r.reason || '—'}</span>, value: (r) => r.reason },
    { key: 'requested', header: 'Requested', cell: (r) => <span className="text-xs text-text-muted">{fmtRelative(r.created_at)}</span>, value: (r) => r.created_at },
    ...(status === 'PENDING'
      ? []
      : [
          {
            key: 'decided',
            header: 'Decision',
            cell: (r: TimeOffRequest) => (
              <div className="max-w-64 text-xs">
                <StatusBadge status={r.status} />
                <div className="mt-0.5 truncate text-text-muted" title={r.decision_comment ?? undefined}>
                  {r.decided_by_name ?? (r.status === 'APPROVED' ? 'Auto-approved' : '')}
                  {r.decision_comment ? ` · “${r.decision_comment}”` : ''}
                </div>
              </div>
            ),
            value: (r: TimeOffRequest) => r.decided_at,
          },
        ]),
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => {
        const own = r.membership_id === me;
        if (r.status === 'PENDING')
          return own ? (
            <span className="text-xs text-text-faint">Your request</span>
          ) : (
            <div className="flex justify-end gap-1">
              <Button size="xs" variant="subtle" icon={<Check className="size-3" />} onClick={() => run({ id: r.id, action: 'approve' }, `Approved ${r.worker_name}'s time off`)} disabled={decide.isPending}>
                Approve
              </Button>
              <Button size="xs" variant="ghost" icon={<X className="size-3" />} onClick={() => (setComment(''), setRejecting(r))}>
                Reject
              </Button>
            </div>
          );
        if (r.status === 'APPROVED')
          return (
            <Button size="xs" variant="ghost" onClick={() => setCancelling(r)}>
              Cancel
            </Button>
          );
        return null;
      },
    },
  ];

  return (
    <Panel
      title="Requests"
      actions={
        <SegmentedControl
          size="xs"
          label="Status"
          value={status}
          onChange={(s) => (setStatus(s), setSelected(new Set()))}
          options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data?.data}
          loading={q.isLoading}
          columns={columns.map((c) => ({ ...c, sortable: false }))}
          rowKey={(r) => r.id}
          pagination={paging.pagination(q.data)}
          toolbar={<Input aria-label="Search time off requests" placeholder="Search members, policies or reasons…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-72" />}
          caption="Time off requests"
          selectable={status === 'PENDING'}
          selected={selected}
          onSelectedChange={(s) => setSelected(new Set([...s].filter((id) => q.data?.data.find((r) => r.id === id)?.membership_id !== me)))}
          bulkActions={(ids) => (
            <Button size="xs" variant="primary" icon={<Check className="size-3" />} loading={bulkBusy} onClick={() => bulkApprove(ids)}>
              Approve {ids.length}
            </Button>
          )}
          empty={<EmptyState title={search.term ? 'No requests match your search' : status === 'PENDING' ? 'No requests waiting for you' : `No ${status.toLowerCase()} requests`} description={status === 'PENDING' ? 'New requests from your team will show up here.' : undefined} />}
        />
      )}

      <Dialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject request"
        description={rejecting ? `${rejecting.worker_name} · ${rejecting.policy_name} · ${dateRangeLabel(rejecting.start_date, rejecting.end_date)}` : undefined}
        footer={
          <>
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={decide.isPending}
              onClick={async () => {
                if (rejecting && (await run({ id: rejecting.id, action: 'reject', comment }, 'Request rejected'))) setRejecting(null);
              }}
            >
              Reject
            </Button>
          </>
        }
      >
        <Field label="Comment" htmlFor="rej-comment" hint="Shared with the member so they know what to change.">
          <Textarea id="rej-comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel approved time off?"
        description={cancelling ? `${cancelling.worker_name}'s ${cancelling.policy_name} (${dateRangeLabel(cancelling.start_date, cancelling.end_date)}) will be cancelled and ${fmtHours(cancelling.hours)} returned to their balance.` : undefined}
        confirmLabel="Cancel time off"
        danger
        loading={decide.isPending}
        onConfirm={async () => {
          if (cancelling && (await run({ id: cancelling.id, action: 'cancel' }, 'Time off cancelled'))) setCancelling(null);
        }}
      />
    </Panel>
  );
}
