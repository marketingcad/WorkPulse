'use client';
import { useId, useState } from 'react';
import type { AchievementAwardDto, MemberOptionDto, TeamDto } from '@tallywork/contracts';
import { Button, Checkbox, Field, SegmentedControl, Select, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from './i18n';
import './messages/achievement-forms';
import type { AchievementDefinition } from './types';

interface AwardBody {
  definition_id: string;
  membership_id?: string;
  team_id?: string;
  reason: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  notify: boolean;
}

/**
 * A manager recognizes a person or a team with a manager-awarded achievement and a reason. The server
 * decides who may be recognized (people and teams the actor manages, never themselves) and refuses a
 * second award in the same period; this form shows its answer.
 */
export function RecognizeForm({ definitions }: { definitions: AchievementDefinition[] }) {
  const org = useOrg();
  const toast = useToast();
  const id = useId();
  const [kind, setKind] = useState<'person' | 'team'>('person');
  const [who, setWho] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [reason, setReason] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const peopleQ = useOrgQuery<MemberOptionDto[]>(org.can('members:read') ? '/workers/options' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const award = useOrgMutation<AwardBody, AchievementAwardDto>('POST', '/performance/awards', { invalidate: ['/performance'] });

  const awardable = definitions.filter((d) => d.awardable && !d.archived);
  const people = (peopleQ.data ?? []).filter((p) => p.status === 'ACTIVE' && p.id !== org.membership.id);
  const teams = (teamsQ.data ?? []).filter((x) => !x.archived_at);
  const missing = { who: !who, achievement: !definitionId, reason: !reason.trim() };

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (missing.who || missing.achievement || missing.reason) return;
    try {
      const r = await award.mutateAsync({ definition_id: definitionId, ...(kind === 'person' ? { membership_id: who } : { team_id: who }), reason: reason.trim(), visibility, notify });
      toast.success(t('perf.ach.form.done', { name: r.name, who: r.recipient.name }));
      setWho('');
      setReason('');
      setTried(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  if (!awardable.length) return <p className="text-sm text-text-muted">{t('perf.ach.form.noneAwardable')}</p>;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={t('perf.ach.form.who')} htmlFor={`${id}-who`} hint={t('perf.ach.form.whoHint')} required error={tried && missing.who ? t('perf.ach.form.needWho') : (err?.field('membership_id') ?? null)}>
        <div className="space-y-2">
          <SegmentedControl
            label={t('perf.ach.form.kind')}
            value={kind}
            onChange={(v) => (setKind(v), setWho(''))}
            options={[
              { value: 'person', label: t('perf.ach.form.person') },
              ...(teams.length ? [{ value: 'team' as const, label: t('perf.ach.form.team') }] : []),
            ]}
          />
          <Select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} aria-invalid={tried && missing.who}>
            <option value="">{kind === 'person' ? t('perf.ach.form.choosePerson') : t('perf.ach.form.chooseTeam')}</option>
            {kind === 'person'
              ? people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title ? `${p.name} · ${p.title}` : p.name}
                  </option>
                ))
              : teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
          </Select>
        </div>
      </Field>
      <Field label={t('perf.ach.form.achievement')} htmlFor={`${id}-ach`} required error={tried && missing.achievement ? t('perf.ach.form.needAchievement') : null}>
        <Select id={`${id}-ach`} value={definitionId} onChange={(e) => setDefinitionId(e.target.value)} aria-invalid={tried && missing.achievement}>
          <option value="">{t('perf.ach.form.chooseAchievement')}</option>
          {awardable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('perf.ach.form.reason')} htmlFor={`${id}-why`} hint={t('perf.ach.form.reasonHint')} required error={tried && missing.reason ? t('perf.ach.form.needReason') : (err?.field('reason') ?? null)}>
        <Textarea id={`${id}-why`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={tried && missing.reason} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">{t('perf.ach.form.visibility')}</legend>
        {(['PUBLIC', 'PRIVATE'] as const).map((v) => (
          <label key={v} className="flex items-start gap-2 py-1 text-sm">
            <input type="radio" name={`${id}-vis`} className="mt-1" checked={visibility === v} onChange={() => setVisibility(v)} />
            <span>
              {t(v === 'PUBLIC' ? 'perf.ach.form.public' : 'perf.ach.form.private')}
              <span className="block text-xs text-text-muted">{t(v === 'PUBLIC' ? 'perf.ach.form.publicHint' : 'perf.ach.form.privateHint')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Checkbox label={t('perf.ach.form.notify')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      {err && !err.errors?.length && (
        <p role="alert" className="text-sm text-danger">
          {err.title}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" loading={award.isPending}>
        {t('perf.ach.form.submit')}
      </Button>
      <p className="text-xs text-text-muted">{t('perf.ach.form.audit')}</p>
    </form>
  );
}
