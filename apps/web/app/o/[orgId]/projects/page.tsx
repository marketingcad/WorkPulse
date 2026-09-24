'use client';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { BudgetStatusDto, ClientDto, ProjectDto, TeamDto, WorkerDto } from '@tallywork/contracts';
import {
  Badge,
  BudgetProgress,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  fmtMoney,
  useToast,
  type Column,
} from '@tallywork/ui';
import { errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ColorDot, PROJECT_STATUSES, ProjectDialog, ProjectStatusBadge, useOrgAction } from '@/components/workspace/shared';

export default function ProjectsPage() {
  return (
    <Suspense>
      <Projects />
    </Suspense>
  );
}

function Projects() {
  const org = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = org.can('projects:manage');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState(params.get('client') ?? '');
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<ProjectDto | 'new' | null>(null);
  const [archive, setArchive] = useState<ProjectDto | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useOrgAction();
  const toast = useToast();

  const q = useOrgQuery<ProjectDto[]>(org.can('projects:read') ? `/projects${qs({ include_archived: archived || undefined, client_id: clientId || undefined })}` : null);
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);
  const budgetsQ = useOrgQuery<BudgetStatusDto[]>(org.can('budgets:read') ? '/budgets' : null);
  const workersQ = useOrgQuery<WorkerDto[]>(canManage && org.can('members:read') ? '/workers' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(canManage && org.can('teams:read') ? '/teams' : null);

  const budgetByProject = useMemo(() => new Map((budgetsQ.data ?? []).filter((b) => b.subject_type === 'PROJECT').map((b) => [b.subject_id, b])), [budgetsQ.data]);
  const rows = useMemo(() => (q.data ?? []).filter((p) => !status || p.status === status), [q.data, status]);

  if (!org.can('projects:read')) return <PermissionState />;

  const restore = async (p: ProjectDto) => {
    try {
      await run('POST', `/projects/${p.id}/restore`);
      toast.success(`${p.name} restored`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ProjectDto>[] = [
    {
      key: 'name',
      header: 'Project',
      priority: 'primary',
      value: (p) => p.name,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <ColorDot color={p.color} />
          <span className="truncate font-medium">{p.name}</span>
        </span>
      ),
    },
    { key: 'client', header: 'Client', priority: 'secondary', value: (p) => p.client_name ?? '', cell: (p) => <span className="text-text-muted">{p.client_name ?? '—'}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', value: (p) => (p.archived_at ? 'ZZ' : p.status), cell: (p) => <ProjectStatusBadge project={p} /> },
    { key: 'billable', header: 'Billing', value: (p) => (p.billable_default ? 1 : 0), cell: (p) => (p.billable_default ? <Badge tone="success">Billable</Badge> : <Badge>Non-billable</Badge>) },
    { key: 'members', header: 'Members', align: 'right', value: (p) => p.member_ids.length, cell: (p) => (
        <span>
          {p.member_ids.length}
          {p.team_ids.length > 0 && <span className="text-xs text-text-faint"> + {p.team_ids.length} {p.team_ids.length === 1 ? 'team' : 'teams'}</span>}
        </span>
      ),
    },
    { key: 'tracked', header: 'Tracked', align: 'right', value: (p) => p.tracked_seconds ?? 0, cell: (p) => org.fmtDuration(p.tracked_seconds ?? 0) },
    ...(budgetsQ.data
      ? [
          {
            key: 'budget',
            header: 'Budget',
            width: '180px',
            value: (p: ProjectDto) => budgetByProject.get(p.id)?.pct_used ?? -1,
            cell: (p: ProjectDto) => {
              const b = budgetByProject.get(p.id);
              if (!b) return <span className="text-xs text-text-faint">No budget</span>;
              return (
                <span className="flex w-full flex-col gap-1">
                  <span className="tabular text-2xs text-text-muted">
                    {b.kind === 'HOURS' ? `${org.fmtDuration(b.spent)} / ${org.fmtDuration(b.amount)}` : `${fmtMoney(b.spent, b.currency)} / ${fmtMoney(b.amount, b.currency)}`} · {Math.round(b.pct_used)}%
                  </span>
                  <BudgetProgress pct={b.pct_used} state={b.state} projectedPct={b.projected ? (b.projected / b.amount) * 100 : null} />
                </span>
              );
            },
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (p: ProjectDto) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Menu
                  trigger={
                    <IconButton label={`Actions for ${p.name}`} size="xs">
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(p)}>
                    Edit
                  </MenuItem>
                  {p.archived_at ? (
                    <MenuItem icon={<ArchiveRestore className="size-3.5" />} onSelect={() => restore(p)}>
                      Restore
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchive(p)}>
                      Archive
                    </MenuItem>
                  )}
                </Menu>
              </span>
            ),
          },
        ]
      : []),
  ];

  const filtered = !!status || !!clientId;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Where time is tracked. Members and teams on a project can track to it."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
              New project
            </Button>
          )
        }
      />
      <FilterBar>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {clientsQ.data && (
          <Select aria-label="Filter by client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-48">
            <option value="">All clients</option>
            {clientsQ.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Checkbox label="Include archived" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setStatus(''), setClientId(''))}>
            Clear filters
          </Button>
        )}
      </FilterBar>
      <Panel>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            loading={q.isLoading}
            columns={columns}
            rowKey={(p) => p.id}
            onRowClick={(p) => router.push(`${org.base}/projects/${p.id}`)}
            searchable
            searchPlaceholder="Search projects or clients…"
            caption="Projects"
            initialSort={{ key: 'name', dir: 'asc' }}
            rowClassName={(p) => (p.archived_at ? 'opacity-70' : undefined)}
            empty={
              <EmptyState
                title={filtered ? 'No projects match these filters' : 'No projects yet'}
                description={filtered ? undefined : canManage ? 'Create a project so your team can start tracking time to it.' : 'You are not assigned to any project yet. Ask your manager to add you.'}
                action={!filtered && canManage && <Button onClick={() => setEdit('new')}>New project</Button>}
              />
            }
          />
        )}
      </Panel>

      <ProjectDialog
        open={edit !== null}
        onOpenChange={(o) => !o && setEdit(null)}
        project={edit === 'new' ? null : edit}
        clients={clientsQ.data}
        workers={workersQ.data}
        teams={teamsQ.data}
        onSaved={(p) => edit === 'new' && router.push(`${org.base}/projects/${p.id}`)}
      />
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'project'}?`}
        description="Nobody can track new time to it. Tracked time, budgets and invoices are kept, and you can restore it later."
        confirmLabel="Archive"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!archive) return;
          setBusy(true);
          try {
            await run('POST', `/projects/${archive.id}/archive`);
            toast.success(`${archive.name} archived`, { label: 'Undo', onClick: () => void restore(archive) });
            setArchive(null);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
