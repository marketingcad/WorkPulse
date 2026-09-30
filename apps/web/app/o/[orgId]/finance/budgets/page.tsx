'use client';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BudgetStatusDto } from '@tallywork/contracts';
import { Badge, BudgetProgress, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, KpiStrip, PageHeader, Panel, PermissionState, StatusBadge, fmtMoney, useToast, type Column } from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { BudgetDialog } from '@/components/finance/budget-dialog';


export default function BudgetsPage() {
  const org = useOrg();
  const toast = useToast();
  const q = useOrgQuery<BudgetStatusDto[]>(org.can('budgets:read') ? '/budgets' : null);
  const canManage = org.can('budgets:manage');
  const [editing, setEditing] = useState<BudgetStatusDto | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<BudgetStatusDto | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/budgets/${b.id}`);

  if (!org.can('budgets:read')) return <PermissionState />;

  const fmt = (b: BudgetStatusDto, v: number) => (b.kind === 'HOURS' ? org.fmtDuration(v) : b.amounts_hidden ? '—' : fmtMoney(v, b.currency));
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
    { key: 'kind', header: 'Type', cell: (b) => (b.kind === 'HOURS' ? 'Hours' : 'Money (billed)'), value: (b) => b.kind },
    { key: 'amount', header: 'Budget', align: 'right', cell: (b) => fmt(b, b.amount), value: (b) => b.amount, priority: 'secondary' },
    { key: 'spent', header: 'Used', align: 'right', cell: (b) => fmt(b, b.spent), value: (b) => b.spent, priority: 'secondary' },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      cell: (b) => (b.pct_used > 100 ? <span className="text-danger">over by {b.amounts_hidden ? `${Math.round(b.pct_used - 100)}%` : fmt(b, b.spent - b.amount)}</span> : fmt(b, b.remaining)),
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

