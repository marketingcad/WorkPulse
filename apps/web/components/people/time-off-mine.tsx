'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, Panel, Select, StatusBadge, Textarea, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { dateRangeLabel, fmtHours, type TimeOffBalance, type TimeOffRequest } from './shared';

interface RequestBody {
  policy_id: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  reason: string | null;
}

export function MyTimeOff() {
  const org = useOrg();
  const toast = useToast();
  const me = org.membership.id;
  const balancesQ = useOrgQuery<TimeOffBalance[]>('/time-off/balances');
  const requestsQ = useOrgQuery<TimeOffRequest[]>(`/time-off/requests${qs({ membership_ids: [me] })}`);
  const [requestOpen, setRequestOpen] = useState(false);
  const [toCancel, setToCancel] = useState<TimeOffRequest | null>(null);
  const cancel = useOrgMutation<{ id: string }>('POST', (b) => `/time-off/requests/${b.id}/cancel`);
  const canRequest = org.can('time_off:request');
  // Approved time off that has started can only be cancelled by an approver (it may already be paid).
  const today = todayIn(org.membership.timezone || org.organization.timezone);
  // New workspaces have no policies, which leaves Request disabled; offer a one-click starter to admins.
  const policiesQ = useOrgQuery<unknown[]>(org.grants['time_off:manage'] === 'org' ? '/time-off/policies' : null);
  const noPolicies = policiesQ.data?.length === 0;
  const starter = useOrgMutation('POST', '/time-off/policies');
  const createStarter = async () => {
    try {
      await starter.mutateAsync({ name: 'Paid time off', paid: true, requires_approval: true, hours_per_day: 8, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: true });
      toast.success('“Paid time off” created. Adjust it under Policies & holidays.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doCancel = async () => {
    if (!toCancel) return;
    try {
      await cancel.mutateAsync({ id: toCancel.id });
      toast.success('Request cancelled');
      setToCancel(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<TimeOffRequest>[] = [
    { key: 'dates', header: 'Dates', cell: (r) => <span className="tabular font-medium">{dateRangeLabel(r.start_date, r.end_date)}</span>, value: (r) => r.start_date, priority: 'primary' },
    { key: 'policy', header: 'Policy', cell: (r) => r.policy_name, value: (r) => r.policy_name, priority: 'secondary' },
    { key: 'hours', header: 'Hours', align: 'right', cell: (r) => `${fmtHours(r.hours)}${r.half_day ? ' (½ day)' : ''}`, value: (r) => r.hours, priority: 'secondary' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status, priority: 'secondary' },
    {
      key: 'note',
      header: 'Notes',
      cell: (r) => (
        <div className="max-w-72 text-xs text-text-muted">
          {r.reason && <div className="truncate" title={r.reason}>{r.reason}</div>}
          {r.decision_comment && (
            <div className="truncate" title={r.decision_comment}>
              {r.decided_by_name ?? 'Approver'}: “{r.decision_comment}”
            </div>
          )}
          {!r.reason && !r.decision_comment && '—'}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        r.status === 'PENDING' || (r.status === 'APPROVED' && r.start_date > today) ? (
          <Button size="xs" variant="ghost" onClick={() => setToCancel(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Balances"
        actions={
          canRequest && (
            <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRequestOpen(true)} disabled={!balancesQ.data?.length}>
              Request time off
            </Button>
          )
        }
      >
        {balancesQ.error ? (
          <ErrorState error={balancesQ.error} onRetry={() => balancesQ.refetch()} />
        ) : (
          <DataTable
            rows={balancesQ.data}
            loading={balancesQ.isLoading}
            rowKey={(b) => b.policy_id}
            caption="Time off balances"
            empty={
              noPolicies ? (
                <EmptyState
                  title="No time off policies yet"
                  description="Start with a paid time off policy for everyone (no accrual, 8 h days). You can change it or add more under Policies & holidays."
                  action={
                    <Button variant="primary" size="sm" loading={starter.isPending} onClick={createStarter}>
                      Create “Paid time off”
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="No time off policies apply to you" description="An admin needs to add you to a time off policy before you can request leave." />
              )
            }
            columns={[
              {
                key: 'policy',
                header: 'Policy',
                cell: (b) => (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{b.policy_name}</span>
                    <Badge tone={b.paid ? 'success' : 'neutral'}>{b.paid ? 'Paid' : 'Unpaid'}</Badge>
                  </span>
                ),
                value: (b) => b.policy_name,
                priority: 'primary',
              },
              { key: 'balance', header: 'Balance', align: 'right', cell: (b) => (b.balance_hours === null ? <span className="text-text-muted">Unlimited</span> : <span className="font-semibold">{fmtHours(b.balance_hours)}</span>), value: (b) => b.balance_hours, priority: 'secondary' },
              { key: 'pending', header: 'Pending', align: 'right', cell: (b) => fmtHours(b.pending_hours), value: (b) => b.pending_hours, priority: 'secondary' },
              { key: 'used', header: 'Used', align: 'right', cell: (b) => fmtHours(b.used_hours), value: (b) => b.used_hours, priority: 'secondary' },
            ]}
          />
        )}
      </Panel>

      <Panel title="My requests">
        {requestsQ.error ? (
          <ErrorState error={requestsQ.error} onRetry={() => requestsQ.refetch()} />
        ) : (
          <DataTable
            rows={requestsQ.data}
            loading={requestsQ.isLoading}
            rowKey={(r) => r.id}
            columns={columns}
            caption="My time off requests"
            empty={<EmptyState title="No requests yet" description={canRequest ? 'Use “Request time off” to plan your next leave.' : undefined} />}
          />
        )}
      </Panel>

      {requestOpen && <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} balances={balancesQ.data ?? []} />}
      <ConfirmDialog
        open={!!toCancel}
        onOpenChange={(o) => !o && setToCancel(null)}
        title="Cancel this request?"
        description={toCancel ? `${toCancel.policy_name}, ${dateRangeLabel(toCancel.start_date, toCancel.end_date)}. ${toCancel.status === 'APPROVED' ? 'The hours go back to your balance.' : ''}` : undefined}
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        danger
        loading={cancel.isPending}
        onConfirm={doCancel}
      />
    </div>
  );
}

function RequestDialog({ open, onOpenChange, balances }: { open: boolean; onOpenChange: (o: boolean) => void; balances: TimeOffBalance[] }) {
  const org = useOrg();
  const toast = useToast();
  const today = todayIn(org.membership.timezone || org.organization.timezone);
  const [policyId, setPolicyId] = useState(balances[0]?.policy_id ?? '');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const m = useOrgMutation<RequestBody, TimeOffRequest>('POST', '/time-off/requests');
  const selected = balances.find((b) => b.policy_id === policyId);

  const submit = async () => {
    setError(null);
    try {
      const r = await m.mutateAsync({ policy_id: policyId, start_date: start, end_date: end, half_day: halfDay, reason: reason.trim() || null });
      toast.success(r.status === 'APPROVED' ? `Approved automatically (${fmtHours(r.hours)})` : `Request sent for approval (${fmtHours(r.hours)})`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request time off"
      description="Hours are calculated from your schedule. Weekends without shifts and holidays are not counted."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending} disabled={!policyId || !start || !end || end < start}>
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Policy"
          htmlFor="to-policy"
          required
          error={error?.field('policy_id')}
          hint={selected ? (selected.balance_hours === null ? 'No balance limit' : `${fmtHours(selected.balance_hours)} balance · ${fmtHours(selected.pending_hours)} pending`) : undefined}
        >
          <Select id="to-policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {balances.map((b) => (
              <option key={b.policy_id} value={b.policy_id}>
                {b.policy_name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="to-start" required error={error?.field('start_date')}>
            <Input
              id="to-start"
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </Field>
          <Field label="End date" htmlFor="to-end" required error={error?.field('end_date') ?? (end < start ? 'End date must be on or after the start date' : undefined)}>
            <Input id="to-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Checkbox label="Half day" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
        <Field label="Reason" htmlFor="to-reason" hint="Optional. Visible to your approver." error={error?.field('reason')}>
          <Textarea id="to-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
