'use client';
/**
 * Client folders (settings.clientFolders): the folder grid shown as a view of the Projects page, and
 * the dialog that creates or renames a folder. A folder's projects are its client's; nothing moves.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Folder, FolderPlus, Search } from 'lucide-react';
import type { ClientDto, ClientFolderDto, ClientFoldersDto } from '@tallywork/contracts';
import { Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, Field, FilterBar, Input, Select, SkeletonRows, Textarea, cx, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useOrgAction } from './basics';
import { LogoAvatar } from './logo-editor';

type Sort = 'name' | 'projects' | 'updated';

export function ClientFoldersView() {
  const org = useOrg();
  const canManage = org.can('clients:manage', 'org');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const q = useOrgQuery<ClientFoldersDto>(`/client-folders${qs({ include_archived: archived || undefined })}`);

  const folders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (q.data?.folders ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.client_name.toLowerCase().includes(needle));
    const by: Record<Sort, (a: ClientFolderDto, b: ClientFolderDto) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      projects: (a, b) => b.project_count - a.project_count || a.name.localeCompare(b.name),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    };
    return [...list].sort(by[sort]);
  }, [q.data, search, sort]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <>
      <FilterBar>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search folders</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders or clients…" className="pl-8" />
        </label>
        <Select aria-label="Sort folders" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44">
          <option value="name">Name (A–Z)</option>
          <option value="projects">Most projects</option>
          <option value="updated">Recently updated</option>
        </Select>
        {canManage && <Checkbox label="Show archived" checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
        {canManage && (
          <Button className="sm:ml-auto" icon={<FolderPlus className="size-3.5" />} onClick={() => setCreating(true)}>
            New folder
          </Button>
        )}
      </FilterBar>

      {q.isLoading ? (
        <SkeletonRows rows={3} cols={3} />
      ) : !folders.length ? (
        <EmptyState
          icon={<Folder className="size-5" />}
          title={search ? 'No folders match your search' : 'No client folders yet'}
          description={search ? undefined : canManage ? 'Create a folder for a client to see all of its projects in one place.' : 'Folders for the clients you work with will appear here.'}
          action={!search && canManage && <Button onClick={() => setCreating(true)}>New folder</Button>}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Client folders">
          {folders.map((f) => (
            <li key={f.id}>
              <Link
                href={`${org.base}/projects/folders/${f.id}`}
                className={cx(
                  'flex h-full items-start gap-3 rounded-md border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive',
                  f.archived_at && 'opacity-70',
                )}
              >
                <LogoAvatar name={f.client_name} logo={f.client_logo} color={f.client_color} className="size-10 shrink-0 text-sm" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{f.name}</span>
                    {f.archived_at && <Badge>Archived</Badge>}
                  </span>
                  {f.name !== f.client_name && <span className="truncate text-xs text-text-muted">{f.client_name}</span>}
                  <span className="mt-1 text-sm text-text-muted">
                    <span className="tabular font-medium text-text">{f.project_count}</span> {f.project_count === 1 ? 'project' : 'projects'}
                    {f.project_count > 0 && <span> · {f.active_project_count} active</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && <FolderDialog folder={null} existing={q.data?.folders ?? []} onClose={() => setCreating(false)} />}
    </>
  );
}

/** Create a folder (choose a client) or rename one. */
export function FolderDialog({ folder, existing = [], onClose, onSaved }: { folder: ClientFolderDto | null; existing?: ClientFolderDto[]; onClose: () => void; onSaved?: (f: ClientFolderDto) => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const clientsQ = useOrgQuery<ClientDto[]>(folder ? null : '/clients');
  // Archived folders are not in `existing` unless shown; the server still refuses a second folder.
  const taken = new Set(existing.map((f) => f.client_id));
  const available = (clientsQ.data ?? []).filter((c) => !taken.has(c.id));
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(folder?.description ?? '');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (f: string) => err?.field(f) ?? null;

  const save = async () => {
    // Enter submits the form even while the button is disabled (form validation audit, 20 Nov 2026).
    if (busy || (folder ? !name.trim() : !clientId)) return;
    setBusy(true);
    setErr(null);
    try {
      const saved = folder
        ? await run<ClientFolderDto>('PATCH', `/client-folders/${folder.id}`, { name: name.trim(), description: description.trim() || null })
        : await run<ClientFolderDto>('POST', '/client-folders', { client_id: clientId, name: name.trim() || undefined, description: description.trim() || null });
      toast.success(folder ? 'Folder saved' : `Folder ${saved.name} created`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={folder ? 'Rename folder' : 'New client folder'}
      description={folder ? 'The folder name is only a label here. Invoices keep the client’s name.' : 'A folder shows all of a client’s projects together. Projects stay with their client.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={folder ? !name.trim() : !clientId} onClick={() => void save()}>
            {folder ? 'Save' : 'Create folder'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!folder && (
          <Field label="Client" htmlFor="folder-client" required error={fieldError('client_id')} hint={clientsQ.data && !available.length ? 'Every client already has a folder.' : undefined}>
            <Select id="folder-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose a client…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Folder name" htmlFor="folder-name" required={!!folder} error={fieldError('name')} hint={folder ? undefined : 'Optional. Defaults to the client’s name.'}>
          <Input id="folder-name" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="folder-description" error={fieldError('description')}>
          <Textarea id="folder-description" value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
