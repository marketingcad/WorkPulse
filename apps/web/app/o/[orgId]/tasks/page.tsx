'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { OffsetPage, ProjectDto, TaskDto } from '@tallywork/contracts';
import {
  Avatar,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  Input,
  IconButton,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  Switch,
  cx,
  fmtDate,
  useToast,
  type Column,
} from '@tallywork/ui';
import { errorMessage, qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { ColorDot, PriorityBadge, TASK_STATUSES, TaskDialog, TaskStatusSelect, useOrgAction } from '@/components/workspace/shared';
import { useMemberOptions } from '@/lib/members';

export default function TasksPage() {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const canManage = org.can('tasks:manage');
  const canCreate = canManage || org.can('tasks:create');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(!org.isManagerView);
  const [edit, setEdit] = useState<TaskDto | 'new' | null>(null);
  const [del, setDel] = useState<TaskDto | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useSearch();
  // The server filters, searches and pages every task (the plain list stops at 2000).
  const filters = { project_id: projectId || undefined, status: status || undefined, mine: mine || undefined, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<TaskDto> & { summary: { counts: Record<string, number> } }>(org.can('tasks:read') ? `/tasks${qs({ ...filters, ...paging.params })}` : null, { placeholderData: (p) => p });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const projectsQ = useOrgQuery<ProjectDto[]>(org.can('projects:read') ? '/projects' : null);
  const workersQ = useMemberOptions(org.can('members:read'));
  const names = useMemo(() => new Map((workersQ.data ?? []).map((w) => [w.id, w.name])), [workersQ.data]);
  const colors = useMemo(() => new Map((projectsQ.data ?? []).map((p) => [p.id, p.color])), [projectsQ.data]);
  const today = todayIn(org.membership.timezone);

  if (!org.can('tasks:read')) return <PermissionState />;

  const nameOf = (id: string) => (id === org.membership.id ? 'You' : (names.get(id) ?? 'Member'));
  const columns: Column<TaskDto>[] = [
    { key: 'title', header: 'Task', priority: 'primary', value: (t) => t.title, cell: (t) => <span className={cx('block max-w-96 truncate font-medium', t.status === 'DONE' && 'text-text-muted line-through')}>{t.title}</span> },
    {
      key: 'project',
      header: 'Project',
      priority: 'secondary',
      value: (t) => t.project_name ?? '',
      cell: (t) => (
        <Link href={`${org.base}/projects/${t.project_id}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-1.5 text-text-muted hover:text-text hover:underline">
          <ColorDot color={colors.get(t.project_id) ?? 'var(--color-text-faint)'} />
          <span className="truncate">{t.project_name}</span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', priority: 'secondary', value: (t) => t.status, cell: (t) => <TaskStatusSelect task={t} canManage={canManage} /> },
    { key: 'priority', header: 'Priority', value: (t) => ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].indexOf(t.priority), cell: (t) => <PriorityBadge priority={t.priority} /> },
    {
      key: 'assignees',
      header: 'Assignees',
      value: (t) => t.assignee_ids.map(nameOf).join(', '),
      cell: (t) =>
        t.assignee_ids.length === 0 ? (
          <span className="text-xs text-text-faint">Unassigned</span>
        ) : t.assignee_ids.length === 1 ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={nameOf(t.assignee_ids[0]!)} size={20} />
            <span className="truncate text-sm">{nameOf(t.assignee_ids[0]!)}</span>
          </span>
        ) : (
          <span className="flex items-center -space-x-1.5" title={t.assignee_ids.map(nameOf).join(', ')}>
            {t.assignee_ids.slice(0, 4).map((a) => (
              <Avatar key={a} name={nameOf(a)} size={20} className="ring-2 ring-surface" />
            ))}
            <span className="sr-only">{t.assignee_ids.map(nameOf).join(', ')}</span>
          </span>
        ),
    },
    {
      key: 'due',
      header: 'Due',
      value: (t) => t.due_date ?? '9999',
      cell: (t) => {
        if (!t.due_date) return <span className="text-text-faint">—</span>;
        const overdue = t.status !== 'DONE' && t.due_date < today;
        return (
          <span className={cx('tabular', overdue ? 'font-medium text-danger' : 'text-text-muted')}>
            {fmtDate(t.due_date, { month: 'short', day: 'numeric' })}
            {overdue && ' · overdue'}
          </span>
        );
      },
    },
    {
      key: 'time',
      header: 'Tracked / est.',
      align: 'right',
      value: (t) => t.tracked_seconds ?? 0,
      cell: (t) => (
        <span className={cx(t.estimate_seconds && (t.tracked_seconds ?? 0) > t.estimate_seconds && 'text-danger')}>
          {org.fmtDuration(t.tracked_seconds ?? 0)}
          {t.estimate_seconds ? <span className="text-text-faint"> / {org.fmtDuration(t.estimate_seconds)}</span> : null}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (t: TaskDto) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Menu
                  trigger={
                    <IconButton label={`Actions for ${t.title}`} size="xs">
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(t)}>
                    Edit
                  </MenuItem>
                  <MenuItem icon={<Archive className="size-3.5" />} onSelect={() => setDel(t)}>
                    Archive
                  </MenuItem>
                </Menu>
              </span>
            ),
          },
        ]
      : []),
  ];

  const filtered = !!projectId || !!status;

  return (
    <>
      <PageHeader
        title="Tasks"
        description={mine ? 'Tasks assigned to you across all projects.' : 'Every task across the projects you can see.'}
        actions={
          canCreate && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
              New task
            </Button>
          )
        }
      />
      <FilterBar>
        {projectsQ.data && (
          <Select aria-label="Filter by project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-52">
            <option value="">All projects</option>
            {projectsQ.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">Any status</option>
          {TASK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="rounded-sm border border-border bg-surface px-3 py-1">
          <Switch checked={mine} onCheckedChange={setMine} label="Assigned to me" />
        <Input aria-label="Search tasks" placeholder="Search tasks…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-56" />
        </div>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setProjectId(''), setStatus(''))}>
            Clear filters
          </Button>
        )}
      </FilterBar>
      <Panel>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            loading={q.isLoading}
            columns={columns.map((c) => ({ ...c, sortable: false }))}
            rowKey={(t) => t.id}
            onRowClick={canManage ? (t) => setEdit(t) : undefined}
            pagination={paging.pagination(q.data)}
            caption="Tasks"
            empty={
              <EmptyState
                title={search.term ? 'No tasks match your search' : mine ? 'Nothing assigned to you' : filtered ? 'No tasks match these filters' : 'No tasks yet'}
                description={mine ? 'Turn off “Assigned to me” to see every task you can access.' : canCreate ? 'Create a task and assign it so it shows up in everyone’s timer.' : undefined}
                action={canCreate && !mine && <Button onClick={() => setEdit('new')}>New task</Button>}
              />
            }
          />
        )}
      </Panel>

      <TaskDialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} task={edit === 'new' ? null : edit} projectId={edit === 'new' ? projectId || undefined : undefined} projects={projectsQ.data} workers={workersQ.data} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Archive task?"
        description={del && `“${del.title}” is removed from lists and timers. Time already tracked to it is kept.`}
        confirmLabel="Archive task"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          try {
            await run('DELETE', `/tasks/${del.id}`);
            toast.success('Task archived');
            setDel(null);
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
