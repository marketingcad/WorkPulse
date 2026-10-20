'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { OrgContextDto } from '@tallywork/contracts';
import { Button, Field, Input, PageHeader, Panel, Select, Switch, Textarea, fmtDuration, useToast } from '@tallywork/ui';
import { ApiError, useOrgMutation } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { CURRENCIES, WEEKDAYS, timeZones } from '@/components/settings/options';
import { LANGUAGES, LogoEditor } from '@/components/workspace/logo-editor';
import { hoursToSeconds, secondsToHours } from '@/components/workspace/shared';

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
  logo: string;
  brief: string;
  tax_id: string;
  address: string;
  phone: string;
  email: string;
  document_language: string;
  /** '' = off */
  lockDays: string;
  lockDate: string;
  /** hours, '' = none */
  minDaily: string;
  minWeekly: string;
  reminder: boolean;
  checkAt: string;
  hoursPerDay: string;
}

interface RuleSettings {
  lockAfterDays: number | null;
  lockBeforeDate: string | null;
  minDailySeconds: number | null;
  minWeeklySeconds: number | null;
  missingTimeReminder: boolean;
  missingTimeCheckAt: string;
  workingHoursPerDay: number;
}

/** Which settings page: who the organization is, or how time and pay work. */
export type OrgSettingsPart = 'organization' | 'time';

/** The form fields each page edits (and compares to tell whether it has unsaved changes). */
const FIELDS: Record<OrgSettingsPart, Array<keyof Form>> = {
  organization: ['name', 'timezone', 'week_start', 'currency', 'durationFormat', 'logo', 'brief', 'tax_id', 'address', 'phone', 'email', 'document_language'],
  time: ['payType', 'anchorDate', 'hoursPerDay', 'lockDays', 'lockDate', 'minDaily', 'minWeekly', 'reminder', 'checkAt', 'lateGraceMinutes', 'budgetWarnPct'],
};

function fromOrg(o: OrgContextDto['organization']): Form {
  const s = o.settings as Partial<{ lateGraceMinutes: number; durationFormat: DurationFormat; budgetWarnPct: number } & RuleSettings>;
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
    logo: o.logo ?? '',
    brief: o.brief ?? '',
    tax_id: o.tax_id ?? '',
    address: o.address ?? '',
    phone: o.phone ?? '',
    email: o.email ?? '',
    document_language: o.document_language ?? '',
    lockDays: s.lockAfterDays == null ? '' : String(s.lockAfterDays),
    lockDate: s.lockBeforeDate ?? '',
    minDaily: secondsToHours(s.minDailySeconds),
    minWeekly: secondsToHours(s.minWeeklySeconds),
    reminder: s.missingTimeReminder ?? false,
    checkAt: s.missingTimeCheckAt ?? '18:00',
    hoursPerDay: String(s.workingHoursPerDay ?? 8),
  };
}

/**
 * One page of the organization's own settings. Each page saves only its own fields (the server
 * merges `settings`), so saving one page never touches the other's values.
 */
export function OrgSettingsForm({ part, title, description }: { part: OrgSettingsPart; title: string; description: string }) {
  const org = useOrg();
  const toast = useToast();
  const initial = useMemo(() => fromOrg(org.organization), [org.organization]);
  const [f, setF] = useState<Form>(initial);
  useEffect(() => setF(initial), [initial]);
  const dirty = FIELDS[part].some((k) => f[k] !== initial[k]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const zones = useMemo(() => timeZones(f.timezone), [f.timezone]);

  const m = useOrgMutation<Record<string, unknown>, OrgContextDto>('PATCH', '/', { onSuccess: () => toast.success(part === 'organization' ? 'Organization settings saved' : 'Time & pay settings saved') });
  const err = m.error instanceof ApiError ? m.error : null;

  const submit = () => {
    if (part === 'organization') {
      m.mutate({
        name: f.name.trim(),
        timezone: f.timezone,
        week_start: f.week_start,
        currency: f.currency,
        logo: f.logo || null,
        brief: f.brief.trim() || null,
        tax_id: f.tax_id.trim() || null,
        address: f.address.trim() || null,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        document_language: f.document_language || null,
        settings: { durationFormat: f.durationFormat },
      });
      return;
    }
    const pay_period = f.payType === 'biweekly' ? { type: 'biweekly', anchorDate: f.anchorDate } : { type: f.payType };
    m.mutate({
      pay_period,
      settings: {
        lateGraceMinutes: f.lateGraceMinutes,
        budgetWarnPct: f.budgetWarnPct,
        lockAfterDays: f.lockDays.trim() === '' ? null : Math.round(Number(f.lockDays)),
        lockBeforeDate: f.lockDate || null,
        minDailySeconds: hoursToSeconds(f.minDaily),
        minWeeklySeconds: hoursToSeconds(f.minWeekly),
        missingTimeReminder: f.reminder,
        missingTimeCheckAt: f.checkAt,
        workingHoursPerDay: Number(f.hoursPerDay),
      } satisfies Record<string, unknown> & RuleSettings,
    });
  };
  const hoursBad = (v: string, max: number) => v.trim() !== '' && !(Number(v) >= 0 && Number(v) <= max);
  const lockDaysBad = f.lockDays.trim() !== '' && !(Number.isInteger(Number(f.lockDays)) && Number(f.lockDays) >= 0 && Number(f.lockDays) <= 3650);
  const reminderBad = f.reminder && hoursToSeconds(f.minDaily) === null && hoursToSeconds(f.minWeekly) === null;
  const invalid =
    part === 'organization'
      ? !f.name.trim()
      : (f.payType === 'biweekly' && !f.anchorDate) ||
        f.lateGraceMinutes < 0 ||
        f.lateGraceMinutes > 240 ||
        f.budgetWarnPct < 1 ||
        f.budgetWarnPct > 100 ||
        lockDaysBad ||
        hoursBad(f.minDaily, 24) ||
        hoursBad(f.minWeekly, 168) ||
        reminderBad ||
        !(Number(f.hoursPerDay) >= 1 && Number(f.hoursPerDay) <= 24) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.checkAt);
  const num = (v: string) => (v === '' ? 0 : Math.round(Number(v)));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) submit();
  };

  return (
    <>
      <PageHeader
        title={title}
        description={description}
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
      <form id="org-settings" onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
        {part === 'organization' ? (
          <>
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

            <Panel title="Company profile">
              <p className="px-4 pt-4 text-sm text-text-muted">Printed on the invoices you send to clients.</p>
              <div className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-[132px_1fr]">
                <LogoEditor label="Company logo" format="png" value={f.logo} onChange={(logo) => set('logo', logo)} name={f.name} error={err?.field('logo')} />
                <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2">
                  <Field label="Company brief" htmlFor="org-brief" hint="A few words about the company." error={err?.field('brief')} className="sm:col-span-2">
                    <Input id="org-brief" value={f.brief} maxLength={300} onChange={(e) => set('brief', e.target.value)} />
                  </Field>
                  <Field label="Tax ID" htmlFor="org-tax" error={err?.field('tax_id')}>
                    <Input id="org-tax" value={f.tax_id} maxLength={50} onChange={(e) => set('tax_id', e.target.value)} />
                  </Field>
                  <Field label="Phone number" htmlFor="org-phone" error={err?.field('phone')}>
                    <Input id="org-phone" type="tel" value={f.phone} maxLength={50} onChange={(e) => set('phone', e.target.value)} />
                  </Field>
                  <Field label="Email" htmlFor="org-email" error={err?.field('email')}>
                    <Input id="org-email" type="email" value={f.email} maxLength={254} onChange={(e) => set('email', e.target.value)} placeholder="billing@company.com" />
                  </Field>
                  <Field label="Document language" htmlFor="org-lang" hint="Default for new clients." error={err?.field('document_language')}>
                    <Select id="org-lang" value={f.document_language} onChange={(e) => set('document_language', e.target.value)}>
                      <option value="">Not set</option>
                      {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Full address" htmlFor="org-address" error={err?.field('address')} className="sm:col-span-2">
                    <Textarea id="org-address" value={f.address} maxLength={500} onChange={(e) => set('address', e.target.value)} className="min-h-16" />
                  </Field>
                </div>
              </div>
            </Panel>
          </>
        ) : (
          <>
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
                <Field label="Working hours per day" htmlFor="org-hpd" hint="Converts hours and days, e.g. for project estimates." error={err?.field('settings.workingHoursPerDay') ?? (!(Number(f.hoursPerDay) >= 1 && Number(f.hoursPerDay) <= 24) ? '1 to 24 hours' : undefined)}>
                  <Input id="org-hpd" type="number" min={1} max={24} step={0.5} inputMode="decimal" className="tabular" value={f.hoursPerDay} onChange={(e) => set('hoursPerDay', e.target.value)} />
                </Field>
              </div>
            </Panel>

            <Panel title="Timesheet rules">
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <Field label="Lock time older than (days)" htmlFor="org-lock-days" hint="Members can't add, edit or delete their own time before this many days ago. 0 = only today. Empty = no lock. Managers can still change it." error={err?.field('settings.lockAfterDays') ?? (lockDaysBad ? 'Whole days from 0 to 3650' : undefined)}>
                  <Input id="org-lock-days" type="number" min={0} max={3650} step={1} inputMode="numeric" className="tabular" value={f.lockDays} onChange={(e) => set('lockDays', e.target.value)} />
                </Field>
                <Field label="Lock time before" htmlFor="org-lock-date" hint="A fixed date, e.g. after closing a payroll. The later of the two locks applies." error={err?.field('settings.lockBeforeDate')}>
                  <Input id="org-lock-date" type="date" value={f.lockDate} onChange={(e) => set('lockDate', e.target.value)} />
                </Field>
                <Field label="Minimum hours per working day" htmlFor="org-min-day" hint="Leave empty for no daily minimum. Maximums are set in Tracking policies." error={err?.field('settings.minDailySeconds') ?? (hoursBad(f.minDaily, 24) ? '0 to 24 hours' : undefined)}>
                  <Input id="org-min-day" type="number" min={0} max={24} step={0.25} inputMode="decimal" className="tabular" value={f.minDaily} onChange={(e) => set('minDaily', e.target.value)} />
                </Field>
                <Field label="Minimum hours per week" htmlFor="org-min-week" hint="Checked on the last working day of the week." error={err?.field('settings.minWeeklySeconds') ?? (hoursBad(f.minWeekly, 168) ? '0 to 168 hours' : undefined)}>
                  <Input id="org-min-week" type="number" min={0} max={168} step={0.5} inputMode="decimal" className="tabular" value={f.minWeekly} onChange={(e) => set('minWeekly', e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Switch
                    checked={f.reminder}
                    onCheckedChange={(v) => set('reminder', v)}
                    label="Remind members about missing time"
                    description="On working days, members under a minimum get a notification and an email. Weekends, holidays and approved time off are skipped."
                  />
                  {reminderBad && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      Set a daily or weekly minimum for reminders.
                    </p>
                  )}
                </div>
                {f.reminder && (
                  <Field label="Check at" htmlFor="org-check-at" hint={`Local time in ${f.timezone.replace(/_/g, ' ')}.`} error={err?.field('settings.missingTimeCheckAt')}>
                    <Input id="org-check-at" type="time" value={f.checkAt} onChange={(e) => set('checkAt', e.target.value)} />
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
          </>
        )}
      </form>
    </>
  );
}
