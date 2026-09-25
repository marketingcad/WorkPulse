'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MeDto, WorkerDto } from '@tallywork/contracts';
import { resolveRange, type ReportRange } from '@tallywork/domain';
import { Button, Checkbox, Dialog, Field, Input, SegmentedControl, Select, Switch, useToast } from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { timeZones } from '@/components/settings/options';
import { MultiSelect } from './multi-select';
import type { SavedReport } from './format';
import { DEFAULT_SCHEDULE, EXPORT_FORMATS, RANGES, buildCron, isRange, parseSchedule, type ExportFormat, type Frequency, type Schedule } from './schedule';

interface SavedReportBody {
  report_key: string;
  name: string;
  params: Record<string, unknown>;
  shared: boolean;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  recipients: string[];
}

type RangeMode = 'fixed' | ReportRange;
const PRESET_RANGE: Record<string, ReportRange> = { this_week: 'this_week', last_week: 'last_week', this_month: 'this_month', last_month: 'last_month', last_30: 'last_30_days' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Service validation errors carry the field only in `detail`, so fall back to matching the
 * title; zod errors arrive as `errors[]` (e.g. `recipients.0`).
 */
function fieldError(err: ApiError | null, field: string, match?: RegExp): string | undefined {
  if (!err) return undefined;
  return err.field(field) ?? err.errors?.find((e) => e.field.startsWith(`${field}.`))?.message ?? (match && !err.errors?.length && match.test(err.title) ? err.title : undefined);
}

/**
 * Create (or, with `existing`, edit) a saved report: date range fixed or relative, and an
 * optional emailed schedule. `params` are the report's current filters.
 */
export function SaveReportDialog({ open, onOpenChange, reportKey, defaultName, params, existing }: { open: boolean; onOpenChange: (o: boolean) => void; reportKey: string; defaultName: string; params: Record<string, unknown>; existing?: SavedReport | null }) {
  const org = useOrg();
  const toast = useToast();
  const orgTz = org.organization.timezone;
  const ws = org.organization.week_start;
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me'), enabled: open });
  const workersQ = useOrgQuery<WorkerDto[]>(open && org.can('members:read') ? '/workers' : null);
  const myEmail = meQ.data?.user.email;

  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);
  const [range, setRange] = useState<RangeMode>('fixed');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [freq, setFreq] = useState<Frequency | 'custom'>('weekly');
  const [sched, setSched] = useState<Schedule>(DEFAULT_SCHEDULE);
  const [cronText, setCronText] = useState('');
  const [tz, setTz] = useState(orgTz);
  const [format, setFormat] = useState<ExportFormat>('CSV');
  const [recipients, setRecipients] = useState<string[]>([]);

  // Reset from the saved report (edit) or the current filters (new) each time it opens.
  useEffect(() => {
    if (!open) return;
    const p = existing?.params ?? params;
    const mode: RangeMode = isRange(p.range) ? p.range : typeof p.preset === 'string' && PRESET_RANGE[p.preset] ? PRESET_RANGE[p.preset]! : 'fixed';
    const dates = typeof p.from === 'string' && typeof p.to === 'string' ? { from: p.from, to: p.to } : resolveRange(mode === 'fixed' ? 'this_week' : mode, todayIn(orgTz), ws);
    const parsed = parseSchedule(existing?.schedule_cron);
    setName(existing?.name ?? defaultName);
    setShared(existing?.shared ?? false);
    setRange(mode);
    setFrom(dates.from);
    setTo(dates.to);
    setScheduled(!!existing?.schedule_cron);
    setFreq(existing?.schedule_cron && !parsed ? 'custom' : (parsed?.frequency ?? 'weekly'));
    setSched(parsed ?? DEFAULT_SCHEDULE);
    setCronText(existing?.schedule_cron ?? '');
    setTz(existing?.schedule_timezone ?? orgTz);
    setFormat(p.format === 'XLSX' || p.format === 'PDF' ? p.format : 'CSV');
    setRecipients(existing?.recipients ?? []);
    m.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  // New schedules go to the author by default.
  useEffect(() => {
    if (scheduled && !recipients.length && myEmail)setRecipients([myEmail]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduled, myEmail]);

  const recipientOptions = useMemo(() => {
    const members = (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE').map((w) => ({ value: w.email, label: w.name, sub: w.email }));
    const known = new Set(members.map((o) => o.value.toLowerCase()));
    // Without the member list (not a manager), offer your own address and keep any already chosen.
    const extra = [...(myEmail ? [myEmail] : []), ...recipients].filter((e, i, a) => !known.has(e.toLowerCase()) && a.indexOf(e) === i).map((e) => ({ value: e, label: e === myEmail ? `${e} (you)` : e }));
    return [...members, ...extra];
  }, [workersQ.data, myEmail, recipients]);
  const zones = useMemo(() => timeZones(tz), [tz]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => (ws + i) % 7).map((d) => ({ value: String(d), label: DAYS[d]! })), [ws]);

  const m = useOrgMutation<SavedReportBody, SavedReport>(existing ? 'PUT' : 'POST', existing ? `/saved-reports/${existing.id}` : '/saved-reports', {
    onSuccess: () => {
      toast.success(existing ? 'Saved report updated' : 'Report saved');
      onOpenChange(false);
    },
  });
  const err = m.error instanceof ApiError ? m.error : null;

  const cron = scheduled ? (freq === 'custom' ? cronText.trim() : buildCron({ ...sched, frequency: freq })) : null;
  const fixedInvalid = range === 'fixed' && (!from || !to || from > to);
  const canSave = !!name.trim() && !fixedInvalid && (!scheduled || (!!cron && /^\d{2}:\d{2}$/.test(sched.time)));

  const submit = () => {
    if (!canSave) return;
    const { from: _f, to: _t, preset: _p, range: _r, format: _fmt, ...filters } = existing?.params ?? params;
    const next: Record<string, unknown> = range === 'fixed' ? { ...filters, from, to, preset: 'custom' } : { ...filters, range };
    if (scheduled) next.format = format;
    m.mutate(
      { report_key: reportKey, name: name.trim(), params: next, shared, schedule_cron: cron, schedule_timezone: scheduled ? tz : null, recipients: scheduled ? recipients : [] },
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title={existing ? 'Edit saved report' : 'Save report'}
      description="Saves the filters. A relative range is worked out again each time the report is opened or sent."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!canSave} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" htmlFor="saved-name" error={fieldError(err, 'name')} required>
          <Input id="saved-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Date range" htmlFor="saved-range" error={fieldError(err, 'params', /report parameters/i) ?? (range === 'fixed' && from && to && from > to ? 'The start must be on or before the end' : undefined)}>
          <div className="flex flex-wrap items-center gap-2">
            <Select id="saved-range" className="w-60" value={range} onChange={(e) => setRange(e.target.value as RangeMode)}>
              <option value="fixed">{existing ? 'Fixed dates' : 'Fixed dates (current filters)'}</option>
              <optgroup label="Relative to the day it runs">
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            {range === 'fixed' && (
              <>
                <Input type="date" aria-label="From" className="w-36" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <span className="text-text-faint">–</span>
                <Input type="date" aria-label="To" className="w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
          </div>
        </Field>
        <div>
          <Checkbox label="Share with everyone who can run this report" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <p className="mt-1 text-xs text-text-muted">Shared reports only show data each viewer is allowed to see.</p>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Switch checked={scheduled} onCheckedChange={setScheduled} label="Email on a schedule" description="Recipients get a download link. Each run uses your access at the time it is sent." />
          {scheduled && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Frequency" htmlFor="sched-freq">
                  <Select id="sched-freq" className="w-32" value={freq} onChange={(e) => setFreq(e.target.value as Frequency | 'custom')}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    {freq === 'custom' && <option value="custom">Custom (cron)</option>}
                  </Select>
                </Field>
                {freq === 'monthly' && (
                  <Field label="Day of month" htmlFor="sched-day">
                    <Select id="sched-day" className="w-24" value={sched.day} onChange={(e) => setSched((s) => ({ ...s, day: Number(e.target.value) }))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {freq === 'custom' ? (
                  <Field label="Cron" htmlFor="sched-cron" hint="minute hour day month weekday" error={fieldError(err, 'schedule_cron', /cron/i)}>
                    <Input id="sched-cron" className="tabular w-44" value={cronText} onChange={(e) => setCronText(e.target.value)} />
                  </Field>
                ) : (
                  <Field label="Time" htmlFor="sched-time" error={fieldError(err, 'schedule_cron', /cron/i)}>
                    <Input id="sched-time" type="time" className="tabular w-28" value={sched.time} onChange={(e) => setSched((s) => ({ ...s, time: e.target.value }))} />
                  </Field>
                )}
              </div>
              {freq === 'weekly' && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text-muted">Day of week</span>
                  <SegmentedControl size="xs" label="Day of week" value={String(sched.weekday)} onChange={(v) => setSched((s) => ({ ...s, weekday: Number(v) }))} options={weekdays} />
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Time zone" htmlFor="sched-tz" error={fieldError(err, 'schedule_timezone')} className="min-w-0 flex-1">
                  <Select id="sched-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z === orgTz ? `${z} (organization)` : z}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Format" htmlFor="sched-format">
                  <Select id="sched-format" className="w-36" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                    {EXPORT_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Recipients" hint="Members of this organization only, up to 20." error={fieldError(err, 'recipients', /recipient/i)} required>
                <div>
                  <MultiSelect label="Send to" allLabel="Nobody" options={recipientOptions} value={recipients} onChange={(v) => setRecipients(v.slice(0, 20))} loading={workersQ.isLoading || meQ.isLoading} />
                </div>
              </Field>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
