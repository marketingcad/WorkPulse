'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientDto, ProjectDto, TaskDto, TeamDto, MemberOptionDto } from '@tallywork/contracts';
import { Plus } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, Field, IconButton, Input, Select, StatusBadge, Textarea, cx, useToast, type Tone } from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgId } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { fromMinor, toMinor } from '@/components/finance/types';
import { MultiSelect } from './multi-select';
import { ClientDialog } from './client-dialog';

// ─── Constants ───────────────────────────────────────────────────────────────
/** Project colours are data (stored on the project), so hex values are allowed here. */
export const PROJECT_COLORS = ['#2563eb', '#0891b2', '#0d9488', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#4f46e5', '#475569'];

export const TASK_STATUSES = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
] as const;

export const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
] as const;

export const PROJECT_STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
] as const;

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtin: boolean;
}

export const hoursToSeconds = (h: string): number | null => {
  const n = Number(h);
  return h.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 3600);
};
export const secondsToHours = (s: number | null | undefined): string => (s === null || s === undefined ? '' : String(Math.round((s / 3600) * 100) / 100));

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Call an org endpoint and refresh every org query afterwards. */
export function useOrgAction() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return async function run<T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const r = await api<T>(`/orgs/${orgId}${path}`, { method, body });
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
    return r;
  };
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

const PRIORITY_TONE: Record<string, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>{PRIORITIES.find((p) => p.value === priority)?.label ?? priority}</Badge>;
}

export function ProjectStatusBadge({ project }: { project: Pick<ProjectDto, 'status' | 'archived_at'> }) {
  if (project.archived_at) return <StatusBadge status="ARCHIVED" />;
  return <StatusBadge status={project.status} label={PROJECT_STATUSES.find((s) => s.value === project.status)?.label} />;
}

/** Inline status change; assignees may change status even without task management rights. */
export function TaskStatusSelect({ task, canManage }: { task: TaskDto; canManage: boolean }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const editable = canManage || task.assignee_ids.includes(org.membership.id);
  if (!editable) return <StatusBadge status={task.status} />;
  return (
    <Select
      aria-label={`Status of ${task.title}`}
      value={task.status}
      disabled={busy}
      className="h-7 w-32 text-xs"
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        setBusy(true);
        try {
          await run('PATCH', `/tasks/${task.id}`, { project_id: task.project_id, status: e.target.value });
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

// ─── Task dialog ─────────────────────────────────────────────────────────────
export function TaskDialog({
  open,
  onOpenChange,
  task,
  projectId,
  projects,
  workers,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  task?: TaskDto | null;
  /** fixed project; otherwise a project picker is shown */
  projectId?: string;
  projects?: ProjectDto[];
  workers?: MemberOptionDto[];
}) {
  const run = useOrgAction();
  const toast = useToast();
  const [f, setF] = useState({ project_id: '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', due_date: '', estimate: '', assignee_ids: [] as string[] });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF({
      project_id: task?.project_id ?? projectId ?? '',
      title: task?.title ?? '',
      description: task?.description ?? '',
      status: task?.status ?? 'TODO',
      priority: task?.priority ?? 'MEDIUM',
      due_date: task?.due_date ?? '',
      estimate: secondsToHours(task?.estimate_seconds),
      assignee_ids: task?.assignee_ids ?? [],
    });
  }, [open, task, projectId]);

  const pid = f.project_id;
  const project = projects?.find((p) => p.id === pid);
  // Offer project members first; fall back to everyone the viewer can see.
  const assigneeOptions = (workers ?? [])
    .filter((w) => w.status === 'ACTIVE')
    .map((w) => ({ value: w.id, label: w.name, sub: project && !project.member_ids.includes(w.id) ? 'Not a direct project member' : w.email }));

  const save = async () => {
    if (!pid) {
      setErr(new ApiError(422, 'validation', 'Choose a project', undefined, [{ field: 'project_id', message: 'Choose a project' }]));
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      title: f.title,
      description: f.description || null,
      status: f.status,
      priority: f.priority,
      due_date: f.due_date || null,
      estimate_seconds: hoursToSeconds(f.estimate),
      ...(workers ? { assignee_ids: f.assignee_ids } : {}),
    };
    try {
      if (task) await run('PATCH', `/tasks/${task.id}`, { project_id: task.project_id, ...payload });
      else await run('POST', `/projects/${pid}/tasks`, payload);
      toast.success(task ? 'Task updated' : 'Task created');
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
      title={task ? 'Edit task' : 'New task'}
      width={560}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!f.title.trim()}>
            {task ? 'Save task' : 'Create task'}
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
        {!projectId && !task && (
          <Field label="Project" htmlFor="task-project" required error={err?.field('project_id')} className="sm:col-span-2">
            <Select id="task-project" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
              <option value="">Choose a project…</option>
              {(projects ?? [])
                .filter((p) => !p.archived_at)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.client_name ? ` · ${p.client_name}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Title" htmlFor="task-title" required error={err?.field('title')} className="sm:col-span-2">
          <Input id="task-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus maxLength={300} />
        </Field>
        <Field label="Status" htmlFor="task-status">
          <Select id="task-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <Select id="task-priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            {PRIORITIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="task-due" error={err?.field('due_date')}>
          <Input id="task-due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Estimate (hours)" htmlFor="task-est" error={err?.field('estimate_seconds')}>
          <Input id="task-est" type="number" min={0} step={0.25} inputMode="decimal" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} className="tabular" />
        </Field>
        {workers && (
          <Field label="Assignees" htmlFor="task-assignees" className="sm:col-span-2" error={err?.field('assignee_ids')}>
            <MultiSelect id="task-assignees" options={assigneeOptions} value={f.assignee_ids} onChange={(v) => setF({ ...f, assignee_ids: v })} placeholder="Unassigned" />
          </Field>
        )}
        <Field label="Description" htmlFor="task-desc" className="sm:col-span-2">
          <Textarea id="task-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ─── Project form ────────────────────────────────────────────────────────────
export interface ProjectForm {
  name: string;
  client_id: string;
  description: string;
  color: string;
  status: string;
  billable_default: boolean;
  member_ids: string[];
  team_ids: string[];
  short_name: string;
  start_date: string;
  end_date: string;
  /** in `estimate_unit`, as typed */
  estimate: string;
  estimate_unit: 'HOURS' | 'DAYS';
  pay_rate: string;
  bill_rate: string;
}

/** Working hours in a day, for converting estimates (organization setting, default 8). */
export function useHoursPerDay(): number {
  const org = useOrg();
  const v = (org.organization.settings as { workingHoursPerDay?: number }).workingHoursPerDay;
  return v && v > 0 ? v : 8;
}

const unitSeconds = (unit: 'HOURS' | 'DAYS', hoursPerDay: number) => (unit === 'DAYS' ? hoursPerDay * 3600 : 3600);

export function projectToForm(p: ProjectDto | null | undefined, hoursPerDay: number): ProjectForm {
  const unit = p?.estimate_unit ?? 'HOURS';
  return {
    name: p?.name ?? '',
    client_id: p?.client_id ?? '',
    description: p?.description ?? '',
    color: p?.color ?? PROJECT_COLORS[0]!,
    status: p?.status ?? 'ACTIVE',
    billable_default: p?.billable_default ?? true,
    member_ids: p?.member_ids ?? [],
    team_ids: p?.team_ids ?? [],
    short_name: p?.short_name ?? '',
    start_date: p?.start_date ?? '',
    end_date: p?.end_date ?? '',
    estimate: p?.estimate_seconds != null ? String(Math.round((p.estimate_seconds / unitSeconds(unit, hoursPerDay)) * 100) / 100) : '',
    estimate_unit: unit,
    pay_rate: p?.pay_rate_minor != null ? fromMinor(p.pay_rate_minor) : '',
    bill_rate: p?.bill_rate_minor != null ? fromMinor(p.bill_rate_minor) : '',
  };
}

export function ColorPicker({ value, onChange, label = 'Project colour' }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PROJECT_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={`Colour ${i + 1}`}
          title={c}
          onClick={() => onChange(c)}
          className={cx('size-6 rounded-full border-2 transition-transform hover:scale-110', value.toLowerCase() === c ? 'border-text ring-2 ring-interactive/30' : 'border-transparent')}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/** Fields shared by the create/edit dialog and the project settings tab. */
export function ProjectFields({
  f,
  setF,
  err,
  clients,
  workers,
  teams,
  showAssignments = true,
}: {
  f: ProjectForm;
  setF: (f: ProjectForm) => void;
  err: ApiError | null;
  clients?: ClientDto[];
  workers?: MemberOptionDto[];
  teams?: TeamDto[];
  showAssignments?: boolean;
}) {
  const org = useOrg();
  const [newClient, setNewClient] = useState(false);
  const [created, setCreated] = useState<ClientDto[]>([]);
  const clientList = [...(clients ?? []), ...created.filter((c) => !(clients ?? []).some((x) => x.id === c.id))];
  const currency = clientList.find((c) => c.id === f.client_id)?.currency ?? org.organization.currency;
  const canReadRates = org.can('rates:read');
  const canManageRates = org.can('rates:manage');
  const unitLabel = f.estimate_unit === 'DAYS' ? 'days' : 'hours';

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-[1fr_240px]">
      <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="proj-name" required error={err?.field('name')} className="sm:col-span-2">
          <Input id="proj-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={150} />
        </Field>
        <Field label="Short name" htmlFor="proj-short" hint="Shown where space is tight, e.g. WEB." error={err?.field('short_name')}>
          <Input id="proj-short" value={f.short_name} onChange={(e) => setF({ ...f, short_name: e.target.value })} maxLength={20} />
        </Field>
        <Field label="Client" htmlFor="proj-client" error={err?.field('client_id')}>
          <div className="flex gap-1.5">
            <Select id="proj-client" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} className="min-w-0 flex-1">
              <option value="">No client</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {org.can('clients:manage') && (
              <IconButton label="New client" variant="secondary" onClick={() => setNewClient(true)}>
                <Plus className="size-3.5" />
              </IconButton>
            )}
          </div>
        </Field>
        <Field label="Start date" htmlFor="proj-start" error={err?.field('start_date')}>
          <Input id="proj-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label="End date" htmlFor="proj-end" error={err?.field('end_date')}>
          <Input id="proj-end" type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </Field>
        <Field label={`Estimated ${unitLabel}`} htmlFor="proj-estimate" hint="Planned effort; compared with logged time on the project." error={err?.field('estimate_seconds')}>
          <Input id="proj-estimate" type="number" min={0} step={f.estimate_unit === 'DAYS' ? 0.5 : 1} inputMode="decimal" className="tabular" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} />
        </Field>
        <Field label="Status" htmlFor="proj-status">
          <Select id="proj-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Colour" className="sm:col-span-2">
          <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
        </Field>
        {showAssignments && workers && (
          <Field label="Members" htmlFor="proj-members" hint="Members can track time to this project." error={err?.field('member_ids')}>
            <MultiSelect
              id="proj-members"
              options={workers.filter((w) => w.status === 'ACTIVE').map((w) => ({ value: w.id, label: w.name, sub: w.email }))}
              value={f.member_ids}
              onChange={(member_ids) => setF({ ...f, member_ids })}
              placeholder="No direct members"
            />
          </Field>
        )}
        {showAssignments && teams && (
          <Field label="Teams" htmlFor="proj-teams" hint="Everyone in these teams can track time here." error={err?.field('team_ids')}>
            <MultiSelect id="proj-teams" options={teams.map((t) => ({ value: t.id, label: t.name, sub: `${t.members.length} members` }))} value={f.team_ids} onChange={(team_ids) => setF({ ...f, team_ids })} placeholder="No teams" />
          </Field>
        )}
        <Field label="Description" htmlFor="proj-desc" className="sm:col-span-2">
          <Textarea id="proj-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} className="min-h-16" />
        </Field>
      </div>

      <section className="flex flex-col gap-3 md:border-l md:border-border md:pl-6" aria-label="Finance">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Finance</h3>
        <Field label="Estimate units" htmlFor="proj-unit">
          <Select id="proj-unit" value={f.estimate_unit} onChange={(e) => setF({ ...f, estimate_unit: e.target.value as 'HOURS' | 'DAYS' })}>
            <option value="HOURS">Hours</option>
            <option value="DAYS">Days</option>
          </Select>
        </Field>
        <Field label="Currency" htmlFor="proj-currency" hint={f.client_id ? 'From the client.' : 'Workspace default. Pick a client to bill in its currency.'}>
          <Input id="proj-currency" value={currency} readOnly disabled className="tabular" />
        </Field>
        {canReadRates && (
          <>
            <Field label="Pay rate per hour" htmlFor="proj-pay" hint={`${currency} / hour, what you pay`} error={err?.field('pay_rate_minor')}>
              <Input id="proj-pay" inputMode="decimal" className="tabular" placeholder="0.00" value={f.pay_rate} disabled={!canManageRates} onChange={(e) => setF({ ...f, pay_rate: e.target.value })} />
            </Field>
            <Field label="Bill rate per hour" htmlFor="proj-bill" hint={`${currency} / hour, what you charge`} error={err?.field('bill_rate_minor')}>
              <Input id="proj-bill" inputMode="decimal" className="tabular" placeholder="0.00" value={f.bill_rate} disabled={!canManageRates} onChange={(e) => setF({ ...f, bill_rate: e.target.value })} />
            </Field>
            <p className="text-xs text-text-muted">Rates apply from today. The bill rate overrides client, member and workspace rates; the pay rate overrides client and workspace rates, but a member's own pay rate still wins. Full order: Finance → Billing &amp; rates.</p>
          </>
        )}
        <Checkbox label="Not billable project" checked={!f.billable_default} onChange={(e) => setF({ ...f, billable_default: !e.target.checked })} />
      </section>

      <ClientDialog
        client={null}
        open={newClient}
        onOpenChange={setNewClient}
        onSaved={(c) => {
          setCreated((xs) => [...xs, c]);
          setF({ ...f, client_id: c.id });
        }}
      />
    </div>
  );
}

/**
 * Request body for the form. Rates are only sent when they changed and the editor may manage
 * rates; the estimate is converted from hours or days to seconds.
 */
export function projectPayload(f: ProjectForm, opts: { workers?: boolean; teams?: boolean; hoursPerDay?: number; initial?: ProjectForm; canManageRates?: boolean } = {}) {
  const rate = (key: 'pay_rate' | 'bill_rate', field: 'pay_rate_minor' | 'bill_rate_minor') => {
    if (!opts.canManageRates || (opts.initial && f[key] === opts.initial[key])) return {};
    if (!f[key].trim()) return opts.initial ? { [field]: null } : {};
    const minor = toMinor(f[key]);
    if (minor === null) throw new ApiError(422, 'validation', 'Enter a valid amount', undefined, [{ field, message: 'Enter an amount like 75 or 75.50' }]);
    return { [field]: minor };
  };
  const est = f.estimate.trim() === '' ? null : Number(f.estimate);
  if (est !== null && !(est >= 0)) throw new ApiError(422, 'validation', 'Enter a valid estimate', undefined, [{ field: 'estimate_seconds', message: 'A number of hours or days' }]);
  return {
    name: f.name,
    client_id: f.client_id || null,
    description: f.description || null,
    color: f.color,
    status: f.status,
    billable_default: f.billable_default,
    short_name: f.short_name.trim() || null,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    estimate_seconds: est === null ? null : Math.round(est * unitSeconds(f.estimate_unit, opts.hoursPerDay ?? 8)),
    estimate_unit: f.estimate_unit,
    ...rate('pay_rate', 'pay_rate_minor'),
    ...rate('bill_rate', 'bill_rate_minor'),
    ...(opts.workers ? { member_ids: f.member_ids } : {}),
    ...(opts.teams ? { team_ids: f.team_ids } : {}),
  };
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  clients,
  workers,
  teams,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: ProjectDto | null;
  clients?: ClientDto[];
  workers?: MemberOptionDto[];
  teams?: TeamDto[];
  onSaved?: (p: ProjectDto) => void;
}) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const hoursPerDay = useHoursPerDay();
  const [f, setF] = useState<ProjectForm>(projectToForm(project, hoursPerDay));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF(projectToForm(project, hoursPerDay));
      setErr(null);
    }
  }, [open, project, hoursPerDay]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = projectPayload(f, { workers: !!workers, teams: !!teams, hoursPerDay, initial: project ? projectToForm(project, hoursPerDay) : undefined, canManageRates: org.can('rates:manage') });
      const p = project ? await run<ProjectDto>('PATCH', `/projects/${project.id}`, body) : await run<ProjectDto>('POST', '/projects', body);
      toast.success(project ? 'Project updated' : 'Project created');
      onOpenChange(false);
      onSaved?.(p);
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
      title={project ? 'Edit project' : 'New project'}
      width={820}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>
            {project ? 'Save project' : 'Create project'}
          </Button>
        </>
      }
    >
      <ProjectFields f={f} setF={setF} err={err} clients={clients} workers={workers} teams={teams} />
    </Dialog>
  );
}
