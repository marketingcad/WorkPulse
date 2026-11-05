'use client';
import { useEffect, useId, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MilestoneDto, ProjectDto } from '@tallywork/contracts';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Panel, SkeletonRows, Textarea, cx, fmtDate, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from './i18n';
import './messages/milestones';

interface MilestoneBody {
  title?: string;
  description?: string | null;
  due_date?: string;
  client_visible?: boolean;
  completed?: boolean;
}
type Status = 'ON_TIME' | 'LATE' | 'OVERDUE' | 'OPEN';

const statusOf = (m: MilestoneDto, today: string): Status => (m.completed_at ? (m.on_time ? 'ON_TIME' : 'LATE') : m.due_date < today ? 'OVERDUE' : 'OPEN');
const TONE: Record<Status, 'success' | 'warning' | 'danger' | 'neutral'> = { ON_TIME: 'success', LATE: 'warning', OVERDUE: 'danger', OPEN: 'neutral' };

/**
 * A project's milestones: its delivery dates. Done on time, they count towards delivery scores and
 * goals; the client sees the visible ones in their portal. Anyone who can read the project sees them;
 * `projects:manage` on the project adds, completes, edits and deletes (the server checks each).
 * Loaded when the tab opens.
 */
export default function ProjectMilestones({ project }: { project: ProjectDto }) {
  const org = useOrg();
  const today = todayIn(org.organization.timezone);
  const canManage = org.can('projects:manage') && !project.archived_at;
  const q = useOrgQuery<MilestoneDto[]>(`/projects/${project.id}/milestones`);
  const [adding, setAdding] = useState(false);
  const list = q.data ?? [];
  const done = list.filter((m) => m.completed_at);

  return (
    <Panel
      bodyClassName="p-4"
      title={t('perf.ms.title')}
      actions={
        canManage && (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            {t('perf.ms.add')}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-text-muted">{t('perf.ms.intro')}</p>
      {project.archived_at && <p className="mb-3 text-sm text-warning">{t('perf.ms.archivedProject')}</p>}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div role="status" aria-label={t('perf.loading')}>
          <SkeletonRows rows={4} cols={2} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('perf.ms.empty')}
          description={canManage ? t('perf.ms.emptyHint') : t('perf.ms.emptyReadOnly')}
          action={
            canManage ? (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                {t('perf.ms.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-text-muted tabular">{t('perf.ms.summary', { done: done.length, total: list.length, onTime: done.filter((m) => m.on_time).length })}</p>
          <ol className="divide-y divide-border">
            {list.map((m) => (
              <MilestoneRow key={m.id} m={m} status={statusOf(m, today)} canManage={canManage} />
            ))}
          </ol>
        </>
      )}
      {adding && <MilestoneDialog projectId={project.id} milestone={null} defaultDue={project.end_date && project.end_date >= today ? project.end_date : today} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function MilestoneRow({ m, status, canManage }: { m: MilestoneDto; status: Status; canManage: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The box follows the click at once; it goes back if the change is refused.
  const [doneNow, setDoneNow] = useState<boolean | null>(null);
  const done = doneNow ?? !!m.completed_at;
  const setDone = async (value: boolean) => {
    setDoneNow(value);
    try {
      await patch.mutateAsync({ completed: value });
      toast.success(t(value ? 'perf.ms.doneToast' : 'perf.ms.reopened', { title: m.title }));
    } catch (e) {
      setDoneNow(null);
      toast.error(errorMessage(e));
    }
  };
  // Once the reloaded milestone says the same, it is the source again.
  useEffect(() => setDoneNow(null), [m.completed_at]);
  // The id goes in the address only: the edit endpoint refuses fields it does not know.
  const patch = useOrgMutation<MilestoneBody, MilestoneDto>('PATCH', `/milestones/${m.id}`, { invalidate: ['/projects', '/performance'] });
  const del = useOrgMutation<undefined>('DELETE', `/milestones/${m.id}`, { invalidate: ['/projects', '/performance'] });
  const remove = async () => {
    try {
      await del.mutateAsync(undefined);
      toast.success(t('perf.ms.deleted'));
      setDeleting(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {canManage ? (
        <Checkbox
          className="mt-0.5"
          checked={done}
          disabled={patch.isPending}
          aria-label={t('perf.ms.markDone', { title: m.title })}
          onChange={(e) => void setDone(e.target.checked)}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className={cx('font-medium', done && 'text-text-muted line-through decoration-1')}>{m.title}</p>
        {m.description && <p className="text-sm text-text-muted">{m.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Badge tone={TONE[status]}>{t(`perf.ms.status.${status}`)}</Badge>
          <span className="tabular">{m.completed_at ? t('perf.ms.doneOn', { date: fmtDate(m.completed_at) }) : t('perf.ms.dueOn', { date: fmtDate(m.due_date) })}</span>
          <span className="inline-flex items-center gap-1">
            {m.client_visible ? <Eye className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
            {t(m.client_visible ? 'perf.ms.visible' : 'perf.ms.hidden')}
          </span>
        </p>
      </div>
      {canManage && (
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)} aria-label={`${t('perf.ms.edit')}: ${m.title}`}>
            {t('perf.ms.edit')}
          </Button>
          <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)} aria-label={`${t('perf.ms.delete')}: ${m.title}`}>
            {t('perf.ms.delete')}
          </Button>
        </div>
      )}
      {editing && <MilestoneDialog projectId={m.project_id} milestone={m} defaultDue={m.due_date} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t('perf.ms.deleteTitle')} description={t('perf.ms.deleteText')} confirmLabel={t('perf.ms.delete')} danger loading={del.isPending} onConfirm={remove} />
    </li>
  );
}

/** Add a milestone, or edit one (a done milestone keeps its due date: it is part of its record). */
function MilestoneDialog({ projectId, milestone, defaultDue, onClose }: { projectId: string; milestone: MilestoneDto | null; defaultDue: string; onClose: () => void }) {
  const toast = useToast();
  const id = useId();
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [text, setText] = useState(milestone?.description ?? '');
  const [due, setDue] = useState(milestone?.due_date ?? defaultDue);
  const [visible, setVisible] = useState(milestone?.client_visible ?? true);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const create = useOrgMutation<MilestoneBody, MilestoneDto>('POST', `/projects/${projectId}/milestones`, { invalidate: ['/projects', '/performance'] });
  const patch = useOrgMutation<MilestoneBody, MilestoneDto>('PATCH', `/milestones/${milestone?.id ?? ''}`, { invalidate: ['/projects', '/performance'] });
  const dueLocked = !!milestone?.completed_at;
  const bad = { title: !title.trim(), due: !due };

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (bad.title || bad.due) return;
    const body: MilestoneBody = { title: title.trim(), description: text.trim() || null, client_visible: visible, ...(dueLocked ? {} : { due_date: due }) };
    try {
      if (milestone) await patch.mutateAsync(body);
      else await create.mutateAsync(body);
      toast.success(t(milestone ? 'perf.ms.saved' : 'perf.ms.added'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(milestone ? 'perf.ms.editTitle' : 'perf.ms.add')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || patch.isPending}>
            {t('perf.ms.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('perf.ms.name')} htmlFor={`${id}-title`} required error={tried && bad.title ? t('perf.ms.needName') : (err?.field('title') ?? null)}>
          <Input id={`${id}-title`} maxLength={200} placeholder={t('perf.ms.namePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && bad.title} />
        </Field>
        <Field label={t('perf.ms.due')} htmlFor={`${id}-due`} required hint={dueLocked ? t('perf.ms.dueLocked') : undefined} error={tried && bad.due ? t('perf.ms.needDue') : (err?.field('due_date') ?? null)}>
          <Input id={`${id}-due`} type="date" value={due} disabled={dueLocked} onChange={(e) => setDue(e.target.value)} aria-invalid={tried && bad.due} />
        </Field>
        <Field label={t('perf.ms.text')} htmlFor={`${id}-text`}>
          <Textarea id={`${id}-text`} rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div>
          <Checkbox label={t('perf.ms.clientVisible')} checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          <p className="ml-6 text-xs text-text-muted">{t('perf.ms.clientVisibleHint')}</p>
        </div>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
