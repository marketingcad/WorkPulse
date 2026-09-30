'use client';
import { useRef, useState } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import type { ProjectDocumentDto, ProjectDto } from '@tallywork/contracts';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, Panel, fmtDateTime, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useOrgAction } from './shared';
import { useQueryClient } from '@tanstack/react-query';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
const MAX_BYTES = 25 * 1024 * 1024;

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);

/** Files attached to a project: briefs, contracts, specs. */
export function ProjectDocumentsTab({ project }: { project: ProjectDto }) {
  const org = useOrg();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const run = useOrgAction();
  const q = useOrgQuery<ProjectDocumentDto[]>(`/projects/${project.id}/documents`);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [remove, setRemove] = useState<ProjectDocumentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = org.can('projects:manage');
  const url = (d: ProjectDocumentDto, download = false) => `/api/v1/orgs/${orgId}/projects/${project.id}/documents/${d.id}${download ? '?download=1' : ''}`;

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    for (const file of list) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.set('file', file);
        // Multipart upload: the JSON helper would set the wrong content type.
        const res = await fetch(`/api/v1/orgs/${orgId}/projects/${project.id}/documents`, { method: 'POST', body: form, credentials: 'include' });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { title?: string } | null;
          throw new ApiError(res.status, 'upload_failed', body?.title ?? 'Upload failed');
        }
        toast.success(`${file.name} uploaded`);
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
  };

  const columns: Column<ProjectDocumentDto>[] = [
    {
      key: 'name',
      header: 'Document',
      priority: 'primary',
      value: (d) => d.name,
      cell: (d) => (
        <a href={url(d)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 font-medium hover:underline">
          <FileText className="size-3.5 shrink-0 text-text-muted" aria-hidden />
          <span className="truncate">{d.name}</span>
        </a>
      ),
    },
    { key: 'size', header: 'Size', align: 'right', value: (d) => d.bytes, cell: (d) => <span className="tabular text-text-muted">{size(d.bytes)}</span> },
    { key: 'by', header: 'Uploaded by', priority: 'secondary', value: (d) => d.uploaded_by_name ?? '', cell: (d) => <span className="text-text-muted">{d.uploaded_by_name ?? '—'}</span> },
    { key: 'at', header: 'Added', value: (d) => d.created_at, cell: (d) => <span className="text-text-muted">{fmtDateTime(d.created_at)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (d) => (
        <span className="flex justify-end gap-0.5">
          <a href={url(d, true)} aria-label={`Download ${d.name}`} className="inline-flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-muted hover:text-text">
            <Download className="size-3.5" />
          </a>
          {canManage && (
            <IconButton label={`Delete ${d.name}`} size="xs" onClick={() => setRemove(d)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Documents"
      actions={
        canManage && (
          <Button size="xs" icon={<Upload className="size-3" />} loading={uploading > 0} onClick={() => input.current?.click()}>
            Upload
          </Button>
        )
      }
    >
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          columns={columns}
          rowKey={(d) => d.id}
          caption={`Documents for ${project.name}`}
          empty={
            <EmptyState
              title="No documents yet"
              description={canManage ? 'Attach briefs, contracts and specs: PDF, images, Office files, text, CSV or ZIP, up to 25 MB each.' : 'Documents added to this project appear here.'}
              action={canManage && <Button onClick={() => input.current?.click()}>Upload a document</Button>}
            />
          }
        />
      )}
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Delete ${remove?.name ?? 'document'}?`}
        description="The file is removed for everyone on the project. This cannot be undone."
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!remove) return;
          setBusy(true);
          try {
            await run('DELETE', `/projects/${project.id}/documents/${remove.id}`);
            toast.success(`${remove.name} deleted`);
            setRemove(null);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Panel>
  );
}
