'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, FolderKanban, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { ClientDto } from '@tallywork/contracts';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PermissionState,
  StatusBadge,
  Textarea,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useOrgAction } from '@/components/workspace/shared';

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
        description="The client is hidden from pickers. Existing projects, time and invoices are kept, and you can restore it any time."
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

function ClientDialog({ client, open, onOpenChange }: { client: ClientDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const empty = { name: '', email: '', phone: '', address: '', currency: '', notes: '' };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(client ? { name: client.name, email: client.email ?? '', phone: client.phone ?? '', address: client.address ?? '', currency: client.currency ?? '', notes: client.notes ?? '' } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name,
      email: f.email.trim() || null,
      phone: f.phone || null,
      address: f.address || null,
      currency: f.currency.trim().toUpperCase() || null,
      notes: f.notes || null,
    };
    try {
      if (client) await run('PATCH', `/clients/${client.id}`, body);
      else await run('POST', '/clients', body);
      toast.success(client ? 'Client updated' : 'Client created');
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={client ? 'Edit client' : 'New client'}
      width={560}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>
            {client ? 'Save client' : 'Create client'}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" htmlFor="cl-name" required error={err?.field('name')} className="sm:col-span-2">
          <Input id="cl-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={150} />
        </Field>
        <Field label="Email" htmlFor="cl-email" error={err?.field('email')}>
          <Input id="cl-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="billing@client.com" />
        </Field>
        <Field label="Phone" htmlFor="cl-phone" error={err?.field('phone')}>
          <Input id="cl-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={50} />
        </Field>
        <Field label="Address" htmlFor="cl-address" error={err?.field('address')} className="sm:col-span-2">
          <Textarea id="cl-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={500} className="min-h-16" />
        </Field>
        <Field label="Currency" htmlFor="cl-currency" hint="ISO code, e.g. EUR. Empty uses the workspace currency." error={err?.field('currency')}>
          <Input id="cl-currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} className="tabular uppercase" placeholder="USD" />
        </Field>
        <Field label="Notes" htmlFor="cl-notes" error={err?.field('notes')} className="sm:col-span-2">
          <Textarea id="cl-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
