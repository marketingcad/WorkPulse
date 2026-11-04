'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Select, fmtDate, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { DOW_LONG, DOW_SHORT, orderedDows, timezoneOptions, type ScheduleDay, type ScheduleRow } from './shared';

interface DayDraft {
  enabled: boolean;
  start: string;
  end: string;
}

interface ScheduleBody {
  membership_id: string;
  name: string;
  timezone: string;
  days: ScheduleDay[];
  effective_from: string;
}

function draftFrom(s: ScheduleRow | undefined): DayDraft[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const d = s?.days.find((x) => x.dow === dow);
    if (s) return d ? { enabled: true, start: d.start, end: d.end } : { enabled: false, start: '09:00', end: '17:00' };
    return { enabled: dow >= 1 && dow <= 5, start: '09:00', end: '17:00' };
  });
}

export function scheduleSummary(s: ScheduleRow, weekStart: number): string {
  const byDow = orderedDows(weekStart)
    .map((dow) => ({ dow, shifts: s.days.filter((d) => d.dow === dow) }))
    .filter((x) => x.shifts.length);
  if (!byDow.length) return 'No working days';
  return byDow.map((x) => `${DOW_SHORT[x.dow]} ${x.shifts.map((sh) => `${sh.start}–${sh.end}`).join(', ')}`).join(' · ');
}

/** Current version = open-ended, else the latest effective one. */
export function currentSchedule(list: ScheduleRow[], today: string): ScheduleRow | undefined {
  const effective = list.filter((s) => s.effective_from <= today && (!s.effective_to || today < s.effective_to));
  return effective[effective.length - 1] ?? list.find((s) => !s.effective_to) ?? list[list.length - 1];
}

export function ScheduleEditor({ open, onOpenChange, member, schedules }: { open: boolean; onOpenChange: (o: boolean) => void; member: { id: string; name: string; timezone: string; tracking_enabled?: boolean }; schedules: ScheduleRow[] }) {
  const org = useOrg();
  const toast = useToast();
  const today = todayIn(member.timezone || org.organization.timezone);
  const current = currentSchedule(schedules, today);
  const [name, setName] = useState('Standard');
  const [timezone, setTimezone] = useState(member.timezone);
  const [days, setDays] = useState<DayDraft[]>(() => draftFrom(current));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [error, setError] = useState<ApiError | null>(null);
  const [toDelete, setToDelete] = useState<ScheduleRow | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(current?.name ?? 'Standard');
    setTimezone(current?.timezone ?? member.timezone ?? org.organization.timezone);
    setDays(draftFrom(current));
    setEffectiveFrom(today);
    setError(null);
    // Reset only when the dialog opens for a member.
  }, [open, member.id]);

  const save = useOrgMutation<ScheduleBody, ScheduleRow>('POST', '/schedules');
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/schedules/${b.id}`);

  const setDay = (dow: number, patch: Partial<DayDraft>) => setDays((xs) => xs.map((d, i) => (i === dow ? { ...d, ...patch } : d)));
  const invalidDay = days.findIndex((d) => d.enabled && d.end <= d.start);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        membership_id: member.id,
        name: name.trim() || 'Standard',
        timezone,
        days: days.flatMap((d, dow) => (d.enabled ? [{ dow, start: d.start, end: d.end }] : [])),
        effective_from: effectiveFrom,
      });
      toast.success(`Schedule saved for ${member.name}`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await del.mutateAsync({ id: toDelete.id });
      toast.success('Schedule version deleted');
      setToDelete(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Schedule · ${member.name}`}
        description="Saving creates a new schedule version from the effective date. Earlier days keep their previous schedule."
        width={620}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={save.isPending} disabled={invalidDay >= 0 || !effectiveFrom}>
              Save new version
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {member.tracking_enabled === false && (
            // Live, 28 Oct 2026: a schedule for someone who does not track time never showed in attendance, with no reason given.
            <p role="note" className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-text-muted">
              Time tracking is off for {member.name}, so attendance does not include them. Their schedule still sets the hours of their time off and paid holidays.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="sch-name" error={error?.field('name')}>
              <Input id="sch-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Time zone" htmlFor="sch-tz" error={error?.field('timezone')}>
              <Select id="sch-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezoneOptions(timezone, member.timezone, current?.timezone, org.organization.timezone).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective from" htmlFor="sch-from" required error={error?.field('effective_from')}>
              <Input id="sch-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
          </div>

          <fieldset className="rounded-md border border-border">
            <legend className="sr-only">Working days</legend>
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-border bg-surface-muted/60 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
              <span>Day</span>
              <span className="w-28">Start</span>
              <span className="w-28">End</span>
            </div>
            <ul className="divide-y divide-border">
              {orderedDows(org.organization.week_start).map((dow) => {
                const d = days[dow]!;
                const bad = d.enabled && d.end <= d.start;
                return (
                  <li key={dow} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3 py-1.5">
                    <Checkbox label={DOW_LONG[dow]} checked={d.enabled} onChange={(e) => setDay(dow, { enabled: e.target.checked })} />
                    <Input type="time" aria-label={`${DOW_LONG[dow]} start`} className="w-28" value={d.start} disabled={!d.enabled} onChange={(e) => setDay(dow, { start: e.target.value })} aria-invalid={bad} />
                    <Input type="time" aria-label={`${DOW_LONG[dow]} end`} className="w-28" value={d.end} disabled={!d.enabled} onChange={(e) => setDay(dow, { end: e.target.value })} aria-invalid={bad} />
                  </li>
                );
              })}
            </ul>
            {invalidDay >= 0 && (
              <p role="alert" className="border-t border-border px-3 py-1.5 text-xs text-danger">
                {DOW_LONG[invalidDay]}: the shift must end after it starts. Split overnight shifts across two days.
              </p>
            )}
            {error?.field('days') && <p className="border-t border-border px-3 py-1.5 text-xs text-danger">{error.field('days')}</p>}
          </fieldset>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Versions</h3>
            {schedules.length === 0 ? (
              <div className="rounded-md border border-border">
                <EmptyState title="No schedule yet" description="Save the form above to create the first version." className="py-6" />
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {[...schedules].reverse().map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <span className="tabular text-xs text-text-muted">
                          {fmtDate(s.effective_from)} → {s.effective_to ? fmtDate(s.effective_to) : 'ongoing'}
                        </span>
                        {s.id === current?.id && <Badge tone="brand">Current</Badge>}
                      </div>
                      <div className="truncate text-xs text-text-muted">
                        {s.timezone.replace(/_/g, ' ')} · {scheduleSummary(s, org.organization.week_start)}
                      </div>
                    </div>
                    <IconButton label={`Delete version from ${fmtDate(s.effective_from)}`} size="xs" onClick={() => setToDelete(s)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete schedule version?"
        description={toDelete ? `The version starting ${fmtDate(toDelete.effective_from)} will be removed. Attendance for those days will be recalculated without it.` : undefined}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
