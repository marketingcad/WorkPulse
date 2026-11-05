'use client';
import { useEffect, useId, useState } from 'react';
import type { PerformanceSettingsDto } from '@tallywork/contracts';
import { weightIssues, type PerformanceWeights } from '@tallywork/domain';
import { Button, Dialog, Field, Input, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation } from '@/lib/api';
import { t } from './i18n';
import './messages/rules';
import { METRICS, METRIC_COLOR, metricLabel, metricSource, type MetricKey } from './ui';

/**
 * How the score is made: the five weights and the minimum approved days to be ranked. Anyone who can
 * read performance sees them (transparency); only `performance:manage` changes them. Saving new
 * weights makes a new rules version: final scores keep the version they were calculated with.
 */
export function ScoringRulesDialog({ open, onClose, settings, canManage }: { open: boolean; onClose: () => void; settings: PerformanceSettingsDto | undefined; canManage: boolean }) {
  const toast = useToast();
  const id = useId();
  const [weights, setWeights] = useState<Record<MetricKey, string>>({ goals: '', delivery: '', consistency: '', quality: '', attendance: '' });
  const [minDays, setMinDays] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const save = useOrgMutation<{ weights: PerformanceWeights; min_eligible_days: number }, PerformanceSettingsDto>('PUT', '/performance/settings');

  useEffect(() => {
    if (!open || !settings) return;
    setWeights(Object.fromEntries(METRICS.map((m) => [m, String(settings.rules.weights[m])])) as Record<MetricKey, string>);
    setMinDays(String(settings.rules.min_eligible_days));
    setTried(false);
    setErr(null);
    // Reset when the dialog opens, not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings?.rules.id]);

  const parsed = Object.fromEntries(METRICS.map((m) => [m, weights[m].trim() === '' ? Number.NaN : Number(weights[m])])) as PerformanceWeights;
  const badWeight = (m: MetricKey) => !Number.isInteger(parsed[m]) || parsed[m] < 0 || parsed[m] > 100;
  const total = METRICS.reduce((s, m) => s + (badWeight(m) ? 0 : parsed[m]), 0);
  const days = Number(minDays);
  const badDays = minDays.trim() === '' || !Number.isInteger(days) || days < 0 || days > 60;
  const valid = weightIssues(parsed).length === 0 && !badDays;

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (!valid) return;
    try {
      const saved = await save.mutateAsync({ weights: parsed, min_eligible_days: days });
      toast.success(saved.rules.version !== settings?.rules.version ? t('perf.rules.savedVersion', { version: saved.rules.version }) : t('perf.rules.saved'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width={560}
      title={t('perf.rules.title')}
      description={settings ? t('perf.rules.description', { version: settings.rules.version }) : undefined}
      footer={
        canManage ? (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} loading={save.isPending}>
              {t('perf.rules.save')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('common.close')}</Button>
        )
      }
    >
      <ul className="divide-y divide-border">
        {METRICS.map((m) => (
          <li key={m} className="flex items-center gap-3 py-2.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: METRIC_COLOR[m] }} />
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-${m}`} className="text-sm font-medium">
                {metricLabel(m)}
              </label>
              <p className="text-xs text-text-muted">{metricSource(m)}</p>
              {tried && badWeight(m) && (
                <p role="alert" className="text-xs text-danger">
                  {t('perf.rules.weightInvalid')}
                </p>
              )}
            </div>
            {canManage ? (
              <div className="flex items-center gap-1">
                <Input id={`${id}-${m}`} type="number" min={0} max={100} step={1} inputMode="numeric" className="w-20 text-right tabular" value={weights[m]} aria-invalid={tried && badWeight(m)} onChange={(e) => setWeights((w) => ({ ...w, [m]: e.target.value }))} />
                <span className="text-sm text-text-muted" aria-hidden>
                  %
                </span>
              </div>
            ) : (
              <span id={`${id}-${m}`} className="text-sm font-semibold tabular">
                {weights[m]}%
              </span>
            )}
          </li>
        ))}
      </ul>
      <p role={tried && total !== 100 ? 'alert' : 'status'} className={total === 100 ? 'mt-2 text-sm text-text-muted' : 'mt-2 text-sm font-medium text-danger'}>
        {t('perf.rules.total', { total })}
      </p>
      <div className="mt-4">
        <Field label={t('perf.rules.minDays')} htmlFor={`${id}-days`} hint={t('perf.rules.minDaysHint')} error={tried && badDays ? t('perf.rules.minDaysInvalid') : (err?.field('min_eligible_days') ?? null)}>
          {canManage ? <Input id={`${id}-days`} type="number" min={0} max={60} step={1} inputMode="numeric" className="w-24 tabular" value={minDays} onChange={(e) => setMinDays(e.target.value)} /> : <span id={`${id}-days`} className="text-sm font-semibold tabular">{minDays}</span>}
        </Field>
      </div>
      <p className="mt-4 text-xs text-text-muted">{t('perf.rules.never')}</p>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
