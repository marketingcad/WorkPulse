'use client';
import { useState } from 'react';
import { Download, Landmark } from 'lucide-react';
import type { BankDetailsDto, PayStubDto } from '@tallywork/contracts';
import { Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, Panel, StatusBadge, fmtDate, fmtMoney, type Column } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { BankDetailsDialog } from '@/components/finance/payroll';

interface MyProfile {
  id: string;
  name: string;
  currency: string;
  bank: BankDetailsDto | null;
}

export default function PayStubsPage() {
  const org = useOrg();
  const stubsQ = useOrgQuery<PayStubDto[]>('/me/pay-stubs');
  const profilesQ = useOrgQuery<MyProfile[]>('/me/payroll-profiles');
  const [bank, setBank] = useState<MyProfile | null>(null);
  const pdf = (s: PayStubDto) => `/api/v1/orgs/${org.organization.id}/pay-stubs/${s.id}/pdf`;

  const columns: Column<PayStubDto>[] = [
    { key: 'period', header: 'Pay period', priority: 'primary', value: (s) => s.period_start, cell: (s) => <span className="font-medium tabular">{`${fmtDate(s.period_start)} – ${fmtDate(s.period_end)}`}</span> },
    { key: 'profile', header: 'Payroll', value: (s) => s.profile_name, cell: (s) => <span className="text-text-muted">{s.profile_name}</span> },
    { key: 'hours', header: 'Hours', align: 'right', value: (s) => s.approved_seconds, cell: (s) => <span className="tabular">{org.fmtDuration(s.approved_seconds)}</span> },
    { key: 'gross', header: 'Gross', align: 'right', value: (s) => s.gross_minor, cell: (s) => <span className="tabular">{fmtMoney(s.gross_minor, s.currency)}</span> },
    { key: 'net', header: 'Net pay', align: 'right', priority: 'secondary', value: (s) => s.net_minor, cell: (s) => <span className="tabular font-semibold">{fmtMoney(s.net_minor, s.currency)}</span> },
    { key: 'status', header: 'Status', value: (s) => s.status, cell: (s) => <StatusBadge status={s.status} /> },
    {
      key: 'pdf',
      header: <span className="sr-only">Download</span>,
      align: 'right',
      cell: (s) => (
        <a href={pdf(s)} target="_blank" rel="noopener noreferrer" className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-medium text-interactive hover:bg-surface-muted">
          <Download className="size-3" aria-hidden />
          PDF
        </a>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Pay stubs" description="Your pay for each finalized payroll." />
      <div className="flex flex-col gap-4">
        <Panel title="Pay stubs">
          {stubsQ.error ? (
            <ErrorState error={stubsQ.error} onRetry={() => stubsQ.refetch()} />
          ) : (
            <DataTable rows={stubsQ.data} loading={stubsQ.isLoading} columns={columns} rowKey={(s) => s.id} caption="Your pay stubs" initialSort={{ key: 'period', dir: 'desc' }} empty={<EmptyState title="No pay stubs yet" description="They appear here when a payroll that includes you is finalized." />} />
          )}
        </Panel>
        {!!profilesQ.data?.length && (
          <Panel title="Where you are paid">
            <ul className="divide-y divide-border">
              {profilesQ.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    <span className="font-medium">{p.name}</span> <span className="text-text-muted">· {p.currency}</span>
                    <span className="block text-xs text-text-muted">{p.bank ? [p.bank.bank_name ?? p.bank.type, p.bank.account_number ? `···· ${p.bank.account_number.replace(/\s+/g, '').slice(-4)}` : null].filter(Boolean).join(' ') : <Badge tone="warning">Bank details missing</Badge>}</span>
                  </span>
                  <Button size="sm" icon={<Landmark className="size-3.5" />} onClick={() => setBank(p)}>
                    {p.bank ? 'Update bank details' : 'Add bank details'}
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {bank && <BankDetailsDialog profileId={bank.id} membershipId={org.membership.id} name="you" currency={bank.currency} open onOpenChange={(o) => !o && setBank(null)} />}
    </>
  );
}
