'use client';
import { useId, useState } from 'react';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_ICONS, ACHIEVEMENT_METRICS, AWARD_RECURRENCES, thresholdIssues } from '@tallywork/domain';
import { Button, Dialog, Field, Input, SegmentedControl, Select, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation } from '@/lib/api';
import { t } from './i18n';
import './messages/achievements';
import './messages/achievement-forms';
import { HexBadge, type Tier } from './ui';
import type { AchievementDefinition } from './types';

type Metric = (typeof ACHIEVEMENT_METRICS)[number];
type Recurrence = (typeof AWARD_RECURRENCES)[number];
const TIERS: Tier[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
// The month's top score is the system's to give; it is not offered for custom achievements.
const METRICS = ACHIEVEMENT_METRICS.filter((m) => m !== 'TOP_SCORE');

interface Body {
  name: string;
  description: string;
  category: (typeof ACHIEVEMENT_CATEGORIES)[number];
  icon: string;
  mode: 'AUTOMATIC' | 'MANUAL';
  metric?: Metric;
  thresholds?: number[];
  recurrence: Recurrence;
  default_visibility: 'PUBLIC' | 'PRIVATE';
}

/** An admin adds a custom achievement (`achievements:manage`). Loaded when opened. */
export default function CreateAchievementDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Body['category']>('PRODUCTIVITY');
  const [icon, setIcon] = useState<string>('award');
  const [mode, setMode] = useState<Body['mode']>('MANUAL');
  const [metric, setMetric] = useState<Metric>('TASKS_COMPLETED');
  const [levels, setLevels] = useState(['', '', '', '']);
  const [recurrence, setRecurrence] = useState<Recurrence>('MONTH');
  const [visibility, setVisibility] = useState<Body['default_visibility']>('PUBLIC');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const create = useOrgMutation<Body, AchievementDefinition>('POST', '/performance/achievements', { invalidate: ['/performance'] });

  // Filled levels in order; an empty one in the middle is a gap, which is refused.
  const lastFilled = levels.reduce((n, v, i) => (v.trim() ? i + 1 : n), 0);
  const thresholds = levels.slice(0, lastFilled).map((v) => (v.trim() === '' ? Number.NaN : Number(v)));
  const levelsBad = mode === 'AUTOMATIC' && (thresholds.length === 0 || thresholds.some((n) => !Number.isFinite(n)) || thresholdIssues(thresholds).length > 0);
  const missing = { name: !name.trim(), text: !text.trim() };

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (missing.name || missing.text || levelsBad) return;
    try {
      const d = await create.mutateAsync({ name: name.trim(), description: text.trim(), category, icon, mode, ...(mode === 'AUTOMATIC' ? { metric, thresholds } : {}), recurrence, default_visibility: visibility });
      toast.success(t('perf.ach.new.done', { name: d.name }));
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
      title={t('perf.ach.new.title')}
      description={t('perf.ach.new.description')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}>
            {t('perf.ach.new.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('perf.ach.new.name')} htmlFor={`${id}-name`} required className="sm:col-span-2" error={tried && missing.name ? t('perf.ach.new.needName') : (err?.field('name') ?? null)}>
          <Input id={`${id}-name`} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && missing.name} />
        </Field>
        <Field label={t('perf.ach.new.text')} htmlFor={`${id}-text`} required className="sm:col-span-2" error={tried && missing.text ? t('perf.ach.new.needText') : (err?.field('description') ?? null)}>
          <Textarea id={`${id}-text`} rows={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={tried && missing.text} />
        </Field>
        <Field label={t('perf.ach.new.category')} htmlFor={`${id}-cat`}>
          <Select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value as Body['category'])}>
            {ACHIEVEMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`perf.ach.category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('perf.ach.new.icon')} htmlFor={`${id}-icon`}>
          <div className="flex items-center gap-2">
            <HexBadge icon={icon} tier="GOLD" size={28} />
            <Select id={`${id}-icon`} value={icon} onChange={(e) => setIcon(e.target.value)}>
              {ACHIEVEMENT_ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <div className="space-y-1.5 sm:col-span-2">
          <p className="text-sm font-medium" aria-hidden>
            {t('perf.ach.new.mode')}
          </p>
          <SegmentedControl
            label={t('perf.ach.new.mode')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'MANUAL', label: t('perf.ach.mode.MANUAL') },
              { value: 'AUTOMATIC', label: t('perf.ach.mode.AUTOMATIC') },
            ]}
          />
        </div>
        {mode === 'AUTOMATIC' && (
          <>
            <Field label={t('perf.ach.new.metric')} htmlFor={`${id}-metric`} className="sm:col-span-2" error={err?.field('metric') ?? null}>
              <Select id={`${id}-metric`} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`perf.ach.metric.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">{t('perf.ach.new.levels')}</legend>
              <p className="mb-2 text-xs text-text-muted">{t('perf.ach.new.levelsHint')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TIERS.map((tier, i) => (
                  <label key={tier} className="text-xs font-medium">
                    {t(`perf.tier.${tier.toLowerCase()}`)}
                    <Input type="number" min={1} step={1} inputMode="numeric" className="mt-1 tabular" value={levels[i]} aria-invalid={tried && levelsBad} onChange={(e) => setLevels((l) => l.map((v, j) => (j === i ? e.target.value : v)))} />
                  </label>
                ))}
              </div>
              {tried && levelsBad && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {t('perf.ach.new.levelsInvalid')}
                </p>
              )}
            </fieldset>
          </>
        )}
        <Field label={t('perf.ach.new.recurrence')} htmlFor={`${id}-rec`}>
          <Select id={`${id}-rec`} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {AWARD_RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {t(`perf.ach.recurrence.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('perf.ach.new.visibility')} htmlFor={`${id}-vis`}>
          <Select id={`${id}-vis`} value={visibility} onChange={(e) => setVisibility(e.target.value as Body['default_visibility'])}>
            <option value="PUBLIC">{t('perf.ach.form.public')}</option>
            <option value="PRIVATE">{t('perf.ach.form.private')}</option>
          </Select>
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
