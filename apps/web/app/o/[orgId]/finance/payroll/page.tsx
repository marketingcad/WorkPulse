'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Landmark, Pencil, Plus } from 'lucide-react';
import type { PayrollProfileDto, PayrollRunDto } from '@tallywork/contracts';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, PageHeader, Panel, PermissionState, StatusBadge, Tabs, fmtDate, fmtMoney, useToast, type Column } from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { BankDetailsDialog, PayrollProfileDialog, RunPayrollDialog, periodLabel } from '@/components/finance/payroll';

export default function PayrollPage() {
  const org = useOrg();
  const [tab, setTab] = useState<'runs' | 'profiles'>('runs');
  if (!org.can('payroll:read')) return <PermissionState />;
  const canManage = org.can('payroll:manage');
  return (
    <>
      <PageHeader title="Payroll" description="Pay members for approved time and paid time off, then publish their pay stubs." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'runs' | 'profiles')} items={[{ value: 'runs', label: 'Payrolls' }, { value: 'profiles', label: 'Pay groups' }]} className="mb-4" />
      {tab === 'runs' ? <Runs canManage={canManage} /> : <Profiles canManage={canManage} />}
    </>
  );
}

function Runs({ canManage }: { canManage: boolean }) {
  const org = useOrg();
  const router = useRouter();
  const q = useOrgQuery<PayrollRunDto[]>('/payroll/runs');
  const [open, setOpen] = useState(false);
  const columns: Column<PayrollRunDto>[] = [
    { key: 'period', header: 'Period', priority: 'primary', value: (r) => r.period_start, cell: (r) => <span className="font-medium tabular">{`${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`}</span> },
    { key: 'profile', header: 'Pay group', priority: 'secondary', value: (r) => r.profile_name, cell: (r) => r.profile_name },
    { key: 'members', header: 'People', align: 'right', value: (r) => r.member_count, cell: (r) => <span className="tabular">{r.member_count}</span> },
    { key: 'gross', header: 'Gross', align: 'right', value: (r) => r.gross_minor, cell: (r) => <span className="tabular">{fmtMoney(r.gross_minor, r.currency)}</span> },
    { key: 'net', header: 'Net', align: 'right', priority: 'secondary', value: (r) => r.net_minor, cell: (r) => <span className="tabular font-semibold">{fmtMoney(r.net_minor, r.currency)}</span> },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <Panel
      title="Payrolls"
      actions={
        canManage && (
          <Button size="xs" variant="primary" icon={<Plus className="size-3" />} onClick={() => setOpen(true)}>
            Run payroll
          </Button>
        )
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`${org.base}/finance/payroll/${r.id}`)}
          caption="Payrolls"
          initialSort={{ key: 'period', dir: 'desc' }}
          empty={<EmptyState title="No payrolls yet" description="Run your first payroll once members have approved timesheets." action={canManage && <Button onClick={() => setOpen(true)}>Run payroll</Button>} />}
        />
      )}
      <RunPayrollDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(r) => {
          setOpen(false);
          router.push(`${org.base}/finance/payroll/${r.id}`);
        }}
      />
    </Panel>
  );
}

function Profiles({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const q = useOrgQuery<PayrollProfileDto[]>('/payroll/profiles');
  const [edit, setEdit] = useState<PayrollProfileDto | 'new' | null>(null);
  const [archive, setArchive] = useState<PayrollProfileDto | null>(null);
  const [bank, setBank] = useState<{ profile: PayrollProfileDto; membershipId: string; name: string } | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/payroll/profiles/${b.id}`);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const profiles = q.data ?? [];
  type Member = PayrollProfileDto['members'][number];

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
            New pay group
          </Button>
        </div>
      )}
      {!q.isLoading && !profiles.length && (
        <Panel>
          <EmptyState title="No pay groups" description="A pay group sets the pay period and currency for a group of members." action={canManage && <Button onClick={() => setEdit('new')}>New payroll profile</Button>} />
        </Panel>
      )}
      {profiles.map((p) => {
        const columns: Column<Member>[] = [
          { key: 'name', header: 'Member', priority: 'primary', value: (m) => m.name, cell: (m) => <span className="font-medium">{m.name}</span> },
          {
            key: 'bank',
            header: 'Bank details',
            priority: 'secondary',
            value: (m) => (m.bank ? 1 : 0),
            cell: (m) =>
              m.bank ? (
                <span className="text-text-muted">
                  {m.bank.bank_name ?? m.bank.type}
                  {m.bank.account_last4 && <span className="tabular"> ···· {m.bank.account_last4}</span>}
                </span>
              ) : (
                <Badge tone="warning">Missing</Badge>
              ),
          },
          ...(canManage
            ? [
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right' as const,
                  cell: (m: Member) => (
                    <Button size="xs" variant="ghost" aria-label={`Bank details for ${m.name}`} icon={<Landmark className="size-3" />} onClick={() => setBank({ profile: p, membershipId: m.membership_id, name: m.name })}>
                      Bank details
                    </Button>
                  ),
                },
              ]
            : []),
        ];
        return (
          <Panel
            key={p.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {p.name}
                <span className="text-xs font-normal text-text-muted">
                  {periodLabel(p.period)} · {p.currency}
                </span>
                {p.is_default && <Badge tone="brand">Default</Badge>}
              </span>
            }
            actions={
              canManage && (
                <>
                  <Button size="xs" icon={<Pencil className="size-3" />} onClick={() => setEdit(p)}>
                    Edit
                  </Button>
                  <Button size="xs" variant="ghost" icon={<Archive className="size-3" />} onClick={() => setArchive(p)}>
                    Archive
                  </Button>
                </>
              )
            }
          >
            <DataTable rows={p.members} columns={columns} rowKey={(m) => m.membership_id} caption={`Members of ${p.name}`} empty={<EmptyState title="No members" description="Edit the profile to add the people it pays." />} />
          </Panel>
        );
      })}
      <PayrollProfileDialog profile={edit === 'new' ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} />
      {bank && <BankDetailsDialog profileId={bank.profile.id} membershipId={bank.membershipId} name={bank.name} currency={bank.profile.currency} open onOpenChange={(o) => !o && setBank(null)} />}
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'pay group'}?`}
        description="No new payrolls can be run for it. Past payrolls and pay stubs are kept."
        confirmLabel="Archive"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!archive) return;
          try {
            await del.mutateAsync({ id: archive.id });
            toast.success(`${archive.name} archived`);
            setArchive(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
