'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, PageHeader, Panel, PermissionState, fmtDate, fmtMoney, useToast, type Column } from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { InvoiceSections } from '@/components/finance/invoice-sections';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { methodLabel, type PaymentRow } from '@/components/finance/types';

export default function PaymentsReceivedPage() {
  const org = useOrg();
  const toast = useToast();
  const allowed = org.can('payments:read');
  const q = useOrgQuery<PaymentRow[]>(allowed ? '/payments' : null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<PaymentRow | null>(null);
  const remove = useOrgMutation<{ id: string }>('DELETE', (b) => `/payments/${b.id}`);
  const canManage = org.can('payments:manage');

  if (!allowed) return <PermissionState />;

  const columns: Column<PaymentRow>[] = [
    { key: 'date', header: 'Received', cell: (p) => fmtDate(p.received_on), value: (p) => p.received_on, priority: 'secondary' },
    { key: 'client', header: 'Client', cell: (p) => <span className="font-medium">{p.client_name ?? <span className="text-text-faint">No client</span>}</span>, value: (p) => p.client_name ?? '', priority: 'primary' },
    { key: 'method', header: 'Method', cell: (p) => methodLabel(p.provider), value: (p) => p.provider },
    { key: 'ref', header: 'Reference', cell: (p) => p.provider_ref ?? <span className="text-text-faint">—</span>, value: (p) => `${p.provider_ref ?? ''} ${p.note ?? ''}` },
    {
      key: 'alloc',
      header: 'Applied to',
      cell: (p) => {
        const allocated = p.allocations.reduce((s, a) => s + a.amount_minor, 0);
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {p.allocations.map((a) => (
              <Link key={a.invoice_id} href={`${org.base}/finance/invoices/${a.invoice_id}`} className="text-interactive hover:underline" title={fmtMoney(a.amount_minor, p.currency)}>
                {a.invoice_number}
              </Link>
            ))}
            {allocated < p.amount_minor && <span className="text-xs text-warning">{fmtMoney(p.amount_minor - allocated, p.currency)} unallocated</span>}
          </span>
        );
      },
      value: (p) => p.allocations.map((a) => a.invoice_number).join(' '),
      priority: 'secondary',
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className="font-medium">{fmtMoney(p.amount_minor, p.currency)}</span>, value: (p) => p.amount_minor, priority: 'primary' },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (p: PaymentRow) => (
              <IconButton label="Remove payment" size="xs" onClick={() => setRemoving(p)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Money received from clients and the invoices it was applied to."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
              Record payment
            </Button>
          )
        }
      />
      <InvoiceSections current="payments" />
      <Panel>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(p) => p.id}
            searchable
            searchPlaceholder="Search client, reference or invoice…"
            initialSort={{ key: 'date', dir: 'desc' }}
            empty={
              <EmptyState
                icon={<CreditCard className="size-5" />}
                title="No payments recorded"
                description="Record a payment when a client pays, and apply it to one or more open invoices."
                action={canManage && <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Record payment</Button>}
              />
            }
          />
        )}
      </Panel>
      <RecordPaymentDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this payment?"
        description={
          removing
            ? `The payment of ${fmtMoney(removing.amount_minor, removing.currency)} received ${fmtDate(removing.received_on)} is deleted${removing.allocations.length ? ` and taken off ${removing.allocations.map((a) => a.invoice_number).join(', ')}` : ''}. Use this for payments recorded by mistake.`
            : undefined
        }
        confirmLabel="Remove payment"
        danger
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync({ id: removing.id });
            toast.success('Payment removed');
            setRemoving(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
