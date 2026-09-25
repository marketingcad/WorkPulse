'use client';
import { useMemo, useState } from 'react';
import { Avatar, EmptyState, ErrorState, Panel, SkeletonRows, StatusBadge, cx, fmtDate } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { DOW_SHORT, DateStepper, dateRangeLabel, fmtHours, orderedDows, type HolidayRow, type TimeOffRequest } from './shared';

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}
function shiftMonth(first: string, n: number) {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const MAX_AVATARS = 4;

export function TimeOffCalendar() {
  const org = useOrg();
  const today = todayIn(org.membership.timezone || org.organization.timezone);
  const ws = org.organization.week_start;
  const [month, setMonth] = useState(monthStart(today));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const gridStart = weekStartOf(month, ws);
  const lastOfMonth = addDays(shiftMonth(month, 1), -1);
  const gridEnd = addDays(weekStartOf(lastOfMonth, ws), 6);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);

  const q = useOrgQuery<TimeOffRequest[]>(`/time-off/requests${qs({ from: gridStart, to: gridEnd })}`);
  const holidaysQ = useOrgQuery<HolidayRow[]>('/holidays');
  const requests = useMemo(() => (q.data ?? []).filter((r) => r.status === 'APPROVED' || r.status === 'PENDING'), [q.data]);
  const holidayByDate = useMemo(() => new Map((holidaysQ.data ?? []).map((h) => [h.date, h])), [holidaysQ.data]);
  const onDay = (d: string) => requests.filter((r) => r.start_date <= d && r.end_date >= d).sort((a, b) => a.worker_name.localeCompare(b.worker_name));

  const focus = selectedDay ?? (today >= gridStart && today <= gridEnd ? today : month);
  const focusList = onDay(focus);
  const focusHoliday = holidayByDate.get(focus);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        title={fmtDate(month, { month: 'long', year: 'numeric' })}
        actions={<DateStepper type="month" label="Month" value={month} onChange={(v) => setMonth(monthStart(v))} step={(dir) => setMonth(shiftMonth(month, dir))} today={monthStart(today)} todayLabel="This month" />}
        footer={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name="A B" size={14} /> Approved
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Avatar name="A B" size={14} className="opacity-50 outline-1 outline-dashed outline-offset-1 outline-text-muted" /> Pending (faded, dashed)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-[2px] bg-surface-sunken" aria-hidden /> Holiday
            </span>
          </span>
        }
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <SkeletonRows rows={5} cols={7} />
        ) : (
          <div role="group" aria-label={`Time off calendar, ${fmtDate(month, { month: 'long', year: 'numeric' })}`}>
            <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60">
              {orderedDows(ws).map((dow) => (
                <div key={dow} className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  {DOW_SHORT[dow]}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = onDay(d);
                const h = holidayByDate.get(d);
                const inMonth = d.slice(0, 7) === month.slice(0, 7);
                const pending = list.filter((r) => r.status === 'PENDING').length;
                const label = `${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${h ? `, holiday: ${h.name}` : ''}, ${list.length ? `${list.length} out${pending ? ` (${pending} pending)` : ''}` : 'nobody out'}`;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-label={label}
                    aria-pressed={focus === d}
                    onClick={() => setSelectedDay(d)}
                    className={cx(
                      'flex min-h-20 flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40 sm:min-h-24',
                      h && 'bg-surface-sunken/70',
                      !inMonth && 'text-text-faint',
                      focus === d && 'ring-2 ring-inset ring-interactive/50',
                    )}
                  >
                    <span className={cx('tabular text-xs font-medium', d === today && 'inline-flex size-5 items-center justify-center rounded-full bg-interactive text-on-accent')}>{Number(d.slice(8))}</span>
                    {h && (
                      <span className="truncate text-2xs font-medium text-text-muted" title={h.name}>
                        {h.name}
                      </span>
                    )}
                    {list.length > 0 && (
                      <span className="flex flex-wrap items-center gap-0.5">
                        {list.slice(0, MAX_AVATARS).map((r) => (
                          <span key={r.id} title={`${r.worker_name} · ${r.policy_name}${r.status === 'PENDING' ? ' (pending)' : ''}`}>
                            <Avatar name={r.worker_name} size={20} className={cx(r.status === 'PENDING' && 'opacity-50 outline-1 outline-dashed outline-offset-1 outline-text-muted')} />
                          </span>
                        ))}
                        {list.length > MAX_AVATARS && <span className="tabular text-2xs text-text-muted">+{list.length - MAX_AVATARS}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel title={fmtDate(focus, { weekday: 'long', month: 'short', day: 'numeric' })}>
        {focusHoliday && (
          <div className="border-b border-border px-4 py-2 text-sm">
            <span className="font-medium">Holiday:</span> {focusHoliday.name}
            <span className="text-text-muted"> · {focusHoliday.paid ? 'paid' : 'unpaid'}</span>
          </div>
        )}
        {focusList.length ? (
          <ul className="divide-y divide-border">
            {focusList.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Avatar name={r.worker_name} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.worker_name}</div>
                  <div className="truncate text-xs text-text-muted">
                    {r.policy_name} · {dateRangeLabel(r.start_date, r.end_date)} · {fmtHours(r.hours)}
                    {r.half_day ? ' (½ day)' : ''}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nobody is out" description="Select another day to see who is away." className="py-8" />
        )}
      </Panel>
    </div>
  );
}
