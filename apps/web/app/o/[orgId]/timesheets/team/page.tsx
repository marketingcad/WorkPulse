'use client';
import { Suspense, useMemo } from 'react';
import type { TimeEntryDto, WorkerDto } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, FilterBar, Input, PageHeader, Panel, PermissionState, PersonCell, Select, SkeletonRows, cx, fmtDate, type Column } from '@tallywork/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { qs, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { TimesheetView } from '@/components/timesheets/timesheet-view';
import { useUrlParams } from '@/components/timesheets/use-url-params';
import { periodLabel, sumBy } from '@/components/timesheets/shared';

export default function TeamTimesheetsPage() {
  return (
    <Suspense fallback={<Panel><SkeletonRows /></Panel>}>
      <TeamTimesheets />
    </Suspense>
  );
}

interface SummaryRow {
  worker: WorkerDto;
  seconds: number;
  billable: number;
  manual: number;
  days: Map<string, number>;
}

function TeamTimesheets() {
  const org = useOrg();
  const [params, setParams] = useUrlParams(['member', 'date'] as const);
  const today = todayIn(org.membership.timezone || org.organization.timezone);
  const date = params.date || today;
  const member = params.member;
  const allowed = org.can('timesheets:read', 'team');
  const workersQ = useOrgQuery<WorkerDto[]>(allowed ? '/workers' : null);
  const weekFrom = weekStartOf(date, org.organization.week_start);
  const weekTo = addDays(weekFrom, 6);
  const entriesQ = useOrgQuery<TimeEntryDto[]>(allowed && org.can('time:read') ? `/time-entries${qs({ from: weekFrom, to: weekTo })}` : null);

  const workers = useMemo(() => (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE').sort((a, b) => a.name.localeCompare(b.name)), [workersQ.data]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)), [weekFrom]);

  const rows = useMemo<SummaryRow[]>(() => {
    const es = entriesQ.data ?? [];
    const total = sumBy(es, (e) => e.membership_id, (e) => e.duration_seconds);
    const billable = sumBy(es.filter((e) => e.billable), (e) => e.membership_id, (e) => e.duration_seconds);
    const manual = sumBy(es.filter((e) => e.source === 'MANUAL'), (e) => e.membership_id, (e) => e.duration_seconds);
    const perDay = sumBy(es, (e) => `${e.membership_id}|${e.local_date}`, (e) => e.duration_seconds);
    return workers.map((w) => ({
      worker: w,
      seconds: total.get(w.id) ?? 0,
      billable: billable.get(w.id) ?? 0,
      manual: manual.get(w.id) ?? 0,
      days: new Map(days.map((d) => [d, perDay.get(`${w.id}|${d}`) ?? 0])),
    }));
  }, [entriesQ.data, workers, days]);

  if (!allowed) return <PermissionState message="Viewing other members’ timesheets requires team or organization access." />;

  const d = org.fmtDuration;
  const columns: Column<SummaryRow>[] = [
    { key: 'name', header: 'Member', cell: (r) => <PersonCell name={r.worker.name} sub={r.worker.title ?? r.worker.role_name} />, value: (r) => r.worker.name, priority: 'primary' },
    ...days.map<Column<SummaryRow>>((day) => ({
      key: day,
      header: fmtDate(day, { weekday: 'short', day: 'numeric' }),
      align: 'right',
      priority: 'low',
      value: (r) => r.days.get(day) ?? 0,
      cell: (r) => <span className={cx(!r.days.get(day) && 'text-text-faint', day === today && 'font-semibold')}>{r.days.get(day) ? d(r.days.get(day)) : '–'}</span>,
    })),
    { key: 'total', header: 'Week total', align: 'right', priority: 'secondary', value: (r) => r.seconds, cell: (r) => <span className="font-semibold">{d(r.seconds)}</span> },
    {
      key: 'expected',
      header: 'Expected',
      align: 'right',
      value: (r) => r.worker.weekly_expected_seconds ?? -1,
      cell: (r) => (r.worker.weekly_expected_seconds != null ? <span className={cx(r.seconds < r.worker.weekly_expected_seconds * 0.8 ? 'text-warning' : 'text-text-muted')}>{d(r.worker.weekly_expected_seconds)}</span> : <span className="text-text-faint">—</span>),
    },
    { key: 'manual', header: 'Manual', align: 'right', value: (r) => r.manual, cell: (r) => <span className="text-text-muted">{r.manual ? d(r.manual) : '–'}</span> },
  ];

  return (
    <>
      <PageHeader title="View & edit timesheets" description="Pick a member and period to review, correct, or submit their time." />
      <FilterBar>
        <Select value={member ?? ''} onChange={(e) => setParams({ member: e.target.value || null })} className="w-56" aria-label="Member">
          <option value="">Choose a member…</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="w-40" aria-label="Date in period" />
        {date !== today && (
          <Button variant="ghost" onClick={() => setParams({ date: null })}>
            Today
          </Button>
        )}
      </FilterBar>

      {member ? (
        <div className="mb-6">
          <TimesheetView key={member} membershipId={member} date={date} onDateChange={(x) => setParams({ date: x })} decisions />
        </div>
      ) : null}

      <Panel
        title={`Team week · ${periodLabel(weekFrom, weekTo)}`}
        actions={
          <>
            <Button size="xs" variant="ghost" aria-label="Previous week" onClick={() => setParams({ date: addDays(weekFrom, -7) })}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button size="xs" variant="ghost" aria-label="Next week" onClick={() => setParams({ date: addDays(weekFrom, 7) })}>
              <ChevronRight className="size-3.5" />
            </Button>
          </>
        }
      >
        {!org.can('time:read') ? (
          <EmptyState title="Time totals not available" description="Your role cannot read time entries." />
        ) : entriesQ.error || workersQ.error ? (
          <EmptyState title="Could not load the team summary" description={(entriesQ.error ?? workersQ.error)?.title} />
        ) : (
          <DataTable
            rows={workersQ.data && entriesQ.data ? rows : undefined}
            loading={workersQ.isLoading || entriesQ.isLoading}
            columns={columns}
            rowKey={(r) => r.worker.id}
            onRowClick={(r) => setParams({ member: r.worker.id })}
            rowClassName={(r) => (r.worker.id === member ? 'bg-interactive-soft/40' : undefined)}
            initialSort={{ key: 'name', dir: 'asc' }}
            searchable
            searchPlaceholder="Search members…"
            caption="Hours per member this week"
            empty={<EmptyState title="No members to show" description="Members you manage appear here once they join a team you lead." />}
          />
        )}
      </Panel>
      {!member && <p className="mt-3 text-xs text-text-muted">Select a row to open that member’s timesheet.</p>}
    </>
  );
}
