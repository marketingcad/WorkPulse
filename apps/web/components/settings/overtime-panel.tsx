'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, ErrorState, Field, Input, Panel, SkeletonRows, Switch, useToast } from '@tallywork/ui';
import { ApiError, useOrgMutation, useOrgQuery } from '@/lib/api';
import { hoursToSeconds, secondsToHours } from '@/components/workspace/shared';

export interface OvertimeRules {
  dailyThresholdSeconds: number | null;
  weeklyThresholdSeconds: number | null;
}
interface Rule {
  on: boolean;
  hours: string;
}

const toRule = (s: number | null, fallback: string): Rule => (s === null ? { on: false, hours: fallback } : { on: true, hours: secondsToHours(s) });

function ruleError(r: Rule, max: number): string | undefined {
  if (!r.on) return undefined;
  const n = Number(r.hours);
  if (r.hours.trim() === '' || !Number.isFinite(n)) return 'Enter a number of hours';
  if (n < 1 || n > max) return `Between 1 and ${max} hours`;
  return undefined;
}

export function OvertimePanel() {
  const toast = useToast();
  const q = useOrgQuery<OvertimeRules>('/overtime-rules');
  const initial = useMemo(
    () =>
      q.data
        ? {
            daily: toRule(q.data.dailyThresholdSeconds, '8'),
            weekly: toRule(q.data.weeklyThresholdSeconds, '40'),
          }
        : null,
    [q.data],
  );
  const [f, setF] = useState(initial);
  useEffect(() => setF(initial), [initial]);

  const m = useOrgMutation<
    {
      daily_threshold_seconds: number | null;
      weekly_threshold_seconds: number | null;
    },
    OvertimeRules
  >('PUT', '/overtime-rules', {
    onSuccess: () => toast.success('Overtime rules saved'),
  });
  const err = m.error instanceof ApiError ? m.error : null;

  if (q.error)
    return (
      <Panel title="Overtime">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Panel>
    );
  if (!f || !initial)
    return (
      <Panel title="Overtime">
        <SkeletonRows rows={2} cols={2} />
      </Panel>
    );

  const dailyErr = ruleError(f.daily, 24);
  const weeklyErr = ruleError(f.weekly, 168);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const invalid = !!dailyErr || !!weeklyErr;
  const save = () =>
    m.mutate({
      daily_threshold_seconds: f.daily.on ? hoursToSeconds(f.daily.hours) : null,
      weekly_threshold_seconds: f.weekly.on ? hoursToSeconds(f.weekly.hours) : null,
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !invalid) save();
      }}
    >
      <Panel
        title="Overtime"
        actions={
          <>
            <Button size="xs" disabled={!dirty || m.isPending} onClick={() => setF(initial)}>
              Discard
            </Button>
            <Button size="xs" type="submit" variant="primary" disabled={!dirty || invalid} loading={m.isPending}>
              Save overtime
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-text-muted">Overtime is split out in the payroll export. Daily overtime is counted first; the weekly rule then applies to the remaining regular hours.</p>
          {err && !err.errors?.length && (
            <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
              {err.title}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Switch checked={f.daily.on} onCheckedChange={(v) => setF({ ...f, daily: { ...f.daily, on: v } })} label="Daily overtime" description="Hours past a threshold in one day." />
              <Field label="Daily overtime after (hours)" htmlFor="ot-daily" error={err?.field('daily_threshold_seconds') ?? dailyErr}>
                <Input id="ot-daily" type="number" min={1} max={24} step="any" inputMode="decimal" className="tabular" disabled={!f.daily.on} value={f.daily.hours} onChange={(e) => setF({ ...f, daily: { ...f.daily, hours: e.target.value } })} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <Switch checked={f.weekly.on} onCheckedChange={(v) => setF({ ...f, weekly: { ...f.weekly, on: v } })} label="Weekly overtime" description="Regular hours past a threshold in one week." />
              <Field label="Weekly overtime after (hours)" htmlFor="ot-weekly" error={err?.field('weekly_threshold_seconds') ?? weeklyErr}>
                <Input
                  id="ot-weekly"
                  type="number"
                  min={1}
                  max={168}
                  step="any"
                  inputMode="decimal"
                  className="tabular"
                  disabled={!f.weekly.on}
                  value={f.weekly.hours}
                  onChange={(e) =>
                    setF({
                      ...f,
                      weekly: { ...f.weekly, hours: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      </Panel>
    </form>
  );
}
