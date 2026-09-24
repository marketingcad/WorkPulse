'use client';
import { useMemo, useState } from 'react';
import type { ManualTimeDto, TimeEntryDto } from '@tallywork/contracts';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, SkeletonRows, Textarea, fmtDateTime, fmtTime, humanize, useToast } from '@tallywork/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ProjectTaskPicker, type PickerValue } from '@/components/project-task-picker';
import { fromLocalInput, toLocalInput, useAssignmentsFor, useReasonPolicy, type EntryRevision } from './shared';

function useRefresh() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return () => qc.invalidateQueries({ queryKey: ['org', orgId] });
}

function reasonHint(required: boolean | null, what: string) {
  if (required === true) return `Required by your organization's policy for ${what}.`;
  if (required === false) return 'Optional. Saved to the revision history.';
  return `Your organization may require a reason for ${what}. It is saved to the revision history.`;
}

// ─── Edit ────────────────────────────────────────────────────────────────────
export function EditEntryDialog({ entry, onClose }: { entry: TimeEntryDto; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const refresh = useRefresh();
  const { assignments } = useAssignmentsFor(entry.membership_id);
  const policy = useReasonPolicy(entry.membership_id);
  const isSelf = entry.membership_id === org.membership.id;
  const reasonRequired = isSelf && org.grants['time:edit'] !== 'org' ? policy.edits : false;
  const [start, setStart] = useState(toLocalInput(entry.started_at));
  const [end, setEnd] = useState(toLocalInput(entry.ended_at));
  const [target, setTarget] = useState<PickerValue>({ projectId: entry.project_id, taskId: entry.task_id });
  const [billable, setBillable] = useState(entry.billable);
  const [note, setNote] = useState(entry.note ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep the current project selectable even if it is no longer an assignment.
  const options = useMemo(() => {
    if (!assignments) return undefined;
    if (assignments.some((a) => a.project_id === entry.project_id)) return assignments;
    return [{ project_id: entry.project_id, project_name: entry.project_name ?? 'Current project', color: 'var(--color-border-strong)', client_name: null, tasks: entry.task_id ? [{ id: entry.task_id, title: entry.task_title ?? 'Current task', status: 'TODO' }] : [] }, ...assignments];
  }, [assignments, entry]);

  const save = async () => {
    const s = fromLocalInput(start);
    const e = fromLocalInput(end);
    if (!s || !e) return setErr(new ApiError(422, 'validation', 'Enter a valid start and end'));
    if (!target.projectId) return setErr(new ApiError(422, 'validation', 'Choose a project'));
    setSaving(true);
    setErr(null);
    try {
      await api(`/orgs/${org.organization.id}/time-entries/${entry.id}`, {
        method: 'PATCH',
        body: {
          ...(s !== new Date(entry.started_at).toISOString() ? { started_at: s } : {}),
          ...(e !== new Date(entry.ended_at).toISOString() ? { ended_at: e } : {}),
          ...(target.projectId !== entry.project_id ? { project_id: target.projectId } : {}),
          ...(target.taskId !== entry.task_id ? { task_id: target.taskId } : {}),
          billable,
          note: note.trim() || null,
          reason: reason.trim() || undefined,
        },
      });
      await refresh();
      toast.success('Time entry updated');
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x : new ApiError(0, 'error', errorMessage(x)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit time entry"
      description={`Times are shown in your browser's timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start" htmlFor="te-start" error={err?.field('started_at')}>
            <Input id="te-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End" htmlFor="te-end" error={err?.field('ended_at')}>
            <Input id="te-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Project / task" error={err?.field('project_id') ?? err?.field('task_id')}>
          <ProjectTaskPicker value={target} onChange={setTarget} assignments={options ?? []} />
        </Field>
        <Checkbox label="Billable" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
        <Field label="Note" htmlFor="te-note" error={err?.field('note')}>
          <Textarea id="te-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" />
        </Field>
        <Field label="Reason for change" htmlFor="te-reason" required={reasonRequired === true} hint={reasonHint(reasonRequired, 'edits')} error={err?.field('reason')}>
          <Input id="te-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Forgot to stop the timer" />
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Split ───────────────────────────────────────────────────────────────────
export function SplitEntryDialog({ entry, onClose }: { entry: TimeEntryDto; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const refresh = useRefresh();
  const mid = new Date((new Date(entry.started_at).getTime() + new Date(entry.ended_at).getTime()) / 2);
  const [at, setAt] = useState(toLocalInput(mid));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const iso = fromLocalInput(at);
    if (!iso) return setErr('Enter a valid time');
    setSaving(true);
    setErr(null);
    try {
      await api(`/orgs/${org.organization.id}/time-entries/${entry.id}/split`, { method: 'POST', body: { at: iso, reason: reason.trim() || undefined } });
      await refresh();
      toast.success('Entry split in two');
      onClose();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Split time entry"
      description={`${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)} · ${entry.project_name ?? ''}`}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Split
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Split at" htmlFor="split-at" hint="Both parts keep the same project and task; edit either part afterwards." error={err}>
          <Input id="split-at" type="datetime-local" value={at} min={toLocalInput(entry.started_at)} max={toLocalInput(entry.ended_at)} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="split-reason" hint="Saved to the revision history.">
          <Input id="split-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Delete ──────────────────────────────────────────────────────────────────
export function DeleteEntryDialog({ entry, onClose }: { entry: TimeEntryDto; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const refresh = useRefresh();
  const policy = useReasonPolicy(entry.membership_id);
  const isSelf = entry.membership_id === org.membership.id;
  const reasonRequired = isSelf && org.grants['time:edit'] !== 'org' ? policy.edits : false;
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const del = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api(`/orgs/${org.organization.id}/time-entries/${entry.id}`, { method: 'DELETE', body: { reason: reason.trim() || undefined } });
      await refresh();
      toast.success('Time entry deleted');
      onClose();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Delete time entry?"
      danger
      confirmLabel="Delete entry"
      loading={saving}
      onConfirm={del}
      description={
        <div className="flex flex-col gap-3">
          <p>
            {fmtTime(entry.started_at)} – {fmtTime(entry.ended_at)} on {entry.project_name}. The entry is removed from timesheets and reports; the revision history keeps a record.
          </p>
          <Field label="Reason" htmlFor="del-reason" required={reasonRequired === true} hint={reasonHint(reasonRequired, 'deleting time')} error={err}>
            <Input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </div>
      }
    />
  );
}

// ─── Revision history ────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = { started_at: 'Start', ended_at: 'End', project_id: 'Project', task_id: 'Task', billable: 'Billable', note: 'Note', deleted: 'Deleted', split_from: 'Split from', manual_request_id: 'Manual request' };

export function RevisionsDrawer({ entry, onClose, names }: { entry: TimeEntryDto; onClose: () => void; names: Map<string, string> }) {
  const org = useOrg();
  const q = useOrgQuery<EntryRevision[]>(`/time-entries/${entry.id}/revisions`);
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
    if (typeof v === 'string') return names.get(v) ?? v;
    return JSON.stringify(v);
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Revision history" subtitle={`${entry.project_name ?? ''} · ${fmtDateTime(entry.started_at)}`} width={520}>
      {q.isLoading ? (
        <SkeletonRows rows={4} cols={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No revisions" description="This entry has not been changed since it was recorded." />
      ) : (
        <ol className="divide-y divide-border">
          {[...q.data].reverse().map((r) => {
            const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])].filter((k) => fmt(r.before?.[k]) !== fmt(r.after?.[k]));
            return (
              <li key={`${r.revision}-${r.action}-${r.created_at}`} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={r.action === 'DELETE' ? 'danger' : r.action === 'CREATE' ? 'success' : 'info'}>{humanize(r.action)}</Badge>
                  <span className="tabular text-xs text-text-muted">Rev. {r.revision}</span>
                  <span className="ml-auto text-xs text-text-muted">
                    {fmtDateTime(r.created_at)} · {r.actor_id === org.membership.id ? 'you' : humanize(r.actor_type)}
                  </span>
                </div>
                {r.reason && <p className="mt-1.5 text-sm">“{r.reason}”</p>}
                {keys.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-text-faint">
                        <th className="py-0.5 pr-2 font-medium">Field</th>
                        <th className="py-0.5 pr-2 font-medium">Before</th>
                        <th className="py-0.5 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k} className="align-top">
                          <td className="py-0.5 pr-2 text-text-muted">{FIELD_LABEL[k] ?? humanize(k)}</td>
                          <td className="tabular py-0.5 pr-2 text-text-muted line-through decoration-text-faint">{r.before ? fmt(r.before[k]) : '—'}</td>
                          <td className="tabular py-0.5">{r.after ? fmt(r.after[k]) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Drawer>
  );
}

// ─── Manual time ─────────────────────────────────────────────────────────────
export function ManualTimeDialog({ membershipId, defaultDate, onClose }: { membershipId: string; defaultDate: string; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const refresh = useRefresh();
  const isSelf = membershipId === org.membership.id;
  const { assignments } = useAssignmentsFor(membershipId);
  const policy = useReasonPolicy(membershipId);
  const reasonRequired = isSelf ? policy.manual : false;
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [target, setTarget] = useState<PickerValue>({ projectId: null, taskId: null });
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const s = fromLocalInput(`${date}T${start}`);
    const e = fromLocalInput(`${date}T${end}`);
    if (!s || !e) return setErr(new ApiError(422, 'validation', 'Enter a valid date, start and end'));
    if (!target.projectId) return setErr(new ApiError(422, 'validation', 'Choose a project'));
    setSaving(true);
    setErr(null);
    try {
      const r = await api<ManualTimeDto>(`/orgs/${org.organization.id}/manual-time`, {
        method: 'POST',
        body: { membership_id: isSelf ? undefined : membershipId, project_id: target.projectId, task_id: target.taskId, started_at: s, ended_at: e, reason: reason.trim() || undefined, note: note.trim() || undefined },
      });
      await refresh();
      if (r.status === 'APPROVED') toast.success('Manual time added to the timesheet');
      else toast.success('Manual time requested. It appears on the timesheet once approved.');
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x : new ApiError(0, 'error', errorMessage(x)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isSelf ? 'Add time' : 'Add time for member'}
      description={`Record work the timer did not capture. Times are in your browser's timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Add time
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date" htmlFor="mt-date">
            <Input id="mt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start" htmlFor="mt-start" error={err?.field('started_at')}>
            <Input id="mt-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End" htmlFor="mt-end" error={err?.field('ended_at')}>
            <Input id="mt-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Project / task" error={err?.field('project_id') ?? err?.field('task_id')}>
          <ProjectTaskPicker value={target} onChange={setTarget} assignments={assignments ?? []} />
        </Field>
        <Field label="Reason" htmlFor="mt-reason" required={reasonRequired === true} hint={reasonHint(reasonRequired, 'manual time')} error={err?.field('reason')}>
          <Input id="mt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Client meeting away from my computer" />
        </Field>
        <Field label="Note" htmlFor="mt-note" error={err?.field('note')}>
          <Textarea id="mt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" />
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Decision with comment (timesheets / manual time) ────────────────────────
export function CommentDialog({ title, description, confirmLabel, required, danger, onConfirm, onClose }: { title: string; description?: string; confirmLabel: string; required: boolean; danger?: boolean; onConfirm: (comment: string) => Promise<void>; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const go = async () => {
    if (required && !comment.trim()) return setErr('Add a comment so the member knows what to change');
    setSaving(true);
    setErr(null);
    try {
      await onConfirm(comment.trim());
      onClose();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={go} loading={saving}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Comment" htmlFor="decision-comment" required={required} hint={required ? 'Shown to the member.' : 'Optional. Shown to the member.'} error={err}>
        <Textarea id="decision-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} autoFocus />
      </Field>
    </Dialog>
  );
}
