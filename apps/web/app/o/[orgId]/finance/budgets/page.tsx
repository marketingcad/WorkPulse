'use client';
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BudgetStatusDto, ClientDto, ProjectDto } from '@tallywork/contracts';
import {
  Badge,
  BudgetProgress,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  KpiStrip,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  StatusBadge,
  fmtMoney,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { fromMinor, toMinor } from '@/components/finance/types';

interface BudgetBody {
  subject_type: 'PROJECT' | 'CLIENT';
  subject_id: string;
  kind: 'HOURS' | 'MONEY';
  amount: number;
  period: 'TOTAL' | 'MONTHLY';
  warn_pct: number;
  include_non_billable: boolean;
}

export default function BudgetsPage() {
  const org = useOrg();
  const toast = useToast();
  const q = useOrgQuery<BudgetStatusDto[]>(org.can('budgets:read') ? '/budgets' : null);
  const canManage = org.can('budgets:manage');
  const [editing, setEditing] = useState<BudgetStatusDto | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<BudgetStatusDto | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/budgets/${b.id}`);

  if (!org.can('budgets:read')) return <PermissionState />;

  const fmt = (b: BudgetStatusDto, v: number) => (b.kind === 'HOURS' ? org.fmtDuration(v) : fmtMoney(v, b.currency));
  const rows = q.data ?? [];

  const columns: Column<BudgetStatusDto>[] = [
    {
      key: 'subject',
      header: 'Subject',
      cell: (b) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{b.subject_name}</span>
          <Badge>{b.subject_type === 'PROJECT' ? 'Project' : 'Client'}</Badge>
        </span>
      ),
      value: (b) => b.subject_name,
      priority: 'primary',
    },
    { key: 'kind', header: 'Type', cell: (b) => (b.kind === 'HOURS' ? 'Hours' : 'Money'), value: (b) => b.kind },
    { key: 'amount', header: 'Budget', align: 'right', cell: (b) => fmt(b, b.amount), value: (b) => b.amount, priority: 'secondary' },
    { key: 'spent', header: 'Spent', align: 'right', cell: (b) => fmt(b, b.spent), value: (b) => b.spent, priority: 'secondary' },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      cell: (b) => (b.spent > b.amount ? <span className="text-danger">over by {fmt(b, b.spent - b.amount)}</span> : fmt(b, b.remaining)),
      value: (b) => b.remaining,
    },
    {
      key: 'pct',
      header: '% used',
      width: '200px',
      cell: (b) => (
        <span className="flex items-center gap-2">
          <BudgetProgress pct={b.pct_used} state={b.state} projectedPct={b.projected !== null && b.amount ? (b.projected / b.amount) * 100 : null} className="min-w-20 flex-1" />
          <span className="tabular w-10 text-right text-xs text-text-muted">{Math.round(b.pct_used)}%</span>
        </span>
      ),
      value: (b) => b.pct_used,
      priority: 'primary',
    },
    {
      key: 'projected',
      header: 'Projected',
      align: 'right',
      cell: (b) => (b.projected === null ? <span className="text-text-faint">—</span> : <span className={b.projected > b.amount ? 'text-danger' : undefined}>{fmt(b, b.projected)}</span>),
      value: (b) => b.projected,
    },
    { key: 'state', header: 'State', cell: (b) => <StatusBadge status={b.state} />, value: (b) => b.pct_used, priority: 'secondary' },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (b: BudgetStatusDto) => (
              <span className="inline-flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <IconButton label={`Edit budget for ${b.subject_name}`} size="xs" onClick={() => setEditing(b)}>
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label={`Delete budget for ${b.subject_name}`} size="xs" onClick={() => setToDelete(b)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Hours and money budgets for projects and clients, with warnings before they run out."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
              Set budget
            </Button>
          )
        }
      />
      {rows.length > 0 && (
        <KpiStrip
          className="mb-4"
          items={[
            { label: 'Budgets', value: rows.length },
            { label: 'Healthy', value: rows.filter((b) => b.state === 'healthy').length },
            { label: 'Warning', value: rows.filter((b) => b.state === 'warning').length },
            { label: 'Exceeded', value: rows.filter((b) => b.state === 'exceeded').length },
          ]}
        />
      )}
      <Panel footer="Monthly budgets reset on the first of each month. The marker on each bar shows where spending is projected to land at the end of the period.">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(b) => b.id}
            searchable
            searchPlaceholder="Search budgets…"
            initialSort={{ key: 'pct', dir: 'desc' }}
            onRowClick={canManage ? (b) => setEditing(b) : undefined}
            empty={
              <EmptyState
                title="No budgets yet"
                description="Set an hours or money budget on a project or client to get warned before it runs out."
                action={canManage && <Button variant="primary" size="sm" onClick={() => setEditing('new')}>Set budget</Button>}
              />
            }
          />
        )}
      </Panel>
      <BudgetDialog value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete budget?"
        description={toDelete ? `The budget for ${toDelete.subject_name} will be removed. Tracked time is not affected.` : undefined}
        confirmLabel="Delete budget"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
            toast.success('Budget deleted');
            setToDelete(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

function BudgetDialog({ value, onClose }: { value: BudgetStatusDto | 'new' | null; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const open = value !== null;
  const existing = value && value !== 'new' ? value : null;
  const projectsQ = useOrgQuery<ProjectDto[]>(open ? '/projects' : null);
  const clientsQ = useOrgQuery<ClientDto[]>(open ? '/clients' : null);
  const [subjectType, setSubjectType] = useState<'PROJECT' | 'CLIENT'>('PROJECT');
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<'HOURS' | 'MONEY'>('HOURS');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'TOTAL' | 'MONTHLY'>('TOTAL');
  const [warn, setWarn] = useState('80');
  const [nonBillable, setNonBillable] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const m = useOrgMutation<BudgetBody, BudgetStatusDto[]>('PUT', '/budgets');

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setPeriod('TOTAL');
    setWarn('80');
    setNonBillable(false);
    if (existing) {
      setSubjectType(existing.subject_type);
      setSubjectId(existing.subject_id);
      setKind(existing.kind);
      setAmount(existing.kind === 'HOURS' ? String(Math.round((existing.amount / 3600) * 100) / 100) : fromMinor(existing.amount));
    } else {
      setSubjectType('PROJECT');
      setSubjectId('');
      setKind('HOURS');
      setAmount('');
    }
    // Only reset when the dialog opens or the edited budget changes, not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const submit = async () => {
    setErr(null);
    let amt: number | null = null;
    if (kind === 'HOURS') {
      const h = Number(amount.trim());
      amt = amount.trim() && Number.isFinite(h) && h > 0 ? Math.round(h * 3600) : null;
    } else amt = toMinor(amount);
    if (!amt || amt < 1) {
      setErr(new ApiError(422, 'validation', 'Enter an amount', undefined, [{ field: 'amount', message: kind === 'HOURS' ? 'Enter a number of hours, e.g. 120 or 37.5' : 'Enter an amount, e.g. 5000' }]));
      return;
    }
    if (!subjectId) {
      setErr(new ApiError(422, 'validation', 'Choose a subject', undefined, [{ field: 'subject_id', message: `Choose a ${subjectType === 'PROJECT' ? 'project' : 'client'}` }]));
      return;
    }
    const w = Number(warn);
    try {
      await m.mutateAsync({ subject_type: subjectType, subject_id: subjectId, kind, amount: amt, period, warn_pct: Number.isInteger(w) ? w : 80, include_non_billable: nonBillable });
      toast.success('Budget saved');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `Edit budget · ${existing.subject_name}` : 'Set budget'}
      description="Each project or client has at most one budget; saving replaces the existing one."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending}>
            Save budget
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Budget for" htmlFor="b-type">
          <Select id="b-type" value={subjectType} disabled={!!existing} onChange={(e) => (setSubjectType(e.target.value as 'PROJECT' | 'CLIENT'), setSubjectId(''))}>
            <option value="PROJECT">Project</option>
            <option value="CLIENT">Client</option>
          </Select>
        </Field>
        <Field label={subjectType === 'PROJECT' ? 'Project' : 'Client'} htmlFor="b-subject" required error={err?.field('subject_id')}>
          <Select id="b-subject" value={subjectId} disabled={!!existing} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Choose…</option>
            {existing && <option value={existing.subject_id}>{existing.subject_name}</option>}
            {subjectType === 'PROJECT'
              ? projectsQ.data?.filter((p) => p.id !== existing?.subject_id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.client_name ? ` (${p.client_name})` : ''}
                  </option>
                ))
              : clientsQ.data?.filter((c) => c.id !== existing?.subject_id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="b-kind">
          <Select id="b-kind" value={kind} onChange={(e) => (setKind(e.target.value as 'HOURS' | 'MONEY'), setAmount(''))}>
            <option value="HOURS">Hours</option>
            <option value="MONEY">Money (bill amount)</option>
          </Select>
        </Field>
        <Field label={kind === 'HOURS' ? 'Hours' : `Amount (${org.organization.currency})`} htmlFor="b-amount" required error={err?.field('amount')}>
          <Input id="b-amount" inputMode="decimal" className="tabular" placeholder={kind === 'HOURS' ? '120' : '5000.00'} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Period" htmlFor="b-period">
          <Select id="b-period" value={period} onChange={(e) => setPeriod(e.target.value as 'TOTAL' | 'MONTHLY')}>
            <option value="TOTAL">Total (lifetime)</option>
            <option value="MONTHLY">Monthly (resets each month)</option>
          </Select>
        </Field>
        <Field label="Warn at (%)" htmlFor="b-warn" hint="Managers are notified when usage crosses this level and at 100%." error={err?.field('warn_pct')}>
          <Input id="b-warn" type="number" min={1} max={100} className="tabular" value={warn} onChange={(e) => setWarn(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Include non-billable time" checked={nonBillable} onChange={(e) => setNonBillable(e.target.checked)} />
        </div>
      </div>
      {existing && <p className="mt-3 text-xs text-text-faint">Period, warning level and non-billable setting are not returned by the server, so they are shown with defaults. Check them before saving.</p>}
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
