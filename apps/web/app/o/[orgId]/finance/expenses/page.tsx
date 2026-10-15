'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Paperclip, Plus, Receipt, Wallet, X } from 'lucide-react';
import type { ExpensePageSummary, OffsetPage, ProjectDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  PageHeader,
  Panel,
  PermissionState,
  PersonCell,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  fmtDate,
  fmtMoney,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, api, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { toMinor, type ExpenseRow, type ExpenseStatus } from '@/components/finance/types';

const STATUSES: Array<{ value: 'ALL' | ExpenseStatus; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REIMBURSED', label: 'Reimbursed' },
];
const CATEGORIES = ['Travel', 'Meals', 'Lodging', 'Software', 'Equipment', 'Supplies', 'Mileage', 'Other'];

type Action = 'approve' | 'reject' | 'reimburse';

export default function ExpensesPage() {
  const org = useOrg();
  const toast = useToast();
  const [status, setStatus] = useState<'ALL' | ExpenseStatus>('ALL');
  const [creating, setCreating] = useState(false);
  const search = useSearch();
  // The server filters, pages and adds up every expense the person may see, not only the newest 1000.
  const filters = { status: status === 'ALL' ? undefined : status, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<ExpenseRow> & { summary: ExpensePageSummary }>(org.can('expenses:read') ? `/expenses${qs({ ...filters, ...paging.params })}` : null, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const decide = useOrgMutation<{ id: string; action: Action }>('POST', (b) => `/expenses/${b.id}/${b.action}`);
  const [pending, setPending] = useState<string | null>(null);

  const summary = q.data?.summary;
  const canApprove = org.can('expenses:approve');
  const receiptUrl = (id: string) => `/api/v1/orgs/${org.organization.id}/files/${id}`;

  if (!org.can('expenses:read')) return <PermissionState />;

  const act = async (e: ExpenseRow, action: Action) => {
    setPending(`${e.id}:${action}`);
    try {
      await decide.mutateAsync({ id: e.id, action });
      toast.success(action === 'approve' ? 'Expense approved' : action === 'reject' ? 'Expense rejected' : 'Marked as reimbursed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const columns: Column<ExpenseRow>[] = [
    { key: 'date', header: 'Date', cell: (e) => fmtDate(e.spent_on), value: (e) => e.spent_on, sortable: false, priority: 'secondary' },
    ...(org.isManagerView ? [{ key: 'member', header: 'Member', cell: (e: ExpenseRow) => <PersonCell name={e.worker_name || 'Member'} />, value: (e: ExpenseRow) => e.worker_name, sortable: false, priority: 'secondary' as const }] : []),
    {
      key: 'category',
      header: 'Expense',
      cell: (e) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{e.category}</span>
          {e.description && <span className="block truncate text-xs text-text-muted">{e.description}</span>}
        </span>
      ),
      value: (e) => `${e.category} ${e.description ?? ''}`,
      sortable: false,
      priority: 'primary',
    },
    { key: 'project', header: 'Project', cell: (e) => e.project_name ?? e.client_name ?? <span className="text-text-faint">—</span>, value: (e) => e.project_name ?? e.client_name ?? '', sortable: false },
    {
      key: 'flags',
      header: 'Flags',
      cell: (e) => (
        <span className="flex flex-wrap gap-1">
          {e.billable && <Badge tone="brand">Billable</Badge>}
          {e.reimbursable && <Badge tone="secondary">Reimbursable</Badge>}
          {e.invoiced && <Badge tone="info">Invoiced</Badge>}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      cell: (e) =>
        e.receipt_file_id ? (
          <a href={receiptUrl(e.receipt_file_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-interactive hover:underline" onClick={(ev) => ev.stopPropagation()}>
            <Paperclip className="size-3.5" aria-hidden />
            View
          </a>
        ) : (
          <span className="text-text-faint">—</span>
        ),
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (e) => <span className="font-medium">{fmtMoney(e.amount_minor, e.currency)}</span>, value: (e) => e.amount_minor, sortable: false, priority: 'primary' },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} />, value: (e) => e.status, sortable: false, priority: 'secondary' },
    ...(canApprove
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (e: ExpenseRow) => {
              if (e.membership_id === org.membership.id) return <span className="text-xs text-text-faint">Your expense</span>;
              return (
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {(e.status === 'SUBMITTED' || e.status === 'REJECTED') && (
                    <Button size="xs" variant="subtle" icon={<Check className="size-3" />} loading={pending === `${e.id}:approve`} onClick={() => act(e, 'approve')}>
                      Approve
                    </Button>
                  )}
                  {(e.status === 'SUBMITTED' || e.status === 'APPROVED') && !e.invoiced && (
                    <Button size="xs" variant="ghost" icon={<X className="size-3" />} loading={pending === `${e.id}:reject`} onClick={() => act(e, 'reject')}>
                      Reject
                    </Button>
                  )}
                  {e.status === 'APPROVED' && e.reimbursable && (
                    <Button size="xs" variant="ghost" icon={<Wallet className="size-3" />} loading={pending === `${e.id}:reimburse`} onClick={() => act(e, 'reimburse')}>
                      Reimburse
                    </Button>
                  )}
                </span>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description={canApprove ? 'Submitted expenses from your team. Approve, reject and track reimbursements.' : 'Submit expenses with receipts for approval and reimbursement.'}
        actions={
          org.can('expenses:create') && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
              New expense
            </Button>
          )
        }
      />
      <FilterBar>
        <Input aria-label="Search expenses" placeholder="Search expense, project or member…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-72" />
      </FilterBar>
      {/* The total covers every matching expense, on all pages. */}
      <Panel footer={summary && q.data?.total ? <span className="tabular">Total ({summary.currency}): {fmtMoney(summary.total_minor, summary.currency)}</span> : undefined}>
        <Tabs
          value={status}
          onValueChange={(v) => setStatus(v as typeof status)}
          className="px-2 pt-1"
          items={STATUSES.map((s) => ({ value: s.value, label: s.label, count: summary?.counts[s.value] }))}
        />
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(e) => e.id}
            pagination={paging.pagination(q.data)}
            caption="Expenses"
            empty={
              <EmptyState
                icon={<Receipt className="size-5" />}
                title={search.term ? 'No expenses match your search' : status === 'ALL' ? 'No expenses yet' : `No ${status.toLowerCase()} expenses`}
                description={org.can('expenses:create') ? 'Add an expense and attach a photo or PDF of the receipt.' : undefined}
                action={org.can('expenses:create') && status === 'ALL' && !search.term && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New expense</Button>}
              />
            }
          />
        )}
      </Panel>
      <ExpenseDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

interface ExpenseBody {
  project_id: string | null;
  category: string;
  description: string | null;
  amount_minor: number;
  currency: string;
  spent_on: string;
  receipt_file_id: string | null;
  billable: boolean;
  reimbursable: boolean;
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useOrg();
  const toast = useToast();
  const projectsQ = useOrgQuery<ProjectDto[]>(open ? '/projects' : null);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(org.organization.currency);
  const [date, setDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const [billable, setBillable] = useState(false);
  const [reimbursable, setReimbursable] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const m = useOrgMutation<ExpenseBody, ExpenseRow>('POST', '/expenses');

  useEffect(() => {
    if (!open) return;
    setCategory('');
    setDescription('');
    setAmount('');
    setCurrency(org.organization.currency);
    setDate(todayIn(org.organization.timezone));
    setProjectId('');
    setBillable(false);
    setReimbursable(true);
    setFile(null);
    setErr(null);
  }, [open, org.organization.currency, org.organization.timezone]);

  const submit = async () => {
    setErr(null);
    const minor = toMinor(amount);
    if (!minor) {
      setErr(new ApiError(422, 'validation', 'Enter an amount', undefined, [{ field: 'amount_minor', message: 'Enter an amount like 42.50' }]));
      return;
    }
    if (!category.trim()) {
      setErr(new ApiError(422, 'validation', 'Choose a category', undefined, [{ field: 'category', message: 'Choose or type a category' }]));
      return;
    }
    try {
      let receiptId: string | null = null;
      if (file) {
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        try {
          const r = await api<{ id: string }>(`/orgs/${org.organization.id}/files/receipts`, { method: 'POST', body: fd });
          receiptId = r.id;
        } finally {
          setUploading(false);
        }
      }
      await m.mutateAsync({
        project_id: projectId || null,
        category: category.trim(),
        description: description.trim() || null,
        amount_minor: minor,
        currency: currency.toUpperCase(),
        spent_on: date,
        receipt_file_id: receiptId,
        billable,
        reimbursable,
      });
      toast.success('Expense submitted for approval');
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New expense"
      description="Expenses are submitted to your manager for approval."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={uploading || m.isPending}>
            {uploading ? 'Uploading receipt…' : 'Submit expense'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="ex-cat" required error={err?.field('category')}>
          <Input id="ex-cat" list="ex-cat-list" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} placeholder="Travel" />
          <datalist id="ex-cat-list">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Date" htmlFor="ex-date" required error={err?.field('spent_on')}>
          <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount" htmlFor="ex-amount" required error={err?.field('amount_minor')}>
          <Input id="ex-amount" inputMode="decimal" className="tabular" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="ex-cur" error={err?.field('currency')}>
          <Input id="ex-cur" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Project" htmlFor="ex-project" className="sm:col-span-2" hint="Billable expenses on a client project can be added to that client's invoice." error={err?.field('project_id')}>
          <Select id="ex-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projectsQ.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.client_name ? ` (${p.client_name})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="ex-desc" className="sm:col-span-2" error={err?.field('description')}>
          <Textarea id="ex-desc" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
        </Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox label="Billable to client" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          <Checkbox label="Reimburse me" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
        </div>
        <Field label="Receipt" htmlFor="ex-file" className="sm:col-span-2" hint="JPEG, PNG, WebP or PDF, up to 10 MB.">
          <div className="flex items-center gap-2">
            <input id="ex-file" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              {file ? 'Replace file' : 'Attach receipt'}
            </Button>
            {file && (
              <span className="flex min-w-0 items-center gap-1 text-sm">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label="Remove receipt"
                  className="rounded-sm p-0.5 text-text-muted hover:bg-surface-muted"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </Field>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
