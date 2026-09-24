'use client';
import { useMemo, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { WorkerDto } from '@tallywork/contracts';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Panel, Select, Switch, Textarea, fmtDate, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { fmtHours, type AccrualType, type HolidayRow, type TimeOffBalance, type TimeOffPolicy } from './shared';

const ACCRUAL_LABEL: Record<AccrualType, string> = {
  none: 'No accrual',
  annual: 'Annual grant',
  monthly: 'Monthly grant',
  per_hour_worked: 'Per hour worked',
};

function accrualSummary(p: TimeOffPolicy): string {
  const a = p.accrual;
  if (a.type === 'none') return 'No balance tracking';
  const amount = a.type === 'per_hour_worked' ? `${a.amountHours}h per hour worked` : `${fmtHours(a.amountHours)} ${a.type === 'annual' ? 'per year' : 'per month'}`;
  const extra = [a.maxBalanceHours !== null ? `max ${fmtHours(a.maxBalanceHours)}` : null, a.carryOverHours !== null ? `carry over ${fmtHours(a.carryOverHours)}` : null].filter(Boolean);
  return [amount, ...extra].join(' · ');
}

export function TimeOffAdmin() {
  const policiesQ = useOrgQuery<TimeOffPolicy[]>('/time-off/policies');
  const workersQ = useOrgQuery<WorkerDto[]>('/workers');
  const [editing, setEditing] = useState<TimeOffPolicy | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const workers = useMemo(() => (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE' || w.status === 'INVITED'), [workersQ.data]);

  const columns: Column<TimeOffPolicy>[] = [
    { key: 'name', header: 'Policy', cell: (p) => <span className="font-medium">{p.name}</span>, value: (p) => p.name, priority: 'primary' },
    { key: 'paid', header: 'Pay', cell: (p) => <Badge tone={p.paid ? 'success' : 'neutral'}>{p.paid ? 'Paid' : 'Unpaid'}</Badge>, value: (p) => (p.paid ? 1 : 0), priority: 'secondary' },
    { key: 'approval', header: 'Approval', cell: (p) => (p.requires_approval ? 'Required' : <span className="text-text-muted">Auto-approve</span>), value: (p) => (p.requires_approval ? 1 : 0) },
    { key: 'hpd', header: 'Hours / day', align: 'right', cell: (p) => fmtHours(p.hours_per_day), value: (p) => p.hours_per_day },
    { key: 'accrual', header: 'Accrual', cell: (p) => <span className="text-xs text-text-muted">{accrualSummary(p)}</span>, value: (p) => p.accrual.type, priority: 'secondary' },
    { key: 'applies', header: 'Applies to', cell: (p) => (p.applies_to_all ? 'Everyone' : `${p.member_ids.length} member${p.member_ids.length === 1 ? '' : 's'}`), value: (p) => (p.applies_to_all ? 100000 : p.member_ids.length) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Policies"
        actions={
          <>
            <Button size="sm" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setAdjusting(true)} disabled={!policiesQ.data?.length}>
              Adjust balance
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
              New policy
            </Button>
          </>
        }
      >
        {policiesQ.error ? (
          <ErrorState error={policiesQ.error} onRetry={() => policiesQ.refetch()} />
        ) : (
          <DataTable
            rows={policiesQ.data}
            loading={policiesQ.isLoading}
            columns={columns}
            rowKey={(p) => p.id}
            onRowClick={(p) => setEditing(p)}
            caption="Time off policies"
            empty={<EmptyState title="No time off policies" description="Create a policy such as Vacation or Sick leave so members can request time off." action={<Button variant="primary" onClick={() => setEditing('new')}>New policy</Button>} />}
          />
        )}
      </Panel>

      <HolidaysPanel />

      {editing && <PolicyDialog key={editing === 'new' ? 'new' : editing.id} policy={editing === 'new' ? null : editing} workers={workers} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustDialog policies={policiesQ.data ?? []} workers={workers} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

type PolicyBody = Omit<TimeOffPolicy, 'id' | 'member_ids'> & { member_ids?: string[] };

function PolicyDialog({ policy, workers, onClose }: { policy: TimeOffPolicy | null; workers: WorkerDto[]; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(policy?.name ?? '');
  const [paid, setPaid] = useState(policy?.paid ?? true);
  const [requiresApproval, setRequiresApproval] = useState(policy?.requires_approval ?? true);
  const [hoursPerDay, setHoursPerDay] = useState(String(policy?.hours_per_day ?? 8));
  const [accrualType, setAccrualType] = useState<AccrualType>(policy?.accrual.type ?? 'none');
  const [amount, setAmount] = useState(String(policy?.accrual.amountHours ?? 0));
  const [maxBalance, setMaxBalance] = useState(policy?.accrual.maxBalanceHours != null ? String(policy.accrual.maxBalanceHours) : '');
  const [carryOver, setCarryOver] = useState(policy?.accrual.carryOverHours != null ? String(policy.accrual.carryOverHours) : '');
  const [appliesToAll, setAppliesToAll] = useState(policy?.applies_to_all ?? true);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set(policy?.member_ids ?? []));
  const [memberSearch, setMemberSearch] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const create = useOrgMutation<PolicyBody, TimeOffPolicy>('POST', '/time-off/policies');
  const update = useOrgMutation<PolicyBody, TimeOffPolicy>('PUT', `/time-off/policies/${policy?.id ?? ''}`);
  const pending = create.isPending || update.isPending;

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const submit = async () => {
    setError(null);
    const body: PolicyBody = {
      name: name.trim(),
      paid,
      requires_approval: requiresApproval,
      hours_per_day: Number(hoursPerDay),
      accrual: {
        type: accrualType,
        amountHours: accrualType === 'none' ? 0 : Number(amount || 0),
        maxBalanceHours: accrualType === 'none' ? null : num(maxBalance),
        carryOverHours: accrualType === 'none' ? null : num(carryOver),
      },
      applies_to_all: appliesToAll,
      member_ids: appliesToAll ? [] : [...memberIds],
    };
    try {
      await (policy ? update : create).mutateAsync(body);
      toast.success(policy ? 'Policy updated' : 'Policy created');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  const shown = workers.filter((w) => !memberSearch.trim() || w.name.toLowerCase().includes(memberSearch.trim().toLowerCase()));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={policy ? `Edit ${policy.name}` : 'New time off policy'}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim() || (!appliesToAll && memberIds.size === 0)}>
            {policy ? 'Save policy' : 'Create policy'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Name" htmlFor="pol-name" required error={error?.field('name')}>
            <Input id="pol-name" value={name} maxLength={100} placeholder="Vacation" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Hours per day" htmlFor="pol-hpd" error={error?.field('hours_per_day')} hint="Hours deducted per full day">
            <Input id="pol-hpd" type="number" min={1} max={24} step={0.5} value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <Switch checked={paid} onCheckedChange={setPaid} label="Paid" description="Paid leave counts toward payroll hours." />
          <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} label="Requires approval" description="Off: requests are approved automatically." />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Accrual</legend>
          <Field label="Accrual type" htmlFor="pol-acc" error={error?.field('accrual.type')}>
            <Select id="pol-acc" value={accrualType} onChange={(e) => setAccrualType(e.target.value as AccrualType)}>
              {(Object.keys(ACCRUAL_LABEL) as AccrualType[]).map((t) => (
                <option key={t} value={t}>
                  {ACCRUAL_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          {accrualType === 'none' ? (
            <p className="text-xs text-text-muted">No balance is tracked. Members can request any amount (subject to approval).</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={accrualType === 'per_hour_worked' ? 'Hours per hour worked' : accrualType === 'annual' ? 'Hours per year' : 'Hours per month'} htmlFor="pol-amt" error={error?.field('accrual.amountHours')}>
                <Input id="pol-amt" type="number" min={0} max={1000} step={accrualType === 'per_hour_worked' ? 0.001 : 0.5} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Max balance" htmlFor="pol-max" hint="Blank = no cap" error={error?.field('accrual.maxBalanceHours')}>
                <Input id="pol-max" type="number" min={0} step={0.5} value={maxBalance} onChange={(e) => setMaxBalance(e.target.value)} />
              </Field>
              <Field label="Carry over" htmlFor="pol-carry" hint="Blank = unlimited" error={error?.field('accrual.carryOverHours')}>
                <Input id="pol-carry" type="number" min={0} step={0.5} value={carryOver} onChange={(e) => setCarryOver(e.target.value)} />
              </Field>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Applies to</legend>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="pol-applies" checked={appliesToAll} onChange={() => setAppliesToAll(true)} className="accent-[var(--color-interactive)]" /> All members
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="pol-applies" checked={!appliesToAll} onChange={() => setAppliesToAll(false)} className="accent-[var(--color-interactive)]" /> Selected members
            </label>
          </div>
          {!appliesToAll && (
            <div className="rounded-md border border-border">
              <div className="flex items-center gap-2 border-b border-border p-2">
                <Input type="search" placeholder="Search members…" aria-label="Search members" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
                <span className="tabular shrink-0 text-xs text-text-muted">{memberIds.size} selected</span>
              </div>
              <ul className="max-h-48 divide-y divide-border overflow-y-auto">
                {shown.map((w) => (
                  <li key={w.id} className="px-3 py-1.5">
                    <Checkbox
                      label={
                        <span>
                          {w.name} <span className="text-xs text-text-muted">{w.email}</span>
                        </span>
                      }
                      checked={memberIds.has(w.id)}
                      onChange={(e) => {
                        const next = new Set(memberIds);
                        if (e.target.checked) next.add(w.id);
                        else next.delete(w.id);
                        setMemberIds(next);
                      }}
                    />
                  </li>
                ))}
                {!shown.length && <li className="px-3 py-3 text-sm text-text-muted">No members match.</li>}
              </ul>
            </div>
          )}
          {error?.field('member_ids') && <p className="text-xs text-danger">{error.field('member_ids')}</p>}
        </fieldset>
      </div>
    </Dialog>
  );
}

interface AdjustBody {
  policy_id: string;
  membership_id: string;
  hours: number;
  note: string | null;
}

function AdjustDialog({ policies, workers, onClose }: { policies: TimeOffPolicy[]; workers: WorkerDto[]; onClose: () => void }) {
  const toast = useToast();
  const tracked = policies.filter((p) => p.accrual.type !== 'none');
  const [memberId, setMemberId] = useState('');
  const [policyId, setPolicyId] = useState((tracked[0] ?? policies[0])?.id ?? '');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const balancesQ = useOrgQuery<TimeOffBalance[]>(memberId ? `/time-off/balances${qs({ membership_id: memberId })}` : null);
  const m = useOrgMutation<AdjustBody, TimeOffBalance[]>('POST', '/time-off/balances/adjust');
  const current = balancesQ.data?.find((b) => b.policy_id === policyId);
  const value = Number(hours);

  const submit = async () => {
    setError(null);
    try {
      await m.mutateAsync({ policy_id: policyId, membership_id: memberId, hours: value, note: note.trim() || null });
      toast.success(`Balance adjusted by ${value > 0 ? '+' : ''}${fmtHours(value)}`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adjust balance"
      description="Adds a ledger entry. Use a negative number to deduct hours."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending} disabled={!memberId || !policyId || !hours || !Number.isFinite(value) || value === 0}>
            Apply adjustment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Member" htmlFor="adj-member" required error={error?.field('membership_id')}>
          <Select id="adj-member" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Choose a member…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Policy"
          htmlFor="adj-policy"
          required
          error={error?.field('policy_id')}
          hint={memberId && balancesQ.data ? (current ? `Current balance ${current.balance_hours === null ? 'not tracked' : fmtHours(current.balance_hours)} · ${fmtHours(current.pending_hours)} pending` : 'This policy does not apply to this member') : undefined}
        >
          <Select id="adj-policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.accrual.type === 'none' ? ' (no balance tracking)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hours" htmlFor="adj-hours" required hint="For example 8 or -4" error={error?.field('hours')}>
          <Input id="adj-hours" type="number" step={0.5} min={-1000} max={1000} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="adj-note" hint="Optional. Kept in the audit log." error={error?.field('note')}>
          <Textarea id="adj-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

interface HolidayBody {
  date: string;
  name: string;
  paid: boolean;
}

function HolidaysPanel() {
  const org = useOrg();
  const toast = useToast();
  const thisYear = Number(todayIn(org.organization.timezone).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [paid, setPaid] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [toDelete, setToDelete] = useState<HolidayRow | null>(null);
  const q = useOrgQuery<HolidayRow[]>(`/holidays${qs({ year })}`);
  const add = useOrgMutation<HolidayBody, HolidayRow[]>('POST', '/holidays');
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/holidays/${b.id}`);

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({ date, name: name.trim(), paid });
      toast.success(`${name.trim()} added`);
      if (Number(date.slice(0, 4)) !== year) setYear(Number(date.slice(0, 4)));
      setDate('');
      setName('');
      setPaid(true);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Panel
      title="Holidays"
      actions={
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="w-24">
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Date" htmlFor="hol-date" error={error?.field('date')}>
          <Input id="hol-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </Field>
        <Field label="Name" htmlFor="hol-name" error={error?.field('name')} className="min-w-48 flex-1">
          <Input id="hol-name" value={name} maxLength={100} placeholder="New Year's Day" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Checkbox label="Paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-8" />
        <Button type="submit" variant="primary" icon={<Plus className="size-3.5" />} loading={add.isPending} disabled={!date || !name.trim()}>
          Add holiday
        </Button>
      </form>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          rowKey={(h) => h.id}
          caption={`Holidays in ${year}`}
          empty={<EmptyState title={`No holidays in ${year}`} description="Add public holidays so schedules, attendance, and time off requests skip them." />}
          columns={[
            { key: 'date', header: 'Date', cell: (h) => <span className="tabular">{fmtDate(h.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>, value: (h) => h.date, priority: 'secondary' },
            { key: 'name', header: 'Name', cell: (h) => <span className="font-medium">{h.name}</span>, value: (h) => h.name, priority: 'primary' },
            { key: 'paid', header: 'Pay', cell: (h) => <Badge tone={h.paid ? 'success' : 'neutral'}>{h.paid ? 'Paid' : 'Unpaid'}</Badge>, value: (h) => (h.paid ? 1 : 0), priority: 'secondary' },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (h) => (
                <IconButton label={`Delete ${h.name}`} size="xs" onClick={() => setToDelete(h)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              ),
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete holiday?"
        description={toDelete ? `${toDelete.name} on ${fmtDate(toDelete.date)} will become a regular working day for schedules and attendance.` : undefined}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
            toast.success('Holiday deleted');
            setToDelete(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Panel>
  );
}
