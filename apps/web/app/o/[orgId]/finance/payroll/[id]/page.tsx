'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Trash2, WalletCards } from 'lucide-react';
import type { PayStubDto, PayrollRunDto } from '@tallywork/contracts';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, KpiStrip, PageHeader, Panel, PermissionState, SkeletonRows, StatusBadge, fmtDate, fmtMoney, useToast, type Column } from '@tallywork/ui';
import { errorMessage, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useOrgAction } from '@/components/workspace/shared';
import { AdjustmentsDialog } from '@/components/finance/payroll';

type Action = 'recalculate' | 'finalize' | 'paid' | 'delete';

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const org = useOrg();
  const router = useRouter();
  const toast = useToast();
  const run = useOrgAction();
  const q = useOrgQuery<PayrollRunDto>(org.can('payroll:read') ? `/payroll/runs/${id}` : null);
  const [adjust, setAdjust] = useState<PayStubDto | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  if (!org.can('payroll:read')) return <PermissionState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r)
    return (
      <Panel>
        <SkeletonRows rows={5} cols={5} />
      </Panel>
    );

  const canManage = org.can('payroll:manage');
  const draft = r.status === 'DRAFT';
  const m = (v: number) => fmtMoney(v, r.currency);
  const h = org.fmtDuration;
  const unapproved = (r.lines ?? []).reduce((s, l) => s + l.unapproved_seconds, 0);
  const pdf = (l: PayStubDto) => `/api/v1/orgs/${org.organization.id}/pay-stubs/${l.id}/pdf`;

  const act = async (a: Action) => {
    setBusy(true);
    try {
      if (a === 'delete') {
        await run('DELETE', `/payroll/runs/${r.id}`);
        toast.success('Draft payroll deleted');
        router.push(`${org.base}/finance/payroll`);
        return;
      }
      await run('POST', `/payroll/runs/${r.id}/${a}`);
      toast.success({ recalculate: 'Payroll recalculated from approved time', finalize: 'Payroll finalized; members can see their pay stubs', paid: 'Payroll marked as paid' }[a]);
      setConfirm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PayStubDto>[] = [
    { key: 'name', header: 'Member', priority: 'primary', value: (l) => l.name, cell: (l) => <span className="font-medium">{l.name}</span> },
    {
      key: 'hours',
      header: 'Approved',
      align: 'right',
      value: (l) => l.approved_seconds,
      cell: (l) => (
        <span className="tabular">
          {h(l.approved_seconds)}
          {l.carried_seconds > 0 && <span className="block text-xs text-text-muted">incl. {h(l.carried_seconds)} from earlier periods</span>}
        </span>
      ),
    },
    { key: 'ot', header: 'Overtime', align: 'right', value: (l) => l.overtime_seconds, cell: (l) => <span className="tabular text-text-muted">{l.overtime_seconds ? h(l.overtime_seconds) : '—'}</span> },
    { key: 'off', header: 'Time off', align: 'right', value: (l) => l.time_off_hours, cell: (l) => <span className="tabular text-text-muted">{l.time_off_hours ? `${l.time_off_hours} h` : '—'}</span> },
    { key: 'gross', header: 'Gross', align: 'right', value: (l) => l.gross_minor, cell: (l) => <span className="tabular">{m(l.gross_minor)}</span> },
    {
      key: 'adj',
      header: 'Adjustments',
      align: 'right',
      value: (l) => l.adjustments.reduce((s, a) => s + a.amount_minor, 0),
      cell: (l) => {
        const t = l.adjustments.reduce((s, a) => s + a.amount_minor, 0);
        return <span className="tabular text-text-muted">{t ? `${t > 0 ? '+' : '−'}${m(Math.abs(t))}` : '—'}</span>;
      },
    },
    { key: 'net', header: 'Net', align: 'right', priority: 'secondary', value: (l) => l.net_minor, cell: (l) => <span className="tabular font-semibold">{m(l.net_minor)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (l) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {draft && canManage && (
            <Button size="xs" variant="ghost" onClick={() => setAdjust(l)}>
              Adjust
            </Button>
          )}
          {!draft && (
            <a href={pdf(l)} target="_blank" rel="noopener noreferrer" className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-medium text-interactive hover:bg-surface-muted">
              <Download className="size-3" aria-hidden />
              Stub
            </a>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/finance/payroll`} className="hover:text-text hover:underline">
            Payroll
          </Link>
        }
        title={`${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {r.profile_name} · {r.currency} <StatusBadge status={r.status} />
          </span>
        }
        actions={
          canManage && (
            <>
              {draft && (
                <>
                  <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm('delete')}>
                    Delete draft
                  </Button>
                  <Button icon={<RefreshCw className="size-3.5" />} loading={busy && confirm === null} onClick={() => act('recalculate')}>
                    Recalculate
                  </Button>
                  <Button variant="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setConfirm('finalize')}>
                    Finalize
                  </Button>
                </>
              )}
              {r.status === 'FINALIZED' && (
                <Button variant="primary" icon={<WalletCards className="size-3.5" />} onClick={() => setConfirm('paid')}>
                  Mark as paid
                </Button>
              )}
            </>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <KpiStrip
          items={[
            { label: 'Gross', value: m(r.gross_minor) },
            { label: 'Adjustments', value: m(r.adjustments_minor) },
            { label: 'Net pay', value: m(r.net_minor) },
            { label: 'People', value: r.member_count },
          ]}
        />
        {(unapproved > 0 || r.other_currency) && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              {unapproved > 0 && <p>{h(unapproved)} in this period is not approved yet and is not paid. {draft && 'Approve those timesheets, then recalculate.'}</p>}
              {r.other_currency && <p>Some time was priced in another currency and is not part of this {r.currency} payroll.</p>}
            </div>
          </div>
        )}
        {r.notes && <p className="text-sm text-text-muted">{r.notes}</p>}
        <Panel title="Pay stubs">
          <DataTable rows={r.lines} columns={columns} rowKey={(l) => l.id} caption="Pay per member" initialSort={{ key: 'name', dir: 'asc' }} empty={<EmptyState title="Nobody in this payroll" description="Add members to the pay group, then recalculate." />} />
        </Panel>
      </div>

      {adjust && <AdjustmentsDialog runId={r.id} line={adjust} onClose={() => setAdjust(null)} />}
      <ConfirmDialog
        open={confirm !== null && confirm !== 'recalculate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'finalize' ? 'Finalize payroll?' : confirm === 'paid' ? 'Mark payroll as paid?' : 'Delete draft payroll?'}
        description={
          confirm === 'finalize'
            ? 'Amounts are locked and every member gets their pay stub. Time approved later goes into the next payroll.'
            : confirm === 'paid'
              ? 'Record that everyone in this payroll has been paid.'
              : 'The draft and its adjustments are removed. You can run it again.'
        }
        confirmLabel={confirm === 'finalize' ? 'Finalize' : confirm === 'paid' ? 'Mark as paid' : 'Delete draft'}
        danger={confirm === 'delete'}
        loading={busy}
        onConfirm={() => confirm && act(confirm)}
      />
    </>
  );
}
