'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import type { ClientDto, InvoicePageSummary, OffsetPage } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, ErrorState, FilterBar, Input, KpiStrip, PageHeader, Panel, PermissionState, Select, StatusBadge, Tabs, fmtDate, fmtMoney, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { useListPeriod } from '@/components/finance/list-period';
import { ExportMenu } from '@/components/reports/export-menu';
import type { InvoiceRow, InvoiceStatus } from '@/components/finance/types';

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
  const search = useSearch();
  const period = useListPeriod();
  // The server filters, pages and adds up every matching invoice, so totals and tab counts are never cut short.
  const filters = { client_id: clientId || undefined, status: status === 'ALL' ? undefined : status, ...period.filter, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<InvoiceRow> & { summary: InvoicePageSummary }>(allowed ? `/invoices${qs({ ...filters, ...paging.params })}` : null, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const clientsQ = useOrgQuery<ClientDto[]>(allowed ? '/clients?include_archived=true' : null);
  const summary = q.data?.summary;
  // People who only record payments land on their section.
  const paymentsOnly = !allowed && org.can('payments:read');
  useEffect(() => {
    if (paymentsOnly) router.replace(org.base + '/finance/invoices/payments');
  }, [paymentsOnly, org.base, router]);

  // Nothing to show while that redirect runs (no "no access" flash).
  if (paymentsOnly) return null;
  if (!allowed) return <PermissionState />;

  const currency = summary?.currency ?? org.organization.currency;
  const money = (m: number | undefined) => (summary ? fmtMoney(m ?? 0, currency) : '—');

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
      sortable: false,
      priority: 'primary',
    },
    { key: 'client', header: 'Client', cell: (i) => i.client_name, value: (i) => i.client_name, sortable: false, priority: 'primary' },
    { key: 'issued', header: 'Issued', cell: (i) => fmtDate(i.issue_date), value: (i) => i.issue_date, sortable: false, priority: 'secondary' },
    { key: 'due', header: 'Due', cell: (i) => <span className={i.status === 'OVERDUE' ? 'text-danger' : undefined}>{fmtDate(i.due_date)}</span>, value: (i) => i.due_date, sortable: false },
    { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} />, value: (i) => i.status, sortable: false, priority: 'secondary' },
    { key: 'total', header: 'Total', align: 'right', cell: (i) => fmtMoney(i.total_minor, i.currency), value: (i) => i.total_minor, sortable: false },
    { key: 'balance', header: 'Balance', align: 'right', cell: (i) => <span className="font-medium">{fmtMoney(i.balance_minor, i.currency)}</span>, value: (i) => i.balance_minor, sortable: false, priority: 'secondary' },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices built from approved billable time and expenses."
        actions={
          <>
            {org.can('reports:finance') && <ExportMenu reportKey="invoices" from={period.from} to={period.to} status={status === 'ALL' ? undefined : status} />}
            {org.can('invoices:manage') && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => router.push(`${org.base}/finance/invoices/new`)}>
                New invoice
              </Button>
            )}
          </>
        }
      />
      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Outstanding', value: money(summary?.outstanding_minor), hint: summary ? `${summary.open_count} open` : undefined },
          { label: 'Overdue', value: <span className={summary?.overdue_count ? 'text-danger' : undefined}>{money(summary?.overdue_minor)}</span>, hint: summary ? `${summary.overdue_count} invoices` : undefined },
          { label: 'Drafts', value: summary ? summary.counts.DRAFT : '—' },
          { label: 'Collected', value: money(summary?.collected_minor) },
        ]}
      />
      <FilterBar>
        {period.picker}
        <Select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-56">
          <option value="">All clients</option>
          {clientsQ.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input aria-label="Search invoices" placeholder="Search number or client…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-64" />
      </FilterBar>
      <Panel>
        <Tabs
          value={status}
          onValueChange={setStatus}
          className="px-2 pt-1"
          items={TABS.map((t) => ({ value: t.value, label: t.label, count: summary?.counts[t.value] }))}
        />
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(i) => i.id}
            pagination={paging.pagination(q.data)}
            caption="Invoices"
            onRowClick={(i) => router.push(`${org.base}/finance/invoices/${i.id}`)}
            empty={
              <EmptyState
                icon={<FileText className="size-5" />}
                title={search.term ? 'No invoices match your search' : status === 'ALL' ? 'No invoices yet' : 'No invoices with this status'}
                description={status === 'ALL' && !search.term ? 'Create an invoice from approved billable time for a client and period.' : undefined}
                action={
                  status === 'ALL' &&
                  !search.term &&
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
