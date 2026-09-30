'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Ban, CreditCard, Download, Pencil, Send, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Panel,
  PermissionState,
  SkeletonRows,
  StatusBadge,
  Textarea,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  useToast,
} from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { methodLabel, type InvoiceDetail } from '@/components/finance/types';

export default function InvoiceDetailPage() {
  const org = useOrg();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const allowed = org.can('invoices:read');
  const q = useOrgQuery<InvoiceDetail>(allowed ? `/invoices/${id}` : null);
  const send = useOrgMutation<Record<string, never>, InvoiceDetail>('POST', `/invoices/${id}/send`);
  const voidM = useOrgMutation<Record<string, never>, InvoiceDetail>('POST', `/invoices/${id}/void`);
  const del = useOrgMutation<undefined>('DELETE', `/invoices/${id}`, { invalidate: false });
  const removePay = useOrgMutation<{ id: string }>('DELETE', (b) => `/payments/${b.id}`);
  const router = useRouter();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<{ payment_id: string; amount_minor: number; received_on: string } | null>(null);
  const [paying, setPaying] = useState(false);

  if (!allowed) return <PermissionState />;

  const breadcrumbs = (
    <Link href={`${org.base}/finance/invoices`} className="hover:underline">
      Invoices
    </Link>
  );

  if (q.error)
    return (
      <>
        <PageHeader title="Invoice" breadcrumbs={breadcrumbs} />
        <Panel>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Panel>
      </>
    );
  const inv = q.data;
  if (!inv)
    return (
      <>
        <PageHeader title="Invoice" breadcrumbs={breadcrumbs} />
        <Panel>
          <SkeletonRows rows={8} cols={4} />
        </Panel>
      </>
    );

  const canManage = org.can('invoices:manage');
  const canPay = org.can('payments:manage') && inv.status !== 'DRAFT' && inv.status !== 'VOID' && inv.balance_minor > 0;
  const pdfUrl = `/api/v1/orgs/${org.organization.id}/invoices/${inv.id}/pdf`;
  const money = (m: number) => fmtMoney(m, inv.currency);
  const taxRates = [...new Set(inv.lines.map((l) => l.tax_rate_bps))];

  const doSend = async () => {
    try {
      await send.mutateAsync({});
      toast.success(inv.client.email ? `Invoice sent to ${inv.client.email}` : 'Invoice marked as sent (client has no email address)');
      setConfirmSend(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={
          <span className="flex items-center gap-3">
            {inv.number}
            <StatusBadge status={inv.status} />
          </span>
        }
        description={`${inv.client_name} · ${money(inv.total_minor)}${inv.sent_at ? ` · sent ${fmtDateTime(inv.sent_at)}` : ''}`}
        actions={
          <>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:border-border-strong hover:bg-surface-muted">
              <Download className="size-3.5" aria-hidden />
              Download PDF
            </a>
            {canManage && inv.status === 'DRAFT' && (
              <>
                <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                  Edit details
                </Button>
                <Button variant="primary" icon={<Send className="size-3.5" />} onClick={() => setConfirmSend(true)}>
                  Send
                </Button>
              </>
            )}
            {canPay && (
              <Button variant={inv.status === 'DRAFT' ? 'secondary' : 'primary'} icon={<CreditCard className="size-3.5" />} onClick={() => setPaying(true)}>
                Record payment
              </Button>
            )}
            {canManage && inv.status === 'DRAFT' && (
              <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                Delete draft
              </Button>
            )}
            {canManage && inv.status !== 'VOID' && inv.status !== 'DRAFT' && (
              <Button variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => setConfirmVoid(true)} disabled={inv.paid_minor > 0} title={inv.paid_minor > 0 ? 'Remove the payments applied to this invoice before voiding it' : undefined}>
                Void
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Document */}
        <article className="rounded-md border border-border bg-surface" aria-label={`Invoice ${inv.number}`}>
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border px-6 py-5">
            <div>
              <div className="text-lg font-semibold">{org.organization.name}</div>
              <div className="mt-4 text-2xs font-semibold uppercase tracking-wide text-text-faint">Bill to</div>
              <div className="text-sm font-medium">{inv.client.name}</div>
              {inv.client.address && <div className="whitespace-pre-line text-sm text-text-muted">{inv.client.address}</div>}
              {inv.client.email && <div className="text-sm text-text-muted">{inv.client.email}</div>}
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-text-muted">Invoice</dt>
              <dd className="tabular text-right font-semibold">{inv.number}</dd>
              <dt className="text-text-muted">Issued</dt>
              <dd className="text-right">{fmtDate(inv.issue_date)}</dd>
              <dt className="text-text-muted">Due</dt>
              <dd className={inv.status === 'OVERDUE' ? 'text-right font-medium text-danger' : 'text-right'}>{fmtDate(inv.due_date)}</dd>
              {inv.period_start && inv.period_end && (
                <>
                  <dt className="text-text-muted">Period</dt>
                  <dd className="text-right">
                    {fmtDate(inv.period_start, { month: 'short', day: 'numeric' })} – {fmtDate(inv.period_end)}
                  </dd>
                </>
              )}
            </dl>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Invoice lines</caption>
              <thead>
                <tr className="border-b border-border bg-surface-muted/60 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  <th scope="col" className="h-8 px-6 text-left">Description</th>
                  <th scope="col" className="h-8 px-3 text-right">Qty</th>
                  <th scope="col" className="h-8 px-3 text-right">Unit price</th>
                  <th scope="col" className="h-8 px-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inv.lines.map((l) => (
                  <tr key={l.id} className="h-10">
                    <td className="px-6 py-1.5">
                      {l.description}
                      {l.kind !== 'TIME' && (
                        <Badge className="ml-2" tone={l.kind === 'EXPENSE' ? 'secondary' : 'neutral'}>
                          {l.kind === 'EXPENSE' ? 'Expense' : 'Custom'}
                        </Badge>
                      )}
                    </td>
                    <td className="tabular px-3 text-right">{l.kind === 'TIME' ? `${l.quantity.toFixed(2)} h` : l.quantity}</td>
                    <td className="tabular px-3 text-right">{money(l.unit_price_minor)}</td>
                    <td className="tabular px-6 text-right font-medium">{money(l.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 border-t border-border px-6 py-4 sm:flex-row sm:justify-between">
            <div className="max-w-md text-sm text-text-muted">{inv.notes && <p className="whitespace-pre-wrap">{inv.notes}</p>}</div>
            <dl className="grid w-full max-w-xs grid-cols-2 gap-y-1 self-end text-sm">
              <dt className="text-text-muted">Subtotal</dt>
              <dd className="tabular text-right">{money(inv.subtotal_minor)}</dd>
              <dt className="text-text-muted">Tax{taxRates.length === 1 && taxRates[0] ? ` (${taxRates[0] / 100}%)` : ''}</dt>
              <dd className="tabular text-right">{money(inv.tax_minor)}</dd>
              <dt className="border-t border-border pt-1 font-semibold">Total</dt>
              <dd className="tabular border-t border-border pt-1 text-right font-semibold">{money(inv.total_minor)}</dd>
              <dt className="text-text-muted">Paid</dt>
              <dd className="tabular text-right">−{money(inv.paid_minor)}</dd>
              <dt className="font-semibold">Balance due</dt>
              <dd className="tabular text-right text-base font-semibold">{money(inv.balance_minor)}</dd>
            </dl>
          </div>
        </article>

        {/* Payments */}
        <Panel
          title="Payments applied"
          className="self-start"
          actions={
            canPay && (
              <Button size="xs" onClick={() => setPaying(true)}>
                Record
              </Button>
            )
          }
        >
          {inv.payments.length === 0 ? (
            <EmptyState
              title="No payments yet"
              description={inv.status === 'DRAFT' ? 'Send the invoice before recording payments.' : inv.status === 'VOID' ? 'This invoice is void.' : 'Record a payment when the client pays.'}
            />
          ) : (
            <ul className="divide-y divide-border">
              {inv.payments.map((p) => (
                <li key={p.payment_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{fmtDate(p.received_on)}</div>
                    <div className="truncate text-xs text-text-muted">
                      {methodLabel(p.provider)}
                      {p.provider_ref ? ` · ${p.provider_ref}` : ''}
                    </div>
                  </div>
                  <span className="flex items-center gap-1">
                    <span className="tabular font-medium">{money(p.amount_minor)}</span>
                    {org.can('payments:manage') && (
                      <IconButton label="Remove payment" size="xs" onClick={() => setRemoving(p)}>
                        <X className="size-3.5" />
                      </IconButton>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <RecordPaymentDialog open={paying} onOpenChange={setPaying} invoice={inv} />
      {editing && <EditDraftDialog invoice={inv} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={`Send invoice ${inv.number}?`}
        description={
          inv.client.email
            ? `We email ${inv.client.email} the amount due (${money(inv.total_minor)}), the due date and the lines. The invoice can no longer be edited or deleted afterwards, only voided.`
            : 'This client has no email address, so nothing is emailed. The invoice is marked as sent and can no longer be edited or deleted, only voided.'
        }
        confirmLabel={inv.client.email ? 'Send invoice' : 'Mark as sent'}
        loading={send.isPending}
        onConfirm={doSend}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete draft ${inv.number}?`}
        description="The draft is removed. Its time and expenses become available for a new invoice."
        confirmLabel="Delete draft"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined);
            toast.success(`Draft ${inv.number} deleted`);
            router.replace(`${org.base}/finance/invoices`);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this payment?"
        description={removing ? `The payment of ${money(removing.amount_minor)} received ${fmtDate(removing.received_on)} is deleted everywhere it was applied, and the invoice balance goes back up. Use this for payments recorded by mistake.` : undefined}
        confirmLabel="Remove payment"
        danger
        loading={removePay.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removePay.mutateAsync({ id: removing.payment_id });
            toast.success('Payment removed');
            setRemoving(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={confirmVoid}
        onOpenChange={setConfirmVoid}
        title={`Void invoice ${inv.number}?`}
        description="The invoice stays on record as void. Its time entries and expenses are released so they can be invoiced again."
        confirmLabel="Void invoice"
        danger
        loading={voidM.isPending}
        onConfirm={async () => {
          try {
            await voidM.mutateAsync({});
            toast.success('Invoice voided');
            setConfirmVoid(false);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

function EditDraftDialog({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const toast = useToast();
  const [issue, setIssue] = useState(invoice.issue_date);
  const [due, setDue] = useState(invoice.due_date);
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [err, setErr] = useState<ApiError | null>(null);
  const m = useOrgMutation<{ issue_date: string; due_date: string; notes: string | null }, InvoiceDetail>('PATCH', `/invoices/${invoice.id}`);
  const save = async () => {
    setErr(null);
    try {
      await m.mutateAsync({ issue_date: issue, due_date: due, notes: notes.trim() || null });
      toast.success('Invoice updated');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      else toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${invoice.number}`}
      description="Lines come from approved time and expenses. To change them, delete the draft and create it again."
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Issue date" htmlFor="inv-issue" error={err?.field('issue_date')}>
          <Input id="inv-issue" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </Field>
        <Field label="Due date" htmlFor="inv-due" error={err?.field('due_date')}>
          <Input id="inv-due" type="date" value={due} min={issue} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="inv-notes" hint="Shown on the invoice." className="col-span-2" error={err?.field('notes')}>
          <Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className="min-h-24" />
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
