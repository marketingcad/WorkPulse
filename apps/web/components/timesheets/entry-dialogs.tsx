'use client';
import { useMemo, useState } from 'react';
import type { ManualTimeDto, TimeEntryDto, TimeTypeDto } from '@tallywork/contracts';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, SegmentedControl, Select, SkeletonRows, Textarea, fmtDateTime, fmtTime, humanize, useToast } from '@tallywork/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ProjectTaskPicker, type PickerValue } from '@/components/project-task-picker';
import { fromLocalInput, toLocalInput, useAssignmentsFor, useReasonPolicy, type EntryRevision } from './shared';
import { useMemberOptions } from '@/lib/members';

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

/** Time type choice; hidden until the organization defines time types. '' = the default type. */
function TimeTypeField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  const q = useOrgQuery<TimeTypeDto[]>('/time-types', { staleTime: 60_000 });
  const types = q.data ?? [];
  if (!types.length) return null;
  const def = types.find((t) => t.is_default);
  return (
    <Field label="Time type" htmlFor={id} error={error}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{def ? `Default (${def.name})` : 'Normal (1×)'}</option>
        {types
          .filter((t) => !t.is_default)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.not_billable ? ' · not billable' : ''}
            </option>
          ))}
      </Select>
    </Field>
  );
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
  const [timeType, setTimeType] = useState(entry.time_type_id ?? '');
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
          ...((timeType || null) !== (entry.time_type_id ?? null) ? { time_type_id: timeType || null } : {}),
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
        <TimeTypeField id="te-type" value={timeType} onChange={setTimeType} error={err?.field('time_type_id')} />
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
  const policy = useReasonPolicy(entry.membership_id);
  const isSelf = entry.membership_id === org.membership.id;
  const reasonRequired = isSelf && org.grants['time:edit'] !== 'org' ? policy.edits : false;
  const mid = new Date((new Date(entry.started_at).getTime() + new Date(entry.ended_at).getTime()) / 2);
  const [at, setAt] = useState(toLocalInput(mid));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const iso = fromLocalInput(at);
    if (!iso) return setErr('Enter a valid time');
    if (reasonRequired === true && !reason.trim()) return setErr('Enter a reason for the change');
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
        <Field label="Reason" htmlFor="split-reason" required={reasonRequired === true} hint={reasonHint(reasonRequired, 'edits')}>
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
/** "2:30", "2h 30m", "2.5", "90m" → seconds; null when unreadable. */
export function parseDuration(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 3600);
  return null;
}
const asHm = (secs: number) => `${Math.floor(secs / 3600)}:${String(Math.round((secs % 3600) / 60)).padStart(2, '0')}`;

export interface ManualTimePrefill {
  projectId?: string | null;
  taskId?: string | null;
  note?: string | null;
  timeTypeId?: string | null;
  durationSeconds?: number;
}

/**
 * Add time: a duration for a day (placed in the first free slot) or exact start and end times.
 * Without `membershipId`, managers pick the member. `prefill` is used by Duplicate.
 */
export function ManualTimeDialog({ membershipId: fixedMember, defaultDate, prefill, onClose }: { membershipId?: string; defaultDate: string; prefill?: ManualTimePrefill; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const refresh = useRefresh();
  const pickMember = !fixedMember;
  const workersQ = useMemberOptions(pickMember && org.can('members:read'));
  const [member, setMember] = useState(fixedMember ?? org.membership.id);
  const membershipId = fixedMember ?? member;
  const isSelf = membershipId === org.membership.id;
  const { assignments } = useAssignmentsFor(membershipId);
  const policy = useReasonPolicy(membershipId);
  const reasonRequired = isSelf ? policy.manual : false;
  const [mode, setMode] = useState<'duration' | 'range'>('duration');
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [duration, setDuration] = useState(prefill?.durationSeconds ? asHm(prefill.durationSeconds) : '');
  const [billable, setBillable] = useState('');
  const [target, setTarget] = useState<PickerValue>({ projectId: prefill?.projectId ?? null, taskId: prefill?.taskId ?? null });
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(prefill?.note ?? '');
  const [timeType, setTimeType] = useState(prefill?.timeTypeId ?? '');
  const [err, setErr] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const members = (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE' && (w.id === org.membership.id ? org.can('manual_time:request') : org.can('manual_time:approve')));

  const fail = (field: string, message: string) => setErr(new ApiError(422, 'validation', message, undefined, [{ field, message }]));
  const save = async () => {
    if (!target.projectId) return setErr(new ApiError(422, 'validation', 'Choose a project'));
    let when: Record<string, unknown>;
    let total: number;
    if (mode === 'duration') {
      const secs = parseDuration(duration);
      if (!secs || secs < 60 || secs > 24 * 3600) return fail('duration_seconds', 'Enter the time worked, e.g. 2:30 or 1.5');
      when = { local_date: date, duration_seconds: secs };
      total = secs;
    } else {
      const s = fromLocalInput(`${date}T${start}`);
      const e = fromLocalInput(`${date}T${end}`);
      if (!s || !e) return setErr(new ApiError(422, 'validation', 'Enter a valid date, start and end'));
      when = { started_at: s, ended_at: e };
      total = (Date.parse(e) - Date.parse(s)) / 1000;
    }
    let billableSeconds: number | undefined;
    if (billable.trim()) {
      const b = parseDuration(billable);
      if (b === null || b > total) return fail('billable_seconds', 'At most the time logged, e.g. 1:00');
      billableSeconds = b;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await api<ManualTimeDto>(`/orgs/${org.organization.id}/manual-time`, {
        method: 'POST',
        body: { membership_id: isSelf ? undefined : membershipId, project_id: target.projectId, task_id: target.taskId, ...when, billable_seconds: billableSeconds, reason: reason.trim() || undefined, note: note.trim() || undefined, time_type_id: timeType || undefined },
      });
      await refresh();
      if (r.status === 'APPROVED') toast.success('Time added to the timesheet');
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
      title={prefill ? 'Duplicate time entry' : isSelf ? 'Add time' : 'Add time for member'}
      description={mode === 'duration' ? 'Enter how long you worked. It is placed in a free slot that day.' : `Record exact times, in your browser's timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
      width={560}
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
        {err && !err.errors?.length && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
        {pickMember && members.length > 1 && (
          <Field label="Member" htmlFor="mt-member">
            <Select id="mt-member" value={member} onChange={(e) => (setMember(e.target.value), setTarget({ projectId: null, taskId: null }))}>
              {members.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.id === org.membership.id ? ' (you)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Date" htmlFor="mt-date" className="w-40">
            <Input id="mt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <SegmentedControl
            label="How to enter time"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'duration', label: 'Duration' },
              { value: 'range', label: 'Start – end' },
            ]}
          />
        </div>
        {mode === 'duration' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Time logged" htmlFor="mt-duration" hint="e.g. 2:30, 2h 30m or 2.5" error={err?.field('duration_seconds')}>
              <Input id="mt-duration" autoFocus inputMode="decimal" className="tabular" placeholder="0:00" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Field label="Billable time" htmlFor="mt-billable" hint="Leave empty to bill all of it (billable projects only)." error={err?.field('billable_seconds')}>
              <Input id="mt-billable" inputMode="decimal" className="tabular" placeholder={duration || '0:00'} value={billable} onChange={(e) => setBillable(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Start" htmlFor="mt-start" error={err?.field('started_at')}>
              <Input id="mt-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="End" htmlFor="mt-end" error={err?.field('ended_at')}>
              <Input id="mt-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="Billable time" htmlFor="mt-billable" hint="Empty = all of it." error={err?.field('billable_seconds')}>
              <Input id="mt-billable" inputMode="decimal" className="tabular" placeholder="0:00" value={billable} onChange={(e) => setBillable(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Project / task" error={err?.field('project_id') ?? err?.field('task_id')}>
          <ProjectTaskPicker value={target} onChange={setTarget} assignments={assignments ?? []} />
        </Field>
        <Field label="Work performed" htmlFor="mt-note" error={err?.field('note')}>
          <Textarea id="mt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" placeholder="What did you work on?" />
        </Field>
        <TimeTypeField id="mt-type" value={timeType} onChange={setTimeType} error={err?.field('time_type_id')} />
        <Field label="Reason" htmlFor="mt-reason" required={reasonRequired === true} hint={reasonHint(reasonRequired, 'manual time')} error={err?.field('reason')}>
          <Input id="mt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Client meeting away from my computer" />
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
