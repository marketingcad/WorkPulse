'use client';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ClientDto, ProjectDto, TaskDto, MemberOptionDto } from '@tallywork/contracts';
import { Button, Dialog, Field, Input, Select, StatusBadge, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { fromMinor } from '@/components/finance/types';
import { MultiSelect } from './multi-select';
import { breaksPayload, projectPayload, unitSeconds, type ProjectBreakForm, type ProjectForm } from './project-form';
export { breaksPayload, projectPayload };
export type { ProjectBreakForm, ProjectForm };
// Write with AI: loaded on demand, only when WorkPulse AI is on.
const DraftButton = lazy(() => import('@/components/assistant/draft-button'));
import { PRIORITIES, PROJECT_COLORS, TASK_STATUSES, hoursToSeconds, secondsToHours, useOrgAction } from './basics';

export * from './basics';


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
  const org = useOrg();
  const [f, setF] = useState({ project_id: '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', due_date: '', estimate: '', assignee_ids: [] as string[] });
  /** WorkPulse AI is writing the description: it is read-only until the draft arrives. */
  const [draftingDesc, setDraftingDesc] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // Set synchronously: two quick Enter presses both run before `busy` re-renders.
  const saving = useRef(false);

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
    if (saving.current) return;
    if (!pid) {
      setErr(new ApiError(422, 'validation', 'Choose a project', undefined, [{ field: 'project_id', message: 'Choose a project' }]));
      return;
    }
    saving.current = true;
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
      saving.current = false;
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
          <Textarea id="task-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} readOnly={draftingDesc} />
          {org.assistant_enabled && (
            <Suspense fallback={null}>
              <DraftButton value={f.description} onChange={(text) => setF((cur) => ({ ...cur, description: text.slice(0, 5000) }))} onBusy={setDraftingDesc} source={task ? { kind: 'task_description', task_id: task.id } : undefined} />
            </Suspense>
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ─── Project form ────────────────────────────────────────────────────────────
/** Working hours in a day, for converting estimates (organization setting, default 8). */
export function useHoursPerDay(): number {
  const org = useOrg();
  const v = (org.organization.settings as { workingHoursPerDay?: number }).workingHoursPerDay;
  return v && v > 0 ? v : 8;
}

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
    rates_from: '',
    breaks: (p?.breaks ?? []).map((b) => ({ break_type_id: b.break_type_id, start_time: b.start_time ?? '', minutes: b.duration_minutes != null ? String(b.duration_minutes) : '' })),
  };
}

/**
 * The clients a project can be given: the active ones, plus the project's current client when it is
 * archived (so editing the project still shows it, with its currency, instead of "No client").
 */
export function clientsForProject(clients: ClientDto[] | undefined, project: ProjectDto | null | undefined): ClientDto[] | undefined {
  if (!clients) return clients;
  const active = clients.filter((c) => !c.archived_at);
  if (!project?.client_id || active.some((c) => c.id === project.client_id)) return active;
  const current = clients.find((c) => c.id === project.client_id);
  return [...active, { ...(current ?? { id: project.client_id }), name: `${current?.name ?? project.client_name ?? 'Current client'} (archived)`, currency: current?.currency ?? project.currency } as ClientDto];
}
