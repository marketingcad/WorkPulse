'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Clock, Plus, Trash2 } from 'lucide-react';
import type { ClientDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Panel,
  PermissionState,
  SegmentedControl,
  Select,
  SkeletonRows,
  Textarea,
  fmtDate,
  fmtMoney,
  useToast,
} from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg } from '@/lib/org';
import { Stepper } from '@/components/finance/stepper';
import { monthRange, toMinor, type InvoiceDetail, type InvoicePreview } from '@/components/finance/types';

type GroupBy = 'project' | 'task' | 'worker';
interface ExtraLine {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}
interface Body {
  client_id: string;
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string;
  group_by: GroupBy;
  tax_rate_bps: number;
  include_expenses: boolean;
  notes: string | null;
  extra_lines: Array<{ description: string; quantity: number; unit_price_minor: number; tax_rate_bps: number }>;
}

const STEPS = ['Client & period', 'Lines', 'Dates & notes', 'Review & create'];

export default function NewInvoicePage() {
  return (
    <Suspense>
      <Composer />
    </Suspense>
  );
}

function Composer() {
  const org = useOrg();
  const router = useRouter();
  const toast = useToast();
  const sp = useSearchParams();
  const today = todayIn(org.organization.timezone);
  const lastMonth = monthRange(addDays(`${today.slice(0, 8)}01`, -1));

  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState(sp.get('client') ?? '');
  const [start, setStart] = useState(lastMonth.from);
  const [end, setEnd] = useState(lastMonth.to);
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [taxPct, setTaxPct] = useState('0');
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);

  const clientsQ = useOrgQuery<ClientDto[]>('/clients');
  const client = clientsQ.data?.find((c) => c.id === clientId);

  const taxNum = Number(taxPct);
  const taxValid = taxPct.trim() !== '' && Number.isFinite(taxNum) && taxNum >= 0 && taxNum <= 100;
  const taxBps = taxValid ? Math.round(taxNum * 100) : 0;
  const extraParsed = extras.map((l) => ({ l, qty: Number(l.quantity), price: toMinor(l.unitPrice) }));
  const extrasValid = extraParsed.every(({ l, qty, price }) => l.description.trim() && l.quantity.trim() !== '' && Number.isFinite(qty) && qty >= 0 && price !== null);

  const body: Body = {
    client_id: clientId,
    period_start: start,
    period_end: end,
    issue_date: issueDate || today,
    due_date: dueDate || today,
    group_by: groupBy,
    tax_rate_bps: taxBps,
    include_expenses: includeExpenses,
    notes: notes.trim() || null,
    extra_lines: extraParsed
      .filter(({ l, qty, price }) => l.description.trim() && Number.isFinite(qty) && price !== null)
      .map(({ l, qty, price }) => ({ description: l.description.trim(), quantity: qty, unit_price_minor: price ?? 0, tax_rate_bps: taxBps })),
  };

  // Debounce the preview request body so typing in custom lines does not flood the API.
  const previewKey = JSON.stringify({ ...body, notes: null, issue_date: null, due_date: null });
  const [debouncedKey, setDebouncedKey] = useState(previewKey);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(previewKey), 350);
    return () => clearTimeout(t);
  }, [previewKey]);

  const previewQ = useQuery<InvoicePreview, ApiError>({
    queryKey: ['org', org.organization.id, 'invoice-preview', debouncedKey],
    queryFn: ({ signal }) => api<InvoicePreview>(`/orgs/${org.organization.id}/invoices/preview`, { method: 'POST', body: { ...JSON.parse(debouncedKey), issue_date: today, due_date: today }, signal }),
    enabled: step >= 1 && !!clientId && start <= end,
    placeholderData: (prev) => prev,
  });
  const preview = previewQ.data;
  const sourceLines = preview?.lines.filter((l) => l.kind !== 'CUSTOM') ?? [];

  const create = useOrgMutation<Body, InvoiceDetail>('POST', '/invoices');

  if (!org.can('invoices:manage')) return <PermissionState message="You need permission to manage invoices to create one." />;

  const step1Valid = !!clientId && !!start && !!end && start <= end && taxValid;
  const step2Valid = extrasValid && !!preview && preview.lines.length > 0;
  const step3Valid = !!issueDate && !!dueDate && dueDate >= issueDate;

  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const submit = async () => {
    setErr(null);
    try {
      const inv = await create.mutateAsync(body);
      toast.success(`Invoice ${inv.number} created`);
      router.push(`${org.base}/finance/invoices/${inv.id}`);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  const currency = preview?.currency ?? client?.currency ?? org.organization.currency;

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Turn approved billable time and expenses into an invoice."
        breadcrumbs={
          <Link href={`${org.base}/finance/invoices`} className="hover:underline">
            Invoices
          </Link>
        }
      />
      <Stepper steps={STEPS} current={step} onStep={setStep} />

      {step === 0 && (
        <Panel title="Client & period">
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:max-w-3xl">
            <Field label="Client" htmlFor="inv-client" required className="sm:col-span-2">
              <Select id="inv-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clientsQ.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.currency ? ` (${c.currency})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period start" htmlFor="inv-start" required>
              <Input id="inv-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Period end" htmlFor="inv-end" required error={start && end && start > end ? 'The period must end after it starts.' : undefined}>
              <Input id="inv-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="Group time by" className="sm:col-span-2">
              <div>
                <SegmentedControl
                  label="Group time by"
                  value={groupBy}
                  onChange={setGroupBy}
                  options={[
                    { value: 'project', label: 'Project' },
                    { value: 'task', label: 'Task' },
                    { value: 'worker', label: 'Member' },
                  ]}
                />
              </div>
            </Field>
            <Field label="Tax rate (%)" htmlFor="inv-tax" error={!taxValid ? 'Enter a percentage between 0 and 100.' : undefined}>
              <Input id="inv-tax" inputMode="decimal" className="tabular" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
            </Field>
            <div className="flex items-end pb-1.5">
              <Checkbox label="Include approved billable expenses" checked={includeExpenses} onChange={(e) => setIncludeExpenses(e.target.checked)} />
            </div>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button variant="primary" onClick={next} disabled={!step1Valid}>
              Preview lines <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Panel
            title={`Lines for ${client?.name ?? 'client'} · ${fmtDate(start)} – ${fmtDate(end)}`}
            actions={previewQ.isFetching && <span className="text-xs text-text-faint">Updating…</span>}
          >
            {previewQ.error ? (
              <ErrorState error={previewQ.error} onRetry={() => previewQ.refetch()} />
            ) : !preview ? (
              <SkeletonRows rows={4} cols={4} />
            ) : (
              <>
                {sourceLines.length === 0 && (
                  <EmptyState
                    icon={<Clock className="size-5" />}
                    title="Nothing to invoice in this period"
                    description="Approve timesheets first — only approved billable time can be invoiced. Time already on another invoice is excluded. You can still add custom lines below."
                    action={
                      <Link href={`${org.base}/timesheets/approvals`} className="text-sm font-medium text-interactive hover:underline">
                        Go to timesheet approvals
                      </Link>
                    }
                  />
                )}
                <LinesTable lines={preview.lines} currency={currency} />
                <Totals subtotal={preview.subtotal_minor} tax={preview.tax_minor} total={preview.total_minor} currency={currency} />
              </>
            )}
          </Panel>

          <Panel
            title="Custom lines"
            actions={
              <Button size="xs" icon={<Plus className="size-3.5" />} onClick={() => setExtras([...extras, { key: Date.now(), description: '', quantity: '1', unitPrice: '' }])}>
                Add line
              </Button>
            }
          >
            {extras.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">Add fixed fees, discounts or other items that are not tracked time.</p>
            ) : (
              <ul className="divide-y divide-border">
                {extras.map((l, idx) => {
                  const upd = (patch: Partial<ExtraLine>) => setExtras(extras.map((x) => (x.key === l.key ? { ...x, ...patch } : x)));
                  const p = extraParsed[idx]!;
                  return (
                    <li key={l.key} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2.5 sm:grid-cols-[1fr_96px_128px_auto] sm:items-end">
                      <Field label="Description" htmlFor={`xl-d-${l.key}`} className="col-span-2 sm:col-span-1">
                        <Input id={`xl-d-${l.key}`} value={l.description} maxLength={300} onChange={(e) => upd({ description: e.target.value })} aria-invalid={!l.description.trim()} />
                      </Field>
                      <Field label="Quantity" htmlFor={`xl-q-${l.key}`}>
                        <Input id={`xl-q-${l.key}`} inputMode="decimal" className="tabular text-right" value={l.quantity} onChange={(e) => upd({ quantity: e.target.value })} aria-invalid={!Number.isFinite(p.qty) || p.qty < 0} />
                      </Field>
                      <Field label={`Unit price (${currency})`} htmlFor={`xl-p-${l.key}`}>
                        <Input id={`xl-p-${l.key}`} inputMode="decimal" className="tabular text-right" placeholder="0.00" value={l.unitPrice} onChange={(e) => upd({ unitPrice: e.target.value })} aria-invalid={p.price === null && l.unitPrice !== ''} />
                      </Field>
                      <IconButton label="Remove line" className="mb-0.5" onClick={() => setExtras(extras.filter((x) => x.key !== l.key))}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="flex justify-between">
            <Button onClick={back} icon={<ArrowLeft className="size-3.5" />}>
              Back
            </Button>
            <Button variant="primary" onClick={next} disabled={!step2Valid || previewQ.isFetching}>
              Dates & notes <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <Panel title="Dates & notes">
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:max-w-3xl">
            <Field label="Issue date" htmlFor="inv-issue" required>
              <Input
                id="inv-issue"
                type="date"
                value={issueDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && dueDate === addDays(issueDate, 30)) setDueDate(addDays(v, 30));
                  setIssueDate(v);
                }}
              />
            </Field>
            <Field label="Due date" htmlFor="inv-due" required hint="Defaults to 30 days after the issue date." error={issueDate && dueDate && dueDate < issueDate ? 'The due date must be on or after the issue date.' : undefined}>
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Notes" htmlFor="inv-notes" className="sm:col-span-2" hint="Shown on the invoice, e.g. payment instructions.">
              <Textarea id="inv-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-between border-t border-border px-4 py-3">
            <Button onClick={back} icon={<ArrowLeft className="size-3.5" />}>
              Back
            </Button>
            <Button variant="primary" onClick={next} disabled={!step3Valid}>
              Review <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </Panel>
      )}

      {step === 3 && preview && (
        <Panel title="Review">
          <dl className="grid grid-cols-2 gap-4 border-b border-border p-4 sm:grid-cols-4">
            <ReviewItem label="Client" value={preview.client_name} />
            <ReviewItem label="Period" value={`${fmtDate(start)} – ${fmtDate(end)}`} />
            <ReviewItem label="Issue date" value={fmtDate(issueDate)} />
            <ReviewItem label="Due date" value={fmtDate(dueDate)} />
          </dl>
          <LinesTable lines={preview.lines} currency={currency} />
          <Totals subtotal={preview.subtotal_minor} tax={preview.tax_minor} total={preview.total_minor} currency={currency} />
          {notes.trim() && <p className="whitespace-pre-wrap border-t border-border px-4 py-3 text-sm text-text-muted">{notes}</p>}
          {err && (
            <p role="alert" className="border-t border-border px-4 py-2 text-sm text-danger">
              {err.title}
            </p>
          )}
          <div className="flex justify-between border-t border-border px-4 py-3">
            <Button onClick={back} icon={<ArrowLeft className="size-3.5" />}>
              Back
            </Button>
            <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!step1Valid || !step2Valid || !step3Valid}>
              Create draft invoice
            </Button>
          </div>
        </Panel>
      )}
      {step === 3 && !preview && (
        <Panel>
          <EmptyState title="Preview not available" description="Go back to the lines step to rebuild the preview." action={<Button onClick={() => setStep(1)}>Back to lines</Button>} />
        </Panel>
      )}
    </>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

const KIND_LABEL = { TIME: 'Time', EXPENSE: 'Expense', CUSTOM: 'Custom' } as const;

function LinesTable({ lines, currency }: { lines: InvoicePreview['lines']; currency: string }) {
  if (!lines.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Invoice lines</caption>
        <thead>
          <tr className="border-b border-border bg-surface-muted/60 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            <th scope="col" className="h-8 px-4 text-left">Description</th>
            <th scope="col" className="h-8 px-3 text-right">Qty</th>
            <th scope="col" className="h-8 px-3 text-right">Unit price</th>
            <th scope="col" className="h-8 px-4 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l, i) => (
            <tr key={i} className="h-10">
              <td className="px-4 py-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.kind === 'TIME' ? 'brand' : l.kind === 'EXPENSE' ? 'secondary' : 'neutral'}>{KIND_LABEL[l.kind]}</Badge>
                  <span>{l.description}</span>
                  {l.kind === 'TIME' && l.entries > 0 && <span className="text-xs text-text-faint">{l.entries} entries</span>}
                </span>
              </td>
              <td className="tabular px-3 text-right">{l.kind === 'TIME' ? `${l.quantity.toFixed(2)} h` : l.quantity}</td>
              <td className="tabular px-3 text-right">
                {fmtMoney(l.unit_price_minor, currency)}
                {l.kind === 'TIME' && <span className="text-text-faint"> /h</span>}
              </td>
              <td className="tabular px-4 text-right font-medium">{fmtMoney(l.amount_minor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ subtotal, tax, total, currency }: { subtotal: number; tax: number; total: number; currency: string }) {
  return (
    <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 border-t border-border px-4 py-3 text-sm">
      <dt className="text-text-muted">Subtotal</dt>
      <dd className="tabular text-right">{fmtMoney(subtotal, currency)}</dd>
      <dt className="text-text-muted">Tax</dt>
      <dd className="tabular text-right">{fmtMoney(tax, currency)}</dd>
      <dt className="font-semibold">Total</dt>
      <dd className="tabular text-right text-base font-semibold">{fmtMoney(total, currency)}</dd>
    </dl>
  );
}
