'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BudgetStatusDto, ClientDto, ProjectDto, TaskDto, TeamDto, MemberOptionDto } from '@tallywork/contracts';
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
  Stat,
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
import { ColorDot, PriorityBadge, ProjectFields, ProjectStatusBadge, TaskDialog, TaskStatusSelect, clientsForProject, projectPayload, projectToForm, useHoursPerDay, useOrgAction, type ProjectForm } from '@/components/workspace/shared';
import { BudgetDialog } from '@/components/finance/budget-dialog';
import { ProjectDocumentsTab } from '@/components/workspace/project-documents';
import { useMemberOptions } from '@/lib/members';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const org = useOrg();
  const [tab, setTab] = useState('tasks');
  const projectQ = useOrgQuery<ProjectDto>(`/projects/${id}`);
  const tasksQ = useOrgQuery<TaskDto[]>(org.can('tasks:read') ? `/projects/${id}/tasks` : null);
  const budgetsQ = useOrgQuery<BudgetStatusDto[]>(org.can('budgets:read') ? '/budgets' : null);
  const workersQ = useMemberOptions(org.can('members:read'));
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const p = projectQ.data;
  const budget = budgetsQ.data?.find((b) => b.subject_type === 'PROJECT' && b.subject_id === id);
  const canManage = org.can('projects:manage');
  const hoursPerDay = useHoursPerDay();
  const [budgetOpen, setBudgetOpen] = useState(false);

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
    { value: 'plan', label: 'Plan & budget' },
    { value: 'members', label: 'Members & teams', count: p.member_ids.length + p.team_ids.length },
    { value: 'documents', label: 'Documents' },
    ...(canManage ? [{ value: 'settings', label: 'Settings' }] : []),
  ];
  const tracked = p.tracked_seconds ?? 0;
  const estimate = p.estimate_seconds;
  const estimateText = (s: number) => (p.estimate_unit === 'DAYS' ? `${Math.round((s / (hoursPerDay * 3600)) * 10) / 10} d` : org.fmtDuration(s));
  const dates = p.start_date || p.end_date ? `${p.start_date ? fmtDate(p.start_date) : '…'} – ${p.end_date ? fmtDate(p.end_date) : '…'}` : null;
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
            {p.short_name && <Badge className="font-mono">{p.short_name}</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.client_name ? (
              org.can('clients:read') ? (
                <Link href={`${org.base}/projects?client=${p.client_id}`} className="hover:underline" title="This client’s projects">
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
            {dates && <span className="tabular">{dates}</span>}
          </span>
        }
      />
      {p.description && <p className="-mt-2 mb-4 max-w-3xl text-sm text-text-muted">{p.description}</p>}

      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Time logged', value: org.fmtDuration(tracked), hint: 'All time' },
          { label: 'Time billable', value: org.fmtDuration(p.billable_seconds ?? 0), hint: tracked ? `${Math.round(((p.billable_seconds ?? 0) / tracked) * 100)}% of logged` : undefined },
          {
            label: 'Estimated time',
            value: estimate ? estimateText(estimate) : 'N/A',
            hint: estimate ? (
              <span className={cx(tracked > estimate && 'text-danger')}>
                {tracked > estimate ? `${estimateText(tracked - estimate)} over` : `${estimateText(estimate - tracked)} left · ${Math.round((tracked / estimate) * 100)}% used`}
              </span>
            ) : canManage ? (
              <button className="text-interactive hover:underline" onClick={() => setTab('settings')}>
                Add an estimate
              </button>
            ) : undefined,
          },
          ...(budget
            ? [
                {
                  label: 'Budget used',
                  value: `${Math.round(budget.pct_used)}%`,
                  hint: (
                    <span className="mt-1 block">
                      <BudgetProgress pct={budget.pct_used} state={budget.state} projectedPct={budget.projected ? (budget.projected / budget.amount) * 100 : null} />
                      <span className="mt-1 block tabular">
                        {budget.kind === 'HOURS' ? `${org.fmtDuration(budget.spent)} of ${org.fmtDuration(budget.amount)}` : budget.amounts_hidden ? `${Math.round(budget.pct_used)}% of the money budget` : `${fmtMoney(budget.spent, budget.currency)} billed of ${fmtMoney(budget.amount, budget.currency)}`}
                      </span>
                    </span>
                  ),
                },
              ]
            : org.can('budgets:read')
              ? [
                  {
                    label: 'Budget',
                    value: '—',
                    hint: org.can('budgets:manage') ? (
                      <button className="text-interactive hover:underline" onClick={() => setBudgetOpen(true)}>
                        Set a budget
                      </button>
                    ) : (
                      'No budget'
                    ),
                  },
                ]
              : []),
          ...(tasksQ.data ? [{ label: 'Open tasks', value: openTasks, hint: `${tasksQ.data.length - openTasks} done` }] : []),
          { label: 'People', value: p.member_ids.length, hint: p.team_ids.length ? `+ ${p.team_ids.length} ${p.team_ids.length === 1 ? 'team' : 'teams'}` : 'direct members' },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setTab} items={items} className="mb-4" />
      {activeTab === 'tasks' && <TasksTab project={p} tasks={tasksQ.data} loading={tasksQ.isLoading} error={tasksQ.error} onRetry={() => void tasksQ.refetch()} workers={workersQ.data} />}
      {activeTab === 'plan' && <PlanTab project={p} budget={budget} onEditBudget={() => setBudgetOpen(true)} onEditPlan={() => setTab('settings')} />}
      {activeTab === 'members' && <MembersTab project={p} workers={workersQ.data} teams={teamsQ.data} canManage={canManage} />}
      {activeTab === 'documents' && <ProjectDocumentsTab project={p} />}
      {activeTab === 'settings' && canManage && <SettingsTab project={p} />}
      {budgetOpen && <BudgetDialog value={budget ?? 'new'} preset={{ type: 'PROJECT', id: p.id, name: p.name }} onClose={() => setBudgetOpen(false)} />}
    </>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
function TasksTab({ project, tasks, loading, error, onRetry, workers }: { project: ProjectDto; tasks?: TaskDto[]; loading: boolean; error: unknown; onRetry: () => void; workers?: MemberOptionDto[] }) {
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
        <ErrorState error={error} onRetry={onRetry} />
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
    </Panel>
  );
}

// ─── Members & teams ─────────────────────────────────────────────────────────
function MembersTab({ project, workers, teams, canManage }: { project: ProjectDto; workers?: MemberOptionDto[]; teams?: TeamDto[]; canManage: boolean }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [memberIds, setMemberIds] = useState(project.member_ids);
  const [teamIds, setTeamIds] = useState(project.team_ids);
  const [busy, setBusy] = useState(false);
  // Follow the saved members only while not editing: a background refresh must not undo the picks.
  useEffect(() => {
    if (editing) return;
    setMemberIds(project.member_ids);
    setTeamIds(project.team_ids);
  }, [project, editing]);

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
              <MultiSelect id="pm-teams" options={teams.map((t) => ({ value: t.id, label: t.name, sub: `${t.members.length} ${t.members.length === 1 ? 'member' : 'members'}` }))} value={teamIds} onChange={setTeamIds} placeholder="No teams" />
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

// ─── Plan & budget ───────────────────────────────────────────────────────────
function PlanTab({ project: p, budget, onEditBudget, onEditPlan }: { project: ProjectDto; budget?: BudgetStatusDto; onEditBudget: () => void; onEditPlan: () => void }) {
  const org = useOrg();
  const hoursPerDay = useHoursPerDay();
  const tracked = p.tracked_seconds ?? 0;
  const est = p.estimate_seconds;
  const pct = est ? Math.round((tracked / est) * 100) : null;
  const inDays = (s: number) => `${Math.round((s / (hoursPerDay * 3600)) * 10) / 10} days`;
  const show = (s: number) => (p.estimate_unit === 'DAYS' ? `${inDays(s)} (${org.fmtDuration(s)})` : org.fmtDuration(s));
  const today = todayIn(org.organization.timezone);
  const daysLeft = p.end_date ? Math.round((Date.parse(p.end_date) - Date.parse(today)) / 86400000) : null;
  const money = (m: number | null | undefined) => (m == null ? 'Not set' : `${fmtMoney(m, p.currency)} / h`);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel
        title="Plan"
        actions={
          org.can('projects:manage') && (
            <Button size="xs" icon={<Pencil className="size-3" />} onClick={onEditPlan}>
              Edit
            </Button>
          )
        }
      >
        <dl className="grid grid-cols-2 gap-4 p-4">
          <Stat label="Start date" value={p.start_date ? fmtDate(p.start_date) : 'Not set'} />
          <Stat label="End date" value={p.end_date ? fmtDate(p.end_date) : 'Not set'} hint={daysLeft === null ? undefined : daysLeft < 0 ? <span className="text-danger">Ended {-daysLeft} days ago</span> : `${daysLeft} days left`} />
          <Stat label="Estimate" value={est ? show(est) : 'Not set'} />
          <Stat label="Logged" value={show(tracked)} hint={pct === null ? undefined : <span className={cx(pct > 100 && 'text-danger')}>{pct}% of the estimate</span>} />
        </dl>
        {est ? (
          <div className="px-4 pb-4">
            <BudgetProgress pct={pct ?? 0} state={pct! > 100 ? 'exceeded' : pct! >= 80 ? 'warning' : 'healthy'} />
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Budget"
        actions={
          org.can('budgets:manage') && (
            <Button size="xs" icon={budget ? <Pencil className="size-3" /> : <Plus className="size-3" />} onClick={onEditBudget}>
              {budget ? 'Edit' : 'Set budget'}
            </Button>
          )
        }
      >
        {budget ? (
          <div className="flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="tabular text-2xl font-semibold">{Math.round(budget.pct_used)}%</span>
              <span className="tabular text-sm text-text-muted">
                {budget.kind === 'HOURS' ? `${org.fmtDuration(budget.spent)} of ${org.fmtDuration(budget.amount)}` : budget.amounts_hidden ? `${Math.round(budget.pct_used)}% of the money budget` : `${fmtMoney(budget.spent, budget.currency)} billed of ${fmtMoney(budget.amount, budget.currency)}`}
              </span>
            </div>
            <BudgetProgress pct={budget.pct_used} state={budget.state} projectedPct={budget.projected ? (budget.projected / budget.amount) * 100 : null} />
            <p className="text-xs text-text-muted">{budget.period === 'MONTHLY' ? 'Resets every month.' : 'Lifetime budget.'}</p>
          </div>
        ) : (
          <EmptyState title="No budget" description="Set an hours or money budget to get warnings before the project runs over." />
        )}
      </Panel>

      {p.pay_rate_minor !== undefined && (
        <Panel title="Rates" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <Stat label="Currency" value={p.currency} hint={p.client_name ? `From ${p.client_name}` : 'Workspace default'} />
            <Stat label="Pay rate" value={money(p.pay_rate_minor)} hint="What you pay for time on this project" />
            <Stat label="Bill rate" value={money(p.bill_rate_minor)} hint={p.billable_default ? 'What you charge' : 'This project is not billable by default'} />
          </dl>
        </Panel>
      )}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function SettingsTab({ project }: { project: ProjectDto }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);
  const hoursPerDay = useHoursPerDay();
  const [f, setF] = useState<ProjectForm>(projectToForm(project, hoursPerDay));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // The form follows the saved project only while it has no unsaved changes (or right after a save):
  // a background refresh (window focus, someone's timer updating the totals) must not wipe edits.
  const loaded = useRef(projectToForm(project, hoursPerDay));
  const justSaved = useRef(false);
  useEffect(() => {
    const next = projectToForm(project, hoursPerDay);
    setF((cur) => (justSaved.current || JSON.stringify(cur) === JSON.stringify(loaded.current) ? next : cur));
    loaded.current = next;
    justSaved.current = false;
  }, [project, hoursPerDay]);

  // Keep the current client selectable even if it is archived.
  const clients = useMemo(() => clientsForProject(clientsQ.data ?? [], project) ?? [], [clientsQ.data, project]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Before the request: the action refreshes the project before it returns.
      justSaved.current = true;
      await run('PATCH', `/projects/${project.id}`, projectPayload(f, { hoursPerDay, initial: projectToForm(project, hoursPerDay), canManageRates: org.can('rates:manage') }));
      toast.success('Project saved');
    } catch (e) {
      justSaved.current = false;
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
            <Button onClick={() => setF(projectToForm(project, hoursPerDay))}>Reset</Button>
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
