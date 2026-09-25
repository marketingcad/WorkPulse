'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { OrgContextDto } from '@tallywork/contracts';
import Link from 'next/link';
import { Button, Field, Input, PageHeader, Panel, PermissionState, Select, fmtDuration, useToast } from '@tallywork/ui';
import { ApiError, useOrgMutation } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { CURRENCIES, WEEKDAYS, timeZones } from '@/components/settings/options';
import { BreakTypesPanel } from '@/components/settings/break-types-panel';
import { OvertimePanel } from '@/components/settings/overtime-panel';

type DurationFormat = 'hm' | 'clock' | 'decimal';
type PayType = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
interface Form {
  name: string;
  timezone: string;
  week_start: number;
  currency: string;
  payType: PayType;
  anchorDate: string;
  durationFormat: DurationFormat;
  lateGraceMinutes: number;
  budgetWarnPct: number;
}

function fromOrg(o: OrgContextDto['organization']): Form {
  const s = o.settings as Partial<{ lateGraceMinutes: number; durationFormat: DurationFormat; budgetWarnPct: number }>;
  const pp = (o.pay_period ?? { type: 'weekly' }) as { type?: PayType; anchorDate?: string };
  return {
    name: o.name,
    timezone: o.timezone,
    week_start: o.week_start,
    currency: o.currency,
    payType: pp.type ?? 'weekly',
    anchorDate: pp.anchorDate ?? '',
    durationFormat: s.durationFormat ?? 'hm',
    lateGraceMinutes: s.lateGraceMinutes ?? 5,
    budgetWarnPct: s.budgetWarnPct ?? 80,
  };
}

export default function OrgSettingsPage() {
  const org = useOrg();
  const toast = useToast();
  const initial = useMemo(() => fromOrg(org.organization), [org.organization]);
  const [f, setF] = useState<Form>(initial);
  useEffect(() => setF(initial), [initial]);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const zones = useMemo(() => timeZones(f.timezone), [f.timezone]);

  const m = useOrgMutation<Record<string, unknown>, OrgContextDto>('PATCH', '/', { onSuccess: () => toast.success('Organization settings saved') });
  const err = m.error instanceof ApiError ? m.error : null;

  if (!org.can('org:update')) return <PermissionState />;

  const submit = () => {
    const pay_period = f.payType === 'biweekly' ? { type: 'biweekly', anchorDate: f.anchorDate } : { type: f.payType };
    m.mutate({
      name: f.name.trim(),
      timezone: f.timezone,
      week_start: f.week_start,
      currency: f.currency,
      pay_period,
      settings: {
        durationFormat: f.durationFormat,
        lateGraceMinutes: f.lateGraceMinutes,
        budgetWarnPct: f.budgetWarnPct,
      },
    });
  };
  const invalid = !f.name.trim() || (f.payType === 'biweekly' && !f.anchorDate) || f.lateGraceMinutes < 0 || f.lateGraceMinutes > 240 || f.budgetWarnPct < 1 || f.budgetWarnPct > 100;
  const num = (v: string) => (v === '' ? 0 : Math.round(Number(v)));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) submit();
  };

  return (
    <>
      <PageHeader
        title="Organization"
        description="Defaults that apply to everyone in this organization."
        actions={
          <>
            <Button disabled={!dirty || m.isPending} onClick={() => setF(initial)}>
              Discard
            </Button>
            <Button type="submit" form="org-settings" variant="primary" disabled={!dirty || invalid} loading={m.isPending}>
              Save changes
            </Button>
          </>
        }
      />
      {err && !err.errors?.length && (
        <p role="alert" className="mb-4 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {err.title}
        </p>
      )}
      <div className="flex max-w-3xl flex-col gap-4">
        <form id="org-settings" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Panel title="General">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field label="Organization name" htmlFor="org-name" error={err?.field('name')} required className="sm:col-span-2">
                <Input id="org-name" value={f.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Time zone" htmlFor="org-tz" hint="Used for days, weeks, pay periods and attendance." error={err?.field('timezone')}>
                <Select id="org-tz" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Week starts on" htmlFor="org-ws">
                <Select id="org-ws" value={f.week_start} onChange={(e) => set('week_start', Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency" htmlFor="org-cur" hint="Default for rates, invoices and reports." error={err?.field('currency')}>
                <Select id="org-cur" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                  {[...new Set([f.currency, ...CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration format" htmlFor="org-df" hint={`7 hours 45 minutes shows as ${fmtDuration(27900, f.durationFormat)}`}>
                <Select id="org-df" value={f.durationFormat} onChange={(e) => set('durationFormat', e.target.value as DurationFormat)}>
                  <option value="hm">Hours and minutes (7h 45m)</option>
                  <option value="clock">Clock (7:45)</option>
                  <option value="decimal">Decimal (7.75)</option>
                </Select>
              </Field>
            </div>
          </Panel>

          <Panel title="Pay period">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field label="Pay period" htmlFor="org-pp" hint="Timesheets are submitted and approved per pay period.">
                <Select id="org-pp" value={f.payType} onChange={(e) => set('payType', e.target.value as PayType)}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="semimonthly">Twice a month (1st–15th, 16th–end)</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              {f.payType === 'biweekly' && (
                <Field label="First day of a pay period" htmlFor="org-anchor" hint="Any past start date; periods repeat every 14 days from it." error={err?.field('pay_period.anchorDate') ?? (!f.anchorDate ? 'Pick an anchor date' : undefined)} required>
                  <Input id="org-anchor" type="date" value={f.anchorDate} onChange={(e) => set('anchorDate', e.target.value)} />
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="Attendance & budgets">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field label="Late grace period (minutes)" htmlFor="org-late" hint="Starting within this many minutes of a shift is not marked late." error={err?.field('settings.lateGraceMinutes')}>
                <Input id="org-late" type="number" min={0} max={240} className="tabular" value={f.lateGraceMinutes} onChange={(e) => set('lateGraceMinutes', num(e.target.value))} />
              </Field>
              <Field label="Budget warning at (%)" htmlFor="org-budget" hint="Budgets turn to warning when this share is used." error={err?.field('settings.budgetWarnPct')}>
                <Input id="org-budget" type="number" min={1} max={100} className="tabular" value={f.budgetWarnPct} onChange={(e) => set('budgetWarnPct', num(e.target.value))} />
              </Field>
            </div>
          </Panel>
        </form>

        <OvertimePanel />
        <BreakTypesPanel />

        {/* Two-factor, session lifetime, device approval and the IP allowlist are edited on the Security page (they need settings:security). */}
        {(org.can('settings:security') || org.can('retention:manage')) && (
          <Panel title="Security">
            <p className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-text-muted">
              Two-factor requirements, session lifetime, device approval and allowed networks.
              <Link href={`${org.base}/settings/security`} className="font-medium text-interactive hover:underline">
                Security & retention →
              </Link>
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}
