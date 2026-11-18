'use client';
/**
 * One client folder: the client's projects, each in an accordion with its status, progress, tasks,
 * people, milestones and revision count; the revision history opens in a drawer. Folder managers
 * (System Admins by default) can rename or archive the folder, add projects and create new ones.
 */
import { Suspense, lazy, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Archive, ArchiveRestore, ChevronDown, ExternalLink, FolderInput, History, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react';
import type { ClientDto, ClientFolderDetailDto, FolderProjectDto, ProjectDto, TeamDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  Input,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  Select,
  SkeletonRows,
  cx,
  fmtDate,
  fmtDateTime,
  useToast,
} from '@tallywork/ui';
import { errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useMemberOptions } from '@/lib/members';
import { ColorDot, PROJECT_STATUSES, ProjectStatusBadge, useOrgAction } from '@/components/workspace/shared';
import { FolderDialog } from '@/components/workspace/client-folders';
import { LogoAvatar } from '@/components/workspace/logo-editor';

const ProjectDialog = dynamic(() => import('@/components/workspace/project-fields').then((m) => m.ProjectDialog), { ssr: false });
const ProjectRevisions = lazy(() => import('@/components/workspace/project-revisions').then((m) => ({ default: m.ProjectRevisions })));

type Sort = 'name' | 'progress' | 'updated';

export default function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const org = useOrg();
  const toast = useToast();
  const run = useOrgAction();
  const [archivedProjects, setArchivedProjects] = useState(false);
  const q = useOrgQuery<ClientFolderDetailDto>(`/client-folders/${folderId}${qs({ include_archived: archivedProjects || undefined })}`);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<FolderProjectDto | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = !!q.data?.can_manage;
  const canCreateProject = canManage && org.can('projects:manage', 'org');
  const clientsQ = useOrgQuery<ClientDto[]>(creating ? '/clients' : null);
  const workersQ = useMemberOptions(creating && org.can('members:read'));
  const teamsQ = useOrgQuery<TeamDto[]>(creating && org.can('teams:read') ? '/teams' : null);

  const projects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (q.data?.projects ?? []).filter((p) => (!status || p.status === status) && (!needle || p.name.toLowerCase().includes(needle) || p.short_name?.toLowerCase().includes(needle)));
    const by: Record<Sort, (a: FolderProjectDto, b: FolderProjectDto) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      progress: (a, b) => (b.progress_pct ?? -1) - (a.progress_pct ?? -1) || a.name.localeCompare(b.name),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    };
    return [...list].sort(by[sort]);
  }, [q.data, search, status, sort]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <Panel>
        <SkeletonRows rows={5} cols={3} />
      </Panel>
    );
  const { folder } = q.data;
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const filtered = !!search || !!status;

  const setFolderArchived = async (archived: boolean) => {
    setBusy(true);
    try {
      await run('POST', `/client-folders/${folder.id}/${archived ? 'archive' : 'restore'}`);
      toast.success(archived ? `${folder.name} archived` : `${folder.name} restored`);
      setArchiving(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={
          <span className="flex items-center gap-1">
            <Link href={`${org.base}/projects`} className="hover:text-text hover:underline">
              Projects
            </Link>
            <span aria-hidden>/</span>
            <Link href={`${org.base}/projects?view=folders`} className="hover:text-text hover:underline">
              Client folders
            </Link>
          </span>
        }
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <LogoAvatar name={folder.client_name} logo={folder.client_logo} color={folder.client_color} className="size-7 text-xs" />
            <span className="truncate">{folder.name}</span>
            {folder.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              Client: <span className="font-medium text-text">{folder.client_name}</span>
              {folder.client_archived && ' (archived)'}
            </span>
            <span aria-hidden>·</span>
            <span>
              {folder.project_count} {folder.project_count === 1 ? 'project' : 'projects'}
            </span>
            {folder.description && <span className="basis-full">{folder.description}</span>}
          </span>
        }
        actions={
          canManage && (
            <div className="flex items-center gap-2">
              {canCreateProject && !folder.archived_at && (
                <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                  New project
                </Button>
              )}
              <Menu
                trigger={
                  <IconButton label="Folder actions">
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                }
              >
                {canCreateProject && !folder.archived_at && (
                  <MenuItem icon={<FolderInput className="size-3.5" />} onSelect={() => setAdding(true)}>
                    Add existing projects
                  </MenuItem>
                )}
                <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setRenaming(true)}>
                  Rename
                </MenuItem>
                {folder.archived_at ? (
                  <MenuItem icon={<ArchiveRestore className="size-3.5" />} onSelect={() => void setFolderArchived(false)}>
                    Restore folder
                  </MenuItem>
                ) : (
                  <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchiving(true)}>
                    Archive folder
                  </MenuItem>
                )}
              </Menu>
            </div>
          )
        }
      />

      <FilterBar>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search projects</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className="pl-8" />
        </label>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44">
          <option value="name">Name (A–Z)</option>
          <option value="progress">Progress</option>
          <option value="updated">Recently updated</option>
        </Select>
        <Checkbox label="Include archived" checked={archivedProjects} onChange={(e) => setArchivedProjects(e.target.checked)} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setSearch(''), setStatus(''))}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {!projects.length ? (
        <Panel>
          <EmptyState
            title={filtered ? 'No projects match these filters' : 'No projects in this folder yet'}
            description={filtered ? undefined : canCreateProject ? `Create a project for ${folder.client_name}, or add an existing project that has no client yet.` : `There are no ${folder.client_name} projects you can see.`}
            action={
              !filtered &&
              canCreateProject &&
              !folder.archived_at && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New project
                  </Button>
                  <Button onClick={() => setAdding(true)}>Add existing projects</Button>
                </div>
              )
            }
          />
        </Panel>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Projects in this folder">
          {projects.map((p) => (
            <ProjectAccordion key={p.id} project={p} expanded={open.has(p.id)} onToggle={() => toggle(p.id)} onHistory={() => setHistory(p)} />
          ))}
        </ul>
      )}

      <Drawer open={!!history} onOpenChange={(o) => !o && setHistory(null)} title="Revision history" subtitle={history?.name} width={560}>
        {history && (
          <div className="p-4">
            <Suspense fallback={<SkeletonRows rows={4} cols={2} />}>
              <ProjectRevisions projectId={history.id} currency={org.organization.currency} />
            </Suspense>
          </div>
        )}
      </Drawer>
      {renaming && <FolderDialog folder={folder} onClose={() => setRenaming(false)} />}
      {adding && <AddProjectsDialog folderId={folder.id} clientName={folder.client_name} onClose={() => setAdding(false)} />}
      {creating && (
        <ProjectDialog
          open
          onOpenChange={(o) => !o && setCreating(false)}
          project={null}
          defaultClientId={folder.client_id}
          clients={clientsQ.data}
          workers={workersQ.data}
          teams={teamsQ.data}
          onSaved={() => setCreating(false)}
        />
      )}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${folder.name}?`}
        description={`The folder is hidden from Client folders. ${folder.client_name} and its projects are not archived: time tracking, invoices and reports carry on as before. You can restore the folder later.`}
        confirmLabel="Archive folder"
        danger
        loading={busy}
        onConfirm={() => void setFolderArchived(true)}
      />
    </>
  );
}

function ProjectAccordion({ project: p, expanded, onToggle, onHistory }: { project: FolderProjectDto; expanded: boolean; onToggle: () => void; onHistory: () => void }) {
  const org = useOrg();
  const panelId = `folder-project-${p.id}`;
  return (
    <li className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-interactive"
        >
          <ColorDot color={p.color} />
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{p.name}</span>
              {p.short_name && <span className="shrink-0 font-mono text-2xs text-text-faint">{p.short_name}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2 sm:ml-auto">
              <ProjectStatusBadge project={p} />
              <Progress pct={p.progress_pct} />
            </span>
          </span>
          <ChevronDown aria-hidden className={cx('size-4 shrink-0 text-text-faint transition-transform', expanded && 'rotate-180')} />
        </button>
      </h3>
      {expanded && (
        <div id={panelId} role="region" aria-label={`${p.name} details`} className="border-t border-border px-4 py-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Status">
              <ProjectStatusBadge project={p} />
            </Detail>
            <Detail label="Progress">{p.progress_pct === null ? 'No tasks yet' : `${p.progress_pct}% of tasks done`}</Detail>
            <Detail label="Tasks">
              {p.task_count} total · {p.tasks_done} done · {p.tasks_pending} pending
            </Detail>
            <Detail label="Team members">
              {p.members.length ? p.members.map((m) => m.name).join(', ') : 'No direct members'}
              {p.team_count > 0 && <span className="text-text-muted"> + {p.team_count} {p.team_count === 1 ? 'team' : 'teams'}</span>}
            </Detail>
            <Detail label="Milestones">
              {p.milestone_count ? (
                <>
                  {p.milestones_done} of {p.milestone_count} done
                  {p.next_milestone && (
                    <span className="block text-text-muted">
                      Next: {p.next_milestone.title} · {fmtDate(p.next_milestone.due_date)}
                    </span>
                  )}
                </>
              ) : (
                'No milestones'
              )}
            </Detail>
            <Detail label="Dates">{p.start_date || p.end_date ? `${p.start_date ? fmtDate(p.start_date) : '…'} – ${p.end_date ? fmtDate(p.end_date) : '…'}` : 'Not set'}</Detail>
            <Detail label="Last updated">
              <time dateTime={p.updated_at}>{fmtDateTime(p.updated_at, org.organization.timezone)}</time>
            </Detail>
            {p.revision_count !== null && <Detail label="Revisions">{p.revision_count}</Detail>}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`${org.base}/projects/${p.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-muted">
              <ExternalLink aria-hidden className="size-3.5" />
              Open project
            </Link>
            {p.revision_count !== null && (
              <Button size="sm" icon={<History className="size-3.5" />} onClick={onHistory}>
                Revision history
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Progress({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="w-24 text-right text-xs text-text-faint">No tasks</span>;
  return (
    <span className="flex w-24 items-center gap-2" title={`${pct}% of tasks done`}>
      <span role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Task progress" className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <span className="block h-full rounded-full bg-interactive" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular w-8 text-right text-xs text-text-muted">{pct}%</span>
    </span>
  );
}

/** Pick projects without a client to put in the folder (they take the folder's client). */
function AddProjectsDialog({ folderId, clientName, onClose }: { folderId: string; clientName: string; onClose: () => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const q = useOrgQuery<ProjectDto[]>('/projects');
  const candidates = (q.data ?? []).filter((p) => !p.client_id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await run('POST', `/client-folders/${folderId}/projects`, { project_ids: [...picked] });
      toast.success(`${picked.size} ${picked.size === 1 ? 'project' : 'projects'} added`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add existing projects"
      description={`Projects without a client become ${clientName}’s. A project that belongs to another client stays with it: change its client in the project’s settings if the work really moved.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!picked.size} onClick={() => void save()}>
            Add {picked.size || ''} {picked.size === 1 ? 'project' : 'projects'}
          </Button>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonRows rows={3} cols={1} />
      ) : !candidates.length ? (
        <p className="text-sm text-text-muted">Every project already has a client. Create a new project in this folder instead.</p>
      ) : (
        <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          <legend className="sr-only">Projects without a client</legend>
          {candidates.map((p) => (
            <Checkbox
              key={p.id}
              label={p.name}
              checked={picked.has(p.id)}
              onChange={(e) => setPicked((s) => {
                const n = new Set(s);
                if (e.target.checked) n.add(p.id);
                else n.delete(p.id);
                return n;
              })}
            />
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
