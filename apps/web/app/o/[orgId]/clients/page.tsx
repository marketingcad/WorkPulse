'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, FileText, FolderKanban, LayoutDashboard, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { ClientDto } from '@tallywork/contracts';
import { Button, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, Menu, MenuItem, PageHeader, Panel, PermissionState, StatusBadge, useToast, type Column } from '@tallywork/ui';
import { errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { useOrgAction } from '@/components/workspace/shared';
import { LogoAvatar } from '@/components/workspace/logo-editor';
import { ClientDialog } from '@/components/workspace/client-dialog';

export default function ClientsPage() {
  const org = useOrg();
  const router = useRouter();
  const canManage = org.can('clients:manage');
  const [showArchived, setShowArchived] = useState(false);
  const q = useOrgQuery<ClientDto[]>(org.can('clients:read') ? `/clients${qs({ include_archived: showArchived || undefined })}` : null);
  const [edit, setEdit] = useState<ClientDto | 'new' | null>(null);
  const [archive, setArchive] = useState<ClientDto | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useOrgAction();
  const toast = useToast();

  if (!org.can('clients:read')) return <PermissionState />;

  const restore = async (c: ClientDto) => {
    try {
      await run('POST', `/clients/${c.id}/restore`);
      toast.success(`${c.name} restored`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ClientDto>[] = [
    {
      key: 'name',
      header: 'Client',
      priority: 'primary',
      value: (c) => c.name,
      cell: (c) => (
        <span className="flex items-center gap-2">
          <LogoAvatar name={c.name} logo={c.logo} color={c.color} className="size-6 text-2xs" />
          <span className="truncate font-medium">{c.name}</span>
          {c.archived_at && <StatusBadge status="ARCHIVED" />}
        </span>
      ),
    },
    { key: 'email', header: 'Email', priority: 'secondary', value: (c) => c.email ?? '', cell: (c) => <span className="text-text-muted">{c.email ?? '—'}</span> },
    { key: 'phone', header: 'Phone', value: (c) => c.phone ?? '', cell: (c) => <span className="text-text-muted">{c.phone ?? '—'}</span> },
    { key: 'projects', header: 'Projects', align: 'right', priority: 'secondary', value: (c) => c.project_count, cell: (c) => c.project_count },
    { key: 'currency', header: 'Currency', value: (c) => c.currency ?? org.organization.currency, cell: (c) => <span className="tabular text-text-muted">{c.currency ?? `${org.organization.currency} (default)`}</span> },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (c: ClientDto) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Menu
                  trigger={
                    <IconButton label={`Actions for ${c.name}`} size="xs">
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(c)}>
                    Edit
                  </MenuItem>
                  <MenuItem icon={<FolderKanban className="size-3.5" />} onSelect={() => router.push(`${org.base}/projects?client=${c.id}`)}>
                    View projects
                  </MenuItem>
                  <MenuItem icon={<LayoutDashboard className="size-3.5" />} onSelect={() => router.push(`${org.base}/clients/${c.id}/portal`)}>
                    {t('portal.admin.title')}
                  </MenuItem>
                  {org.can('invoices:manage') && !c.archived_at && (
                    <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => router.push(`${org.base}/finance/invoices/new?client=${c.id}`)}>
                      New invoice
                    </MenuItem>
                  )}
                  {c.archived_at ? (
                    <MenuItem icon={<ArchiveRestore className="size-3.5" />} onSelect={() => restore(c)}>
                      Restore
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchive(c)}>
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

  return (
    <>
      <PageHeader
        title="Clients"
        description="The companies you bill. Projects and invoices belong to a client."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
              New client
            </Button>
          )
        }
      />
      <Panel>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(c) => c.id}
            onRowClick={canManage ? (c) => setEdit(c) : undefined}
            searchable
            searchPlaceholder="Search clients…"
            caption="Clients"
            initialSort={{ key: 'name', dir: 'asc' }}
            rowClassName={(c) => (c.archived_at ? 'opacity-70' : undefined)}
            toolbar={<Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="text-xs" />}
            empty={
              <EmptyState
                title="No clients yet"
                description={canManage ? 'Add a client to group projects and create invoices from tracked time.' : undefined}
                action={canManage && <Button onClick={() => setEdit('new')}>New client</Button>}
              />
            }
          />
        )}
      </Panel>

      <ClientDialog client={edit === 'new' ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} />
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'client'}?`}
        description="The client and its projects are archived: they are hidden from pickers and take no new time. Time and invoices are kept, and restoring the client brings its projects back."
        confirmLabel="Archive"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!archive) return;
          setBusy(true);
          try {
            await run('POST', `/clients/${archive.id}/archive`);
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

