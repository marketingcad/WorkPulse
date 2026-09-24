'use client';
import { useMemo, useState } from 'react';
import { CalendarOff, Pencil } from 'lucide-react';
import type { WorkerDto } from '@tallywork/contracts';
import { Badge, Button, EmptyState, ErrorState, FilterBar, Input, PageHeader, Panel, PermissionState, PersonCell, SkeletonRows, cx, fmtDate } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { DateStepper, dateRangeLabel, wallTime, type HolidayRow, type ScheduleRow, type ShiftInstance, type TimeOffRequest } from '@/components/people/shared';
import { ScheduleEditor, currentSchedule, scheduleSummary } from '@/components/people/schedule-editor';

interface Member {
  id: string;
  name: string;
  timezone: string;
  title: string | null;
}

export default function SchedulesPage() {
  const org = useOrg();
  const tz = org.membership.timezone || org.organization.timezone;
  const today = todayIn(tz);
  const ws = org.organization.week_start;
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today, ws));
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Member | null>(null);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const allowed = org.can('schedules:read');
  const teamView = allowed && org.grants['schedules:read'] !== 'own';
  const canManage = org.can('schedules:manage');
  const me = org.membership.id;

  const workersQ = useOrgQuery<WorkerDto[]>(allowed ? '/workers' : null);
  const shiftsQ = useOrgQuery<ShiftInstance[]>(allowed ? `/shifts${qs({ from: weekStart, to: weekEnd, membership_ids: teamView ? undefined : [me] })}` : null);
  const schedulesQ = useOrgQuery<ScheduleRow[]>(allowed ? `/schedules${qs({ membership_ids: teamView ? undefined : [me] })}` : null);
  const leaveQ = useOrgQuery<TimeOffRequest[]>(org.can('time_off:read') ? `/time-off/requests${qs({ status: 'APPROVED', from: weekStart, to: weekEnd, membership_ids: teamView ? undefined : [me] })}` : null);
  const holidaysQ = useOrgQuery<HolidayRow[]>(allowed ? '/holidays' : null);

  const members: Member[] = useMemo(() => {
    const list = (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE' && (teamView || w.id === me));
    const fromWorkers = list.map((w) => ({ id: w.id, name: w.name, timezone: w.timezone, title: w.title }));
    // Fall back to names on schedules / shifts if the member list is narrower than schedule visibility.
    const known = new Set(fromWorkers.map((m) => m.id));
    for (const s of schedulesQ.data ?? []) {
      if (!known.has(s.membership_id) && (teamView || s.membership_id === me)) {
        known.add(s.membership_id);
        fromWorkers.push({ id: s.membership_id, name: s.worker_name || 'Member', timezone: s.timezone, title: null });
      }
    }
    const needle = search.trim().toLowerCase();
    return fromWorkers.filter((m) => !needle || m.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
  }, [workersQ.data, schedulesQ.data, teamView, me, search]);

  const schedulesBy = useMemo(() => {
    const m = new Map<string, ScheduleRow[]>();
    for (const s of schedulesQ.data ?? []) m.set(s.membership_id, [...(m.get(s.membership_id) ?? []), s]);
    return m;
  }, [schedulesQ.data]);

  /** Time zone to display a member's shift in: the schedule in effect that day. */
  const shiftTz = (memberId: string, date: string, fallback: string) => {
    const list = schedulesBy.get(memberId) ?? [];
    const s = list.find((x) => x.effective_from <= date && (!x.effective_to || date < x.effective_to));
    return s?.timezone ?? fallback;
  };

  const holidayByDate = useMemo(() => new Map((holidaysQ.data ?? []).map((h) => [h.date, h])), [holidaysQ.data]);
  const shiftsByKey = useMemo(() => {
    const m = new Map<string, ShiftInstance[]>();
    for (const s of shiftsQ.data ?? []) {
      const k = `${s.membership_id}:${s.date}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    for (const list of m.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return m;
  }, [shiftsQ.data]);
  const leaveFor = (memberId: string, date: string) => (leaveQ.data ?? []).find((r) => r.membership_id === memberId && r.start_date <= date && r.end_date >= date);

  const loading = workersQ.isLoading || shiftsQ.isLoading || schedulesQ.isLoading;
  const error = workersQ.error ?? shiftsQ.error ?? schedulesQ.error;

  if (!allowed)
    return (
      <>
        <PageHeader title="Schedules" />
        <Panel>
          <PermissionState />
        </Panel>
      </>
    );

  const title = teamView ? 'Schedules' : 'My schedule';
  const myCurrent = currentSchedule(schedulesBy.get(me) ?? [], today);

  return (
    <>
      <PageHeader
        title={title}
        description={teamView ? 'Planned shifts for your team. Attendance compares tracked time against these schedules.' : 'Your planned working hours. Attendance compares your tracked time against this schedule.'}
      />
      <FilterBar>
        <DateStepper
          value={weekStart}
          onChange={(v) => setWeekStart(weekStartOf(v, ws))}
          step={(dir) => setWeekStart(addDays(weekStart, dir * 7))}
          today={weekStartOf(today, ws)}
          label="Week"
          todayLabel="This week"
        />
        <span className="tabular text-sm text-text-muted">{dateRangeLabel(weekStart, weekEnd)}</span>
        {teamView && (
          <Input type="search" placeholder="Search members…" aria-label="Search members" className="ml-auto w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
      </FilterBar>

      <Panel
        title="Week"
        footer={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-[2px] border border-interactive/30 bg-interactive-soft" aria-hidden /> Shift (member&apos;s schedule time zone)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarOff className="size-3.5 text-info" aria-hidden /> Approved time off
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-[2px] bg-surface-sunken" aria-hidden /> Holiday
            </span>
          </span>
        }
      >
        {error ? (
          <ErrorState error={error} onRetry={() => (workersQ.refetch(), shiftsQ.refetch(), schedulesQ.refetch())} />
        ) : loading ? (
          <SkeletonRows cols={8} />
        ) : members.length === 0 ? (
          <EmptyState title={search ? 'No matching members' : 'No members to schedule'} description={search ? 'Try a different search.' : 'Invite members to plan their shifts here.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <caption className="sr-only">Shifts for the week of {dateRangeLabel(weekStart, weekEnd)}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-muted/60">
                  <th scope="col" className="sticky left-0 z-10 w-56 bg-surface-muted px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-text-muted">
                    Member
                  </th>
                  {days.map((d) => {
                    const h = holidayByDate.get(d);
                    return (
                      <th key={d} scope="col" className={cx('px-2 py-2 text-left align-top text-2xs font-semibold uppercase tracking-wide', d === today ? 'text-interactive' : 'text-text-muted', h && 'bg-surface-sunken')}>
                        <div>{fmtDate(d, { weekday: 'short' })}</div>
                        <div className="tabular text-xs font-medium normal-case tracking-normal">{fmtDate(d, { month: 'short', day: 'numeric' })}</div>
                        {h && (
                          <div className="mt-0.5 truncate text-2xs font-medium normal-case tracking-normal text-text-muted" title={h.name}>
                            Holiday · {h.name}
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="px-3 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-text-muted">
                    Planned
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => {
                  const hasSchedule = (schedulesBy.get(m.id) ?? []).length > 0;
                  let plannedSeconds = 0;
                  return (
                    <tr key={m.id} className="group align-top">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal group-hover:bg-surface-muted">
                        <div className="flex items-center justify-between gap-2">
                          <PersonCell name={m.name} sub={hasSchedule ? m.title ?? undefined : 'No schedule'} />
                          {canManage && (
                            <Button size="xs" variant="ghost" icon={<Pencil className="size-3" />} onClick={() => setEditing(m)} aria-label={`Edit schedule for ${m.name}`}>
                              Edit
                            </Button>
                          )}
                        </div>
                      </th>
                      {days.map((d) => {
                        const list = shiftsByKey.get(`${m.id}:${d}`) ?? [];
                        const leave = leaveFor(m.id, d);
                        const holiday = holidayByDate.get(d);
                        const zone = shiftTz(m.id, d, m.timezone);
                        for (const s of list) plannedSeconds += (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 1000;
                        return (
                          <td key={d} className={cx('px-2 py-2', holiday && 'bg-surface-sunken/70', d === today && !holiday && 'bg-interactive-soft/30')}>
                            <div className="flex flex-col gap-1">
                              {list.map((s) => (
                                <span
                                  key={s.starts_at}
                                  className={cx('tabular inline-flex w-fit items-center rounded-[3px] border px-1.5 py-0.5 text-xs font-medium', leave || holiday ? 'border-border text-text-faint line-through' : 'border-interactive/30 bg-interactive-soft text-interactive')}
                                  title={`${wallTime(s.starts_at, zone)}–${wallTime(s.ends_at, zone)} ${zone}${s.kind === 'ONE_OFF' ? ' (one-off shift)' : ''}`}
                                >
                                  {wallTime(s.starts_at, zone)}–{wallTime(s.ends_at, zone)}
                                  {s.kind === 'ONE_OFF' && <span className="ml-1 text-2xs font-normal">one-off</span>}
                                </span>
                              ))}
                              {leave && (
                                <Badge tone="info" icon={<CalendarOff className="size-3" />} className="max-w-full">
                                  <span className="truncate" title={`${leave.policy_name}${leave.half_day ? ' (half day)' : ''}`}>
                                    {leave.policy_name}
                                    {leave.half_day ? ' · ½' : ''}
                                  </span>
                                </Badge>
                              )}
                              {!list.length && !leave && <span className="text-xs text-text-faint">{holiday ? 'Holiday' : 'Off'}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td className="tabular px-3 py-2 text-right text-xs text-text-muted">{org.fmtDuration(plannedSeconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {!teamView && (
        <Panel title="Current schedule" className="mt-4">
          {myCurrent ? (
            <div className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{myCurrent.name}</span>
                <span className="text-xs text-text-muted">
                  since {fmtDate(myCurrent.effective_from)} · {myCurrent.timezone.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mt-1 text-text-muted">{scheduleSummary(myCurrent, ws)}</p>
            </div>
          ) : (
            <EmptyState title="You don’t have a schedule yet" description="Ask your manager to set your working hours. Until then attendance shows your days as unscheduled." />
          )}
        </Panel>
      )}

      {editing && <ScheduleEditor key={editing.id} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} member={editing} schedules={schedulesBy.get(editing.id) ?? []} />}
    </>
  );
}
