'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import type { ClientDto } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, ErrorState, FilterBar, KpiStrip, PageHeader, Panel, PermissionState, Select, StatusBadge, Tabs, fmtDate, fmtMoney, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { InvoiceRow, InvoiceStatus } from '@/components/finance/types';
import { InvoiceSections } from '@/components/finance/invoice-sections';

const TABS: Array<{ value: 'ALL' | InvoiceStatus; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_PAID', label: 'Partially paid' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesInner />
    </Suspense>
  );
}

function InvoicesInner() {
  const org = useOrg();
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get('status');
  const [status, setStatus] = useState<string>(TABS.some((t) => t.value === initial) ? initial! : 'ALL');
  const [clientId, setClientId] = useState(sp.get('client') ?? '');
  const allowed = org.can('invoices:read');
  const q = useOrgQuery<InvoiceRow[]>(allowed ? `/invoices${qs({ client_id: clientId })}` : null);
  const clientsQ = useOrgQuery<ClientDto[]>(allowed ? '/clients?include_archived=true' : null);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = status === 'ALL' ? all : all.filter((i) => i.status === status);
  // People who only record payments land on their section.
  const paymentsOnly = !allowed && org.can('payments:read');
  useEffect(() => {
    if (paymentsOnly) router.replace(org.base + '/finance/invoices/payments');
  }, [paymentsOnly, org.base, router]);

  if (!allowed) return <PermissionState />;

  const currency = org.organization.currency;
  const sum = (xs: InvoiceRow[], f: (i: InvoiceRow) => number) => xs.filter((i) => i.currency === currency).reduce((s, i) => s + f(i), 0);
  const open = all.filter((i) => i.status === 'SENT' || i.status === 'PARTIALLY_PAID' || i.status === 'OVERDUE');
  const overdue = all.filter((i) => i.status === 'OVERDUE');

  const columns: Column<InvoiceRow>[] = [
    {
      key: 'number',
      header: 'Number',
      cell: (i) => (
        <Link href={`${org.base}/finance/invoices/${i.id}`} className="font-medium text-interactive hover:underline" onClick={(e) => e.stopPropagation()}>
          {i.number}
        </Link>
      ),
      value: (i) => i.number,
      priority: 'primary',
    },
    { key: 'client', header: 'Client', cell: (i) => i.client_name, value: (i) => i.client_name, priority: 'primary' },
    { key: 'issued', header: 'Issued', cell: (i) => fmtDate(i.issue_date), value: (i) => i.issue_date, priority: 'secondary' },
    { key: 'due', header: 'Due', cell: (i) => <span className={i.status === 'OVERDUE' ? 'text-danger' : undefined}>{fmtDate(i.due_date)}</span>, value: (i) => i.due_date },
    { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} />, value: (i) => i.status, priority: 'secondary' },
    { key: 'total', header: 'Total', align: 'right', cell: (i) => fmtMoney(i.total_minor, i.currency), value: (i) => i.total_minor },
    { key: 'balance', header: 'Balance', align: 'right', cell: (i) => <span className="font-medium">{fmtMoney(i.balance_minor, i.currency)}</span>, value: (i) => i.balance_minor, priority: 'secondary' },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices built from approved billable time and expenses."
        actions={
          org.can('invoices:manage') && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => router.push(`${org.base}/finance/invoices/new`)}>
              New invoice
            </Button>
          )
        }
      />
      <InvoiceSections current="invoices" />
      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Outstanding', value: fmtMoney(sum(open, (i) => i.balance_minor), currency), hint: `${open.length} open` },
          { label: 'Overdue', value: <span className={overdue.length ? 'text-danger' : undefined}>{fmtMoney(sum(overdue, (i) => i.balance_minor), currency)}</span>, hint: `${overdue.length} invoices` },
          { label: 'Drafts', value: all.filter((i) => i.status === 'DRAFT').length },
          { label: 'Collected', value: fmtMoney(sum(all, (i) => i.paid_minor), currency) },
        ]}
      />
      <FilterBar>
        <Select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-56">
          <option value="">All clients</option>
          {clientsQ.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </FilterBar>
      <Panel>
        <Tabs
          value={status}
          onValueChange={setStatus}
          className="px-2 pt-1"
          items={TABS.map((t) => ({ value: t.value, label: t.label, count: q.data ? (t.value === 'ALL' ? all.length : all.filter((i) => i.status === t.value).length) : undefined }))}
        />
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data ? rows : undefined}
            loading={q.isLoading}
            columns={columns}
            rowKey={(i) => i.id}
            searchable
            searchPlaceholder="Search number or client…"
            initialSort={{ key: 'issued', dir: 'desc' }}
            onRowClick={(i) => router.push(`${org.base}/finance/invoices/${i.id}`)}
            empty={
              <EmptyState
                icon={<FileText className="size-5" />}
                title={status === 'ALL' ? 'No invoices yet' : 'No invoices with this status'}
                description={status === 'ALL' ? 'Create an invoice from approved billable time for a client and period.' : undefined}
                action={
                  status === 'ALL' &&
                  org.can('invoices:manage') && (
                    <Link href={`${org.base}/finance/invoices/new`} className="text-sm font-medium text-interactive hover:underline">
                      Create your first invoice
                    </Link>
                  )
                }
              />
            }
          />
        )}
      </Panel>
    </>
  );
}
