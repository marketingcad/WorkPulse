'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BudgetStatusDto, ClientDto, ProjectDto, TaskDto, TeamDto, WorkerDto } from '@tallywork/contracts';
import {
  Avatar,
  Badge,
  BudgetProgress,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  KpiStrip,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PersonCell,
  SegmentedControl,
  SkeletonRows,
  Tabs,
  cx,
  fmtDate,
  fmtMoney,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { MultiSelect } from '@/components/workspace/multi-select';
import { ColorDot, PriorityBadge, ProjectFields, ProjectStatusBadge, TaskDialog, TaskStatusSelect, projectPayload, projectToForm, useOrgAction, type ProjectForm } from '@/components/workspace/shared';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const org = useOrg();
  const [tab, setTab] = useState('tasks');
  const projectQ = useOrgQuery<ProjectDto>(`/projects/${id}`);
  const tasksQ = useOrgQuery<TaskDto[]>(org.can('tasks:read') ? `/projects/${id}/tasks` : null);
  const budgetsQ = useOrgQuery<BudgetStatusDto[]>(org.can('budgets:read') ? '/budgets' : null);
  const workersQ = useOrgQuery<WorkerDto[]>(org.can('members:read') ? '/workers' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const p = projectQ.data;
  const budget = budgetsQ.data?.find((b) => b.subject_type === 'PROJECT' && b.subject_id === id);
  const canManage = org.can('projects:manage');

  if (projectQ.error) return <ErrorState error={projectQ.error} onRetry={() => projectQ.refetch()} />;
  if (!p)
    return (
      <Panel>
        <SkeletonRows rows={5} cols={4} />
      </Panel>
    );

  const openTasks = (tasksQ.data ?? []).filter((t) => t.status !== 'DONE').length;
  const items = [
    ...(org.can('tasks:read') ? [{ value: 'tasks', label: 'Tasks', count: tasksQ.data?.length }] : []),
    { value: 'members', label: 'Members & teams', count: p.member_ids.length + p.team_ids.length },
    ...(canManage ? [{ value: 'settings', label: 'Settings' }] : []),
  ];
  const activeTab = items.some((i) => i.value === tab) ? tab : items[0]!.value;

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/projects`} className="hover:text-text hover:underline">
            Projects
          </Link>
        }
        title={
          <span className="flex items-center gap-2.5">
            <ColorDot color={p.color} className="size-3.5" />
            <span className="truncate">{p.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.client_name ? (
              org.can('clients:read') ? (
                <Link href={`${org.base}/clients`} className="hover:underline">
                  {p.client_name}
                </Link>
              ) : (
                <span>{p.client_name}</span>
              )
            ) : (
              <span>No client</span>
            )}
            <ProjectStatusBadge project={p} />
            {p.billable_default ? <Badge tone="success">Billable</Badge> : <Badge>Non-billable</Badge>}
          </span>
        }
      />
      {p.description && <p className="-mt-2 mb-4 max-w-3xl text-sm text-text-muted">{p.description}</p>}

      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Tracked (all time)', value: org.fmtDuration(p.tracked_seconds ?? 0) },
          ...(budget
            ? [
                {
                  label: 'Budget used',
                  value: `${Math.round(budget.pct_used)}%`,
                  hint: (
                    <span className="mt-1 block">
                      <BudgetProgress pct={budget.pct_used} state={budget.state} projectedPct={budget.projected ? (budget.projected / budget.amount) * 100 : null} />
                      <span className="mt-1 block tabular">
                        {budget.kind === 'HOURS' ? `${org.fmtDuration(budget.spent)} of ${org.fmtDuration(budget.amount)}` : `${fmtMoney(budget.spent, budget.currency)} of ${fmtMoney(budget.amount, budget.currency)}`}
                      </span>
                    </span>
                  ),
                },
              ]
            : org.can('budgets:read')
              ? [{ label: 'Budget', value: '—', hint: org.can('budgets:manage') ? <Link href={`${org.base}/finance/budgets`} className="text-interactive hover:underline">Set a budget</Link> : 'No budget' }]
              : []),
          ...(tasksQ.data ? [{ label: 'Open tasks', value: openTasks, hint: `${tasksQ.data.length - openTasks} done` }] : []),
          { label: 'People', value: p.member_ids.length, hint: p.team_ids.length ? `+ ${p.team_ids.length} ${p.team_ids.length === 1 ? 'team' : 'teams'}` : 'direct members' },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setTab} items={items} className="mb-4" />
      {activeTab === 'tasks' && <TasksTab project={p} tasks={tasksQ.data} loading={tasksQ.isLoading} error={tasksQ.error} workers={workersQ.data} />}
      {activeTab === 'members' && <MembersTab project={p} workers={workersQ.data} teams={teamsQ.data} canManage={canManage} />}
      {activeTab === 'settings' && canManage && <SettingsTab project={p} />}
    </>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
function TasksTab({ project, tasks, loading, error, workers }: { project: ProjectDto; tasks?: TaskDto[]; loading: boolean; error: unknown; workers?: WorkerDto[] }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const canManage = org.can('tasks:manage');
  const canCreate = canManage || org.can('tasks:create');
  const [view, setView] = useState<'open' | 'all' | 'DONE'>('open');
  const [edit, setEdit] = useState<TaskDto | 'new' | null>(null);
  const [del, setDel] = useState<TaskDto | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => new Map((workers ?? []).map((w) => [w.id, w.name])), [workers]);
  const today = todayIn(org.membership.timezone);
  const rows = (tasks ?? []).filter((t) => (view === 'all' ? true : view === 'open' ? t.status !== 'DONE' : t.status === 'DONE'));

  const columns: Column<TaskDto>[] = [
    { key: 'title', header: 'Task', priority: 'primary', value: (t) => t.title, cell: (t) => <span className={cx('block max-w-96 truncate font-medium', t.status === 'DONE' && 'text-text-muted line-through')}>{t.title}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', value: (t) => t.status, cell: (t) => <TaskStatusSelect task={t} canManage={canManage} /> },
    { key: 'priority', header: 'Priority', value: (t) => ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].indexOf(t.priority), cell: (t) => <PriorityBadge priority={t.priority} /> },
    {
      key: 'assignees',
      header: 'Assignees',
      priority: 'secondary',
      value: (t) => t.assignee_ids.map((a) => names.get(a) ?? '').join(', '),
      cell: (t) =>
        t.assignee_ids.length === 0 ? (
          <span className="text-xs text-text-faint">Unassigned</span>
        ) : (
          <span className="flex items-center -space-x-1.5" title={t.assignee_ids.map((a) => names.get(a) ?? 'Member').join(', ')}>
            {t.assignee_ids.slice(0, 4).map((a) => (
              <Avatar key={a} name={names.get(a) ?? '?'} size={22} className="ring-2 ring-surface" />
            ))}
            {t.assignee_ids.length > 4 && <span className="pl-2.5 text-xs text-text-muted">+{t.assignee_ids.length - 4}</span>}
            <span className="sr-only">{t.assignee_ids.map((a) => names.get(a) ?? 'Member').join(', ')}</span>
          </span>
        ),
    },
    {
      key: 'due',
      header: 'Due',
      value: (t) => t.due_date ?? '9999',
      cell: (t) => (t.due_date ? <span className={cx('tabular', t.status !== 'DONE' && t.due_date < today ? 'font-medium text-danger' : 'text-text-muted')}>{fmtDate(t.due_date, { month: 'short', day: 'numeric' })}{t.status !== 'DONE' && t.due_date < today && ' · overdue'}</span> : <span className="text-text-faint">—</span>),
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
                  <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setDel(t)}>
                    Delete
                  </MenuItem>
                </Menu>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel
      title="Tasks"
      actions={
        <>
          <SegmentedControl size="xs" label="Show tasks" value={view} onChange={setView} options={[{ value: 'open', label: 'Open' }, { value: 'DONE', label: 'Done' }, { value: 'all', label: 'All' }]} />
          {canCreate && !project.archived_at && (
            <Button size="xs" variant="primary" icon={<Plus className="size-3" />} onClick={() => setEdit('new')}>
              New task
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <ErrorState error={error} />
      ) : (
        <DataTable
          rows={rows}
          loading={loading}
          columns={columns}
          rowKey={(t) => t.id}
          onRowClick={canManage ? (t) => setEdit(t) : undefined}
          searchable
          searchPlaceholder="Search tasks…"
          caption="Project tasks"
          empty={
            <EmptyState
              title={view === 'DONE' ? 'Nothing done yet' : tasks?.length ? 'No open tasks' : 'No tasks yet'}
              description={canCreate ? 'Break the work into tasks so time can be tracked against each one.' : undefined}
              action={canCreate && !project.archived_at && <Button onClick={() => setEdit('new')}>New task</Button>}
            />
          }
        />
      )}
      <TaskDialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} task={edit === 'new' ? null : edit} projectId={project.id} projects={[project]} workers={workers} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete task?"
        description={del && `“${del.title}” is removed from lists and timers. Time already tracked to it is kept.`}
        confirmLabel="Delete task"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          try {
            await run('DELETE', `/tasks/${del.id}`);
            toast.success('Task deleted');
            setDel(null);
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

// ─── Members & teams ─────────────────────────────────────────────────────────
function MembersTab({ project, workers, teams, canManage }: { project: ProjectDto; workers?: WorkerDto[]; teams?: TeamDto[]; canManage: boolean }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [memberIds, setMemberIds] = useState(project.member_ids);
  const [teamIds, setTeamIds] = useState(project.team_ids);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMemberIds(project.member_ids);
    setTeamIds(project.team_ids);
  }, [project]);

  const workerName = (wid: string) => workers?.find((w) => w.id === wid);
  const projectTeams = project.team_ids.map((t) => teams?.find((x) => x.id === t)).filter(Boolean) as TeamDto[];

  const save = async () => {
    setBusy(true);
    try {
      await run('PATCH', `/projects/${project.id}`, { member_ids: memberIds, ...(teams ? { team_ids: teamIds } : {}) });
      toast.success('Project access updated');
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing)
    return (
      <Panel title="Edit access">
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <Field label="Direct members" htmlFor="pm-members" hint="These members can track time to this project.">
            <MultiSelect id="pm-members" options={(workers ?? []).filter((w) => w.status === 'ACTIVE' || memberIds.includes(w.id)).map((w) => ({ value: w.id, label: w.name, sub: w.email }))} value={memberIds} onChange={setMemberIds} placeholder="No direct members" />
          </Field>
          {teams && (
            <Field label="Teams" htmlFor="pm-teams" hint="Everyone in these teams can track time here.">
              <MultiSelect id="pm-teams" options={teams.map((t) => ({ value: t.id, label: t.name, sub: `${t.members.length} members` }))} value={teamIds} onChange={setTeamIds} placeholder="No teams" />
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={() => (setEditing(false), setMemberIds(project.member_ids), setTeamIds(project.team_ids))}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save access
          </Button>
        </div>
      </Panel>
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel
        title={`Direct members (${project.member_ids.length})`}
        actions={
          canManage &&
          workers && (
            <Button size="xs" icon={<Pencil className="size-3" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        {project.member_ids.length === 0 ? (
          <EmptyState title="No direct members" description={canManage ? 'Add members, or assign a team, so people can track time here.' : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {project.member_ids.map((mid) => {
              const w = workerName(mid);
              return (
                <li key={mid} className="px-4 py-2">
                  {w ? (
                    <Link href={`${org.base}/workers/${mid}`} className="block hover:underline">
                      <PersonCell name={w.name} sub={w.title ?? w.email} />
                    </Link>
                  ) : (
                    <PersonCell name={mid === org.membership.id ? 'You' : 'Member'} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel
        title={`Teams (${project.team_ids.length})`}
        actions={
          canManage &&
          workers && (
            <Button size="xs" icon={<Pencil className="size-3" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        {project.team_ids.length === 0 ? (
          <EmptyState title="No teams" description="Assign a team to give all of its members access at once." />
        ) : (
          <ul className="divide-y divide-border">
            {(projectTeams.length ? projectTeams : []).map((t) => (
              <li key={t.id} className="px-4 py-2.5 text-sm">
                <div className="font-medium">{t.name}</div>
                <div className="truncate text-xs text-text-muted">{t.members.map((m) => m.name).join(', ') || 'No members'}</div>
              </li>
            ))}
            {projectTeams.length < project.team_ids.length && <li className="px-4 py-2.5 text-xs text-text-muted">{project.team_ids.length - projectTeams.length} team(s) you cannot see</li>}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function SettingsTab({ project }: { project: ProjectDto }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);
  const [f, setF] = useState<ProjectForm>(projectToForm(project));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setF(projectToForm(project)), [project]);

  const clients = useMemo(() => {
    const list = clientsQ.data ?? [];
    // Keep the current client selectable even if it is archived.
    return project.client_id && !list.some((c) => c.id === project.client_id) ? [...list, { id: project.client_id, name: project.client_name ?? 'Current client' } as ClientDto] : list;
  }, [clientsQ.data, project]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run('PATCH', `/projects/${project.id}`, projectPayload(f));
      toast.success('Project saved');
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setArchived = async (archived: boolean) => {
    setBusy(true);
    try {
      await run('POST', `/projects/${project.id}/${archived ? 'archive' : 'restore'}`);
      toast.success(archived ? 'Project archived' : 'Project restored');
      setConfirm(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="Details">
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ProjectFields f={f} setF={setF} err={err} clients={clients} showAssignments={false} />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setF(projectToForm(project))}>Reset</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!f.name.trim()}>
              Save changes
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title={project.archived_at ? 'Archived' : 'Archive'}>
        <div className="flex flex-col gap-3 p-4 text-sm text-text-muted">
          {project.archived_at ? (
            <>
              <p>This project was archived on {fmtDate(project.archived_at)}. Nobody can track new time to it.</p>
              <Button icon={<ArchiveRestore className="size-3.5" />} loading={busy} onClick={() => setArchived(false)} className="self-start">
                Restore project
              </Button>
            </>
          ) : (
            <>
              <p>Archiving hides the project from timers and pickers. Tracked time, budgets and invoices are kept.</p>
              <Button variant="danger" icon={<Archive className="size-3.5" />} onClick={() => setConfirm(true)} className="self-start">
                Archive project
              </Button>
            </>
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Archive ${project.name}?`}
        description="Nobody can track new time to it. You can restore it later."
        confirmLabel="Archive"
        danger
        loading={busy}
        onConfirm={() => setArchived(true)}
      />
    </div>
  );
}
