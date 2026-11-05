'use client';
import { useId, useState } from 'react';
import type { GoalDto, MemberOptionDto, ProjectDto, TeamDto } from '@tallywork/contracts';
import { GOAL_METRICS, GOAL_SUBJECTS, goalMetricAllowed, type GoalMetric, type GoalSubject } from '@tallywork/domain';
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from './i18n';
import './messages/goals';
import './messages/goal-forms';

interface CreateBody {
  title: string;
  description: string | null;
  subject_type: GoalSubject;
  subject_id: string | null;
  metric: GoalMetric;
  target: number;
  start_date: string;
  end_date: string;
}
type PatchBody = Partial<Pick<CreateBody, 'title' | 'description' | 'target' | 'end_date'>>;

/**
 * Set a goal (`goals:manage`), or change its name, target and end date. What it is for and how it is
 * measured are fixed once set: progress history must stay comparable. The server decides whom the
 * actor may set goals for. Loaded when opened.
 */
export default function GoalDialog({ goal, presetMember, defaults, onClose }: { goal: GoalDto | null; presetMember?: string | null; defaults: { start: string; end: string }; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const id = useId();
  const editing = !!goal;
  const orgScope = org.grants['goals:manage'] === 'org';
  const subjects = GOAL_SUBJECTS.filter((s) => s !== 'ORG' || orgScope);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [text, setText] = useState(goal?.description ?? '');
  const [subject, setSubject] = useState<GoalSubject>(goal?.subject_type ?? 'MEMBER');
  // Opened from a person's profile ("Set a goal"): that person is already chosen.
  const [who, setWho] = useState(goal?.subject_id ?? presetMember ?? '');
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? 'TASKS_COMPLETED');
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const [start, setStart] = useState(goal?.start_date ?? defaults.start);
  const [end, setEnd] = useState(goal?.end_date ?? defaults.end);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  const peopleQ = useOrgQuery<MemberOptionDto[]>(!editing && subject === 'MEMBER' && org.can('members:read') ? '/workers/options' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(!editing && subject === 'TEAM' && org.can('teams:read') ? '/teams' : null);
  const projectsQ = useOrgQuery<ProjectDto[]>(!editing && subject === 'PROJECT' && org.can('projects:read') ? '/projects' : null);
  const create = useOrgMutation<CreateBody, GoalDto>('POST', '/performance/goals', { invalidate: ['/performance'] });
  const patch = useOrgMutation<PatchBody, GoalDto>('PATCH', `/performance/goals/${goal?.id ?? ''}`, { invalidate: ['/performance'] });

  const options: Array<{ id: string; name: string }> =
    subject === 'MEMBER'
      ? (peopleQ.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => ({ id: p.id, name: p.title ? `${p.name} · ${p.title}` : p.name }))
      : subject === 'TEAM'
        ? (teamsQ.data ?? []).filter((x) => !x.archived_at)
        : subject === 'PROJECT'
          ? (projectsQ.data ?? []).filter((x) => !x.archived_at)
          : [];
  const metrics = GOAL_METRICS.filter((m) => goalMetricAllowed(m, subject));
  const n = Number(target);
  const bad = {
    title: !title.trim(),
    who: !editing && subject !== 'ORG' && !who,
    target: !target.trim() || !Number.isFinite(n) || n <= 0,
    pct: metric === 'ON_TIME_PCT' && n > 100,
    dates: !start || !end || end < start,
  };
  const targetLabel = metric === 'APPROVED_HOURS' ? t('perf.gf.targetHours') : metric === 'ON_TIME_PCT' ? t('perf.gf.targetPct') : t('perf.gf.target');

  const changeSubject = (s: GoalSubject) => {
    setSubject(s);
    setWho('');
    if (!goalMetricAllowed(metric, s)) setMetric(GOAL_METRICS.find((m) => goalMetricAllowed(m, s))!);
  };

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (Object.values(bad).some(Boolean)) return;
    try {
      if (goal) {
        await patch.mutateAsync({ title: title.trim(), description: text.trim() || null, target: n, end_date: end });
        toast.success(t('perf.gf.saved'));
      } else {
        const g = await create.mutateAsync({ title: title.trim(), description: text.trim() || null, subject_type: subject, subject_id: subject === 'ORG' ? null : who, metric, target: n, start_date: start, end_date: end });
        toast.success(t('perf.gf.created', { name: g.subject_name }));
      }
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
      width={600}
      title={t(editing ? 'perf.gf.editTitle' : 'perf.gf.newTitle')}
      description={t('perf.gf.description')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || patch.isPending}>
            {t('perf.gf.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('perf.gf.name')} htmlFor={`${id}-title`} required className="sm:col-span-2" error={tried && bad.title ? t('perf.gf.needName') : (err?.field('title') ?? null)}>
          <Input id={`${id}-title`} maxLength={200} placeholder={t('perf.gf.namePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && bad.title} />
        </Field>
        <Field label={t('perf.gf.text')} htmlFor={`${id}-text`} className="sm:col-span-2">
          <Textarea id={`${id}-text`} rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={t('perf.gf.for')} htmlFor={`${id}-subject`} hint={!orgScope && !editing ? t('perf.gf.orgOnly') : undefined}>
          <Select id={`${id}-subject`} value={subject} disabled={editing} onChange={(e) => changeSubject(e.target.value as GoalSubject)}>
            {(editing ? [subject] : subjects).map((s) => (
              <option key={s} value={s}>
                {t(`perf.g.subjectOne.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        {subject !== 'ORG' && (
          <Field label={t('perf.gf.who')} htmlFor={`${id}-who`} required error={tried && bad.who ? t('perf.gf.needWho') : (err?.field('subject_id') ?? null)}>
            <Select id={`${id}-who`} value={who} disabled={editing} onChange={(e) => setWho(e.target.value)} aria-invalid={tried && bad.who}>
              {editing ? (
                <option value={who}>{goal!.subject_name}</option>
              ) : (
                <>
                  <option value="">{t('perf.gf.choose')}</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </>
              )}
            </Select>
          </Field>
        )}
        <Field label={t('perf.gf.measure')} htmlFor={`${id}-metric`} hint={editing ? undefined : t('perf.gf.measureHint')} className="sm:col-span-2" error={err?.field('metric') ?? null}>
          <Select id={`${id}-metric`} value={metric} disabled={editing} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
            {(editing ? [metric] : metrics).map((m) => (
              <option key={m} value={m}>
                {t(`perf.g.metric.${m}`)} — {t(`perf.g.source.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={targetLabel} htmlFor={`${id}-target`} required error={tried && bad.target ? t('perf.gf.needTarget') : tried && bad.pct ? t('perf.gf.pctTooHigh') : (err?.field('target') ?? null)}>
          <Input id={`${id}-target`} type="number" min={1} step="any" inputMode="decimal" className="tabular" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={tried && (bad.target || bad.pct)} />
        </Field>
        <div />
        <Field label={t('perf.gf.start')} htmlFor={`${id}-start`} required>
          <Input id={`${id}-start`} type="date" value={start} disabled={editing} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t('perf.gf.end')} htmlFor={`${id}-end`} required error={tried && bad.dates ? t('perf.gf.datesInvalid') : (err?.field('end_date') ?? null)}>
          <Input id={`${id}-end`} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-invalid={tried && bad.dates} />
        </Field>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
