'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Clock3, Palmtree, Timer, UserCheck, UserX } from 'lucide-react';
import { Info } from 'lucide-react';
import type { OffsetPage } from '@tallywork/contracts';
import { DataTable, EmptyState, ErrorState, FilterBar, Input, KpiStrip, PageHeader, Panel, PermissionState, PersonCell, SegmentedControl, Select, StatusBadge, fmtDate, fmtTime, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';
import { DateStepper, dateRangeLabel, type AttendanceRow, type AttendanceStatus } from '@/components/people/shared';

const STATUSES: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'LATE', label: 'Late' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'HOLIDAY', label: 'Holiday' },
  { value: 'UNSCHEDULED', label: 'Unscheduled' },
];

export default function AttendancePage() {
  const org = useOrg();
  const tz = org.membership.timezone || org.organization.timezone;
  const today = todayIn(tz);
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState<'' | AttendanceStatus>('');

  const from = mode === 'day' ? date : weekStartOf(date, org.organization.week_start);
  const to = mode === 'day' ? date : addDays(from, 6);
  const allowed = org.can('attendance:read');
  const search = useSearch();
  // The server computes everyone's attendance for the range, counts it, and sends one page of rows
  // (each with the member's time zone), instead of every member-day.
  const filters = { from, to, status: status || undefined, q: search.term || undefined };
  const paging = useServerPage(JSON.stringify(filters));
  const q = useOrgQuery<OffsetPage<AttendanceRow & { timezone: string }> & { summary: { counts: Record<string, number>; overtime_seconds: number } }>(allowed ? `/attendance${qs({ ...filters, ...paging.params })}` : null, {
    placeholderData: (p) => p,
  });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const tzOf = (id: string) => q.data?.data.find((r) => r.membership_id === id)?.timezone || org.organization.timezone;
  const counts = q.data?.summary.counts ?? {};
  const count = (s: AttendanceStatus) => counts[s] ?? 0;
  const kpis = { present: count('PRESENT'), late: count('LATE'), absent: count('ABSENT'), leave: count('ON_LEAVE'), overtime: q.data?.summary.overtime_seconds ?? 0 };

  const d = org.fmtDuration;
  const dash = (s: number) => (s > 0 ? d(s) : <span className="text-text-faint">—</span>);
  const columns: Column<AttendanceRow>[] = [
    { key: 'member', header: 'Member', cell: (r) => <PersonCell name={r.worker_name} sub={mode === 'week' ? fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }) : undefined} />, value: (r) => r.worker_name, priority: 'primary' },
    ...(mode === 'week' ? [{ key: 'date', header: 'Date', cell: (r: AttendanceRow) => <span className="tabular">{fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>, value: (r: AttendanceRow) => r.date }] : []),
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status, priority: 'secondary' },
    {
      key: 'scheduled',
      header: 'Scheduled',
      cell: (r) => (r.scheduled_start ? <span className="tabular whitespace-nowrap">{fmtTime(r.scheduled_start, tzOf(r.membership_id))} – {fmtTime(r.scheduled_end, tzOf(r.membership_id))}</span> : <span className="text-text-faint">Not scheduled</span>),
      value: (r) => r.scheduled_start,
      priority: 'secondary',
    },
    { key: 'in', header: 'First in', cell: (r) => <span className="tabular">{fmtTime(r.first_in, tzOf(r.membership_id))}</span>, value: (r) => r.first_in, priority: 'secondary' },
    { key: 'out', header: 'Last out', cell: (r) => <span className="tabular">{fmtTime(r.last_out, tzOf(r.membership_id))}</span>, value: (r) => r.last_out },
    { key: 'worked', header: 'Worked', align: 'right', cell: (r) => dash(r.worked_seconds), value: (r) => r.worked_seconds, priority: 'secondary' },
    { key: 'late', header: 'Late by', align: 'right', cell: (r) => (r.late_seconds > 0 ? <span className="text-warning">{d(r.late_seconds)}</span> : dash(0)), value: (r) => r.late_seconds },
    { key: 'early', header: 'Left early', align: 'right', cell: (r) => dash(r.early_leave_seconds), value: (r) => r.early_leave_seconds },
    { key: 'ot', header: 'Overtime', align: 'right', cell: (r) => dash(r.overtime_seconds), value: (r) => r.overtime_seconds },
  ];

  if (!allowed)
    return (
      <>
        <PageHeader title="Attendance" />
        <Panel>
          <PermissionState />
        </Panel>
      </>
    );

  return (
    <>
      <PageHeader
        title="Attendance"
        description={mode === 'day' ? `Roster for ${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` : `Week of ${dateRangeLabel(from, to)}`}
        actions={
          <SegmentedControl
            label="Range"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
            ]}
          />
        }
      />
      <FilterBar>
        <DateStepper value={date} onChange={setDate} step={(dir) => setDate(addDays(date, dir * (mode === 'day' ? 1 : 7)))} today={today} todayLabel={mode === 'day' ? 'Today' : 'This week'} />
        <Select value={status} onChange={(e) => setStatus(e.target.value as '' | AttendanceStatus)} className="w-44" aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Input aria-label="Search members" placeholder="Search members…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="w-56" />
      </FilterBar>

      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Present', value: kpis.present, hint: 'on time', icon: <UserCheck />, tone: 'green' },
          { label: 'Late', value: <span className={kpis.late ? 'text-warning' : undefined}>{kpis.late}</span>, icon: <Clock3 />, tone: 'amber' },
          { label: 'Absent', value: <span className={kpis.absent ? 'text-danger' : undefined}>{kpis.absent}</span>, icon: <UserX />, tone: 'rose' },
          { label: 'On leave', value: kpis.leave, icon: <Palmtree />, tone: 'teal' },
          { label: 'Overtime', value: d(kpis.overtime), icon: <Timer />, tone: 'violet' },
        ]}
      />

      <Panel
        title={mode === 'day' ? 'Daily roster' : 'Weekly roster'}
        footer={
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            Attendance is derived from each member&apos;s schedule and their tracked time. It does not depend on activity levels or screenshots. Late arrivals respect the organization&apos;s grace period.
          </span>
        }
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.data}
            columns={columns.map((c) => ({ ...c, sortable: false }))}
            rowKey={(r) => `${r.membership_id}:${r.date}`}
            loading={q.isLoading}
            pagination={paging.pagination(q.data)}
            caption="Attendance roster"
            key={mode}
            empty={
              <EmptyState
                title={search.term ? 'No members match your search' : status ? 'No members with this status' : 'Nobody was scheduled or tracked time'}
                description={
                  status ? (
                    'Try another status filter.'
                  ) : (
                    <>
                      Attendance appears once members have a schedule or track time.{' '}
                      <Link href={`${org.base}/schedules`} className="font-medium text-interactive hover:underline">
                        Set up schedules
                      </Link>
                    </>
                  )
                }
              />
            }
          />
        )}
      </Panel>
    </>
  );
}
