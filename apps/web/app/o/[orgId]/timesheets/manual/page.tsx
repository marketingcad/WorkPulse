'use client';
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { ManualTimeDto } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, ErrorState, PageHeader, Panel, PermissionState, PersonCell, StatusBadge, Tabs, fmtDate, fmtDateTime, fmtTime, useToast, type Column } from '@tallywork/ui';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs, useOrgId, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { CommentDialog, ManualTimeDialog } from '@/components/timesheets/entry-dialogs';

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

export default function ManualTimePage() {
  const org = useOrg();
  const toast = useToast();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('PENDING');
  const [requesting, setRequesting] = useState(false);
  const [rejecting, setRejecting] = useState<ManualTimeDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canRequest = org.can('manual_time:request');
  const canApprove = org.can('manual_time:approve');
  const allowed = canRequest || canApprove;
  const q = useOrgQuery<ManualTimeDto[]>(allowed ? `/manual-time${qs({ status: tab === 'ALL' ? undefined : tab })}` : null);
  const pendingQ = useOrgQuery<ManualTimeDto[]>(allowed ? '/manual-time?status=PENDING' : null);

  if (!allowed) return <PermissionState />;

  const mayDecide = (r: ManualTimeDto) => canApprove && r.status === 'PENDING' && r.membership_id !== org.membership.id;
  const showMember = org.isManagerView || canApprove;

  const decide = async (r: ManualTimeDto, approve: boolean, comment?: string) => {
    await api(`/orgs/${orgId}/manual-time/${r.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { comment: comment || undefined } });
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
    toast.success(approve ? `Approved ${org.fmtDuration(r.duration_seconds)} for ${r.worker_name}; added to the timesheet` : `Rejected request from ${r.worker_name}`);
  };
  const approve = async (r: ManualTimeDto) => {
    setBusy(r.id);
    try {
      await decide(r, true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<ManualTimeDto>[] = [
    ...(showMember ? [{ key: 'member', header: 'Member', cell: (r: ManualTimeDto) => <PersonCell name={r.worker_name} />, value: (r: ManualTimeDto) => r.worker_name, priority: 'primary' } satisfies Column<ManualTimeDto>] : []),
    {
      key: 'when',
      header: 'When',
      priority: showMember ? 'secondary' : 'primary',
      value: (r) => r.started_at,
      cell: (r) => (
        <span className="tabular whitespace-nowrap">
          {fmtDate(r.started_at, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(r.started_at)}–{fmtTime(r.ended_at)}
        </span>
      ),
    },
    { key: 'duration', header: 'Duration', align: 'right', value: (r) => r.duration_seconds, cell: (r) => <span className="font-medium">{org.fmtDuration(r.duration_seconds)}</span>, priority: 'secondary' },
    { key: 'project', header: 'Project', value: (r) => r.project_name, cell: (r) => <span className="block max-w-48 truncate">{r.project_name}</span> },
    {
      key: 'reason',
      header: 'Reason / note',
      value: (r) => `${r.reason ?? ''} ${r.note ?? ''}`,
      cell: (r) => (
        <span className="block max-w-72">
          {r.reason ? <span className="block truncate" title={r.reason}>{r.reason}</span> : <span className="text-text-faint">No reason given</span>}
          {r.note && <span className="block truncate text-xs text-text-muted" title={r.note}>{r.note}</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} />, priority: 'secondary' },
    { key: 'created', header: 'Requested', value: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-xs text-text-muted">{fmtDateTime(r.created_at)}</span> },
    ...(canApprove
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            sortable: false,
            cell: (r: ManualTimeDto) =>
              mayDecide(r) ? (
                <span className="inline-flex gap-1">
                  <Button size="xs" variant="subtle" icon={<Check className="size-3" />} loading={busy === r.id} onClick={() => approve(r)}>
                    Approve
                  </Button>
                  <Button size="xs" icon={<X className="size-3" />} onClick={() => setRejecting(r)}>
                    Reject
                  </Button>
                </span>
              ) : null,
          } satisfies Column<ManualTimeDto>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Manual time"
        description={canApprove ? 'Requests to add time the timer did not capture. Approved time is added to the member’s timesheet.' : 'Your requests to add time the timer did not capture.'}
        actions={
          canRequest && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRequesting(true)}>
              Request manual time
            </Button>
          )
        }
      />
      <Panel>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          items={[
            { value: 'PENDING', label: 'Pending', count: pendingQ.data?.length },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'ALL', label: 'All' },
          ]}
        />
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(r) => r.id}
            searchable
            searchPlaceholder="Search member, project, reason…"
            caption="Manual time requests"
            empty={
              <EmptyState
                title={tab === 'PENDING' ? 'No pending requests' : 'No requests here'}
                description={canRequest ? 'Worked away from the computer? Request manual time and it will be added once approved.' : undefined}
                action={
                  canRequest && (
                    <Button icon={<Plus className="size-3.5" />} onClick={() => setRequesting(true)}>
                      Request manual time
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Panel>
      {requesting && <ManualTimeDialog membershipId={org.membership.id} defaultDate={todayIn(org.membership.timezone || org.organization.timezone)} onClose={() => setRequesting(false)} />}
      {rejecting && (
        <CommentDialog
          title="Reject manual time"
          description={`${rejecting.worker_name} · ${org.fmtDuration(rejecting.duration_seconds)} on ${rejecting.project_name}`}
          confirmLabel="Reject"
          danger
          required
          onConfirm={(c) => decide(rejecting, false, c)}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}
