'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, Info } from 'lucide-react';
import type { InsightsDto } from '@tallywork/contracts';
import { Button, DataTable, EmptyState, ErrorState, KpiStrip, PageHeader, Panel, PermissionState, PersonCell, SegmentedControl, SkeletonRows, fmtDate, fmtMoney, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { ColumnChart, StackedBars } from '@/components/charts';
import { PERIOD_OPTIONS, periodRange, type PeriodMode } from '@/components/insights/period';
import { downloadText, toCsv } from '@/lib/csv';

type Member = InsightsDto['members'][number];

export default function InsightsPage() {
  const org = useOrg();
  const router = useRouter();
  const [mode, setMode] = useState<PeriodMode>('month');
  const [offset, setOffset] = useState(0);
  const pp = org.organization.pay_period as { type?: string; anchorDate?: string } | null;
  const period = periodRange(mode, todayIn(org.organization.timezone), offset, org.organization.week_start, pp?.type === 'biweekly' ? pp.anchorDate : undefined);
  const q = useOrgQuery<InsightsDto>(org.can('time:read') ? `/insights${qs({ from: period.from, to: period.to })}` : null);

  if (!org.can('time:read')) return <PermissionState />;
  const data = q.data;
  const d = org.fmtDuration;
  const money = (m: number | null) => (m === null ? '—' : fmtMoney(m, data?.currency ?? org.organization.currency));
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const columns: Column<Member>[] = [
    { key: 'name', header: 'Member', priority: 'primary', value: (m) => m.name, cell: (m) => <PersonCell name={m.name} sub={m.title ?? undefined} /> },
    { key: 'logged', header: 'Logged', align: 'right', priority: 'secondary', value: (m) => m.logged_seconds, cell: (m) => <span className="tabular">{d(m.logged_seconds)}</span> },
    { key: 'billable', header: 'Billable', align: 'right', value: (m) => m.billable_seconds, cell: (m) => <span className="tabular text-text-muted">{d(m.billable_seconds)}</span> },
    { key: 'activity', header: 'Activity', align: 'right', value: (m) => m.activity_pct ?? -1, cell: (m) => <span className="tabular text-text-muted">{m.activity_pct === null ? '—' : `${m.activity_pct}%`}</span> },
    ...(data?.money_visible
      ? [
          { key: 'pay', header: 'Est. pay', align: 'right' as const, value: (m: Member) => m.pay_minor ?? -1, cell: (m: Member) => <span className="tabular">{money(m.pay_minor)}</span> },
          { key: 'bill', header: 'Est. billable', align: 'right' as const, value: (m: Member) => m.bill_minor ?? -1, cell: (m: Member) => <span className="tabular">{money(m.bill_minor)}</span> },
        ]
      : []),
    { key: 'off', header: 'Days off', align: 'right', value: (m) => m.days_off, cell: (m) => <span className="tabular text-text-muted">{m.days_off || '—'}</span> },
  ];

  const exportCsv = () => {
    if (!data) return;
    const hours = (s: number) => Math.round((s / 3600) * 100) / 100;
    const amount = (m: number | null) => (m === null ? null : m / 100);
    const header = ['Member', 'Title', 'Logged (h)', 'Billable (h)', 'Activity (%)', ...(data.money_visible ? [`Est. pay (${data.currency})`, `Billable amount (${data.currency})`] : []), 'Days off'];
    const rows = data.members.map((m) => [m.name, m.title, hours(m.logged_seconds), hours(m.billable_seconds), m.activity_pct, ...(data.money_visible ? [amount(m.pay_minor), amount(m.bill_minor)] : []), m.days_off]);
    rows.push(['Total', null, hours(data.totals.logged_seconds), hours(data.totals.billable_seconds), data.totals.activity_pct, ...(data.money_visible ? [amount(data.totals.pay_minor), amount(data.totals.bill_minor)] : []), data.totals.days_off]);
    downloadText(`insights-${data.from}-to-${data.to}.csv`, toCsv(header, rows));
  };

  return (
    <>
      <PageHeader
        title="Insights"
        description="Time, pay and billing for a period, per person, client and project."
        actions={
          <Button icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={!data}>
            Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" aria-label="Previous period" icon={<ChevronLeft className="size-3.5" />} onClick={() => setOffset((o) => o - 1)} />
        <span className="min-w-44 text-center text-sm font-medium tabular">{period.label}</span>
        <Button size="sm" aria-label="Next period" icon={<ChevronRight className="size-3.5" />} onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} />
        {offset !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            Current
          </Button>
        )}
        <div className="ml-auto">
          <SegmentedControl
            label="Period"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setOffset(0);
            }}
            options={PERIOD_OPTIONS}
          />
        </div>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <Panel>
          <SkeletonRows rows={6} cols={4} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <KpiStrip
            items={[
              { label: 'Time logged', value: d(data.totals.logged_seconds), hint: plural(data.totals.people_with_time, 'person', 'people') },
              ...(data.money_visible ? [{ label: 'Est. pay', value: money(data.totals.pay_minor), hint: plural(data.totals.paid_people, 'person', 'people') }] : []),
              { label: 'Billable time', value: d(data.totals.billable_seconds), hint: `${plural(data.totals.billable_clients, 'client')}, ${plural(data.totals.billable_projects, 'project')}` },
              ...(data.money_visible ? [{ label: 'Est. billable', value: money(data.totals.bill_minor) }] : []),
              { label: 'Activity', value: data.totals.activity_pct === null ? '—' : `${data.totals.activity_pct}%` },
              { label: 'Days off', value: data.totals.days_off },
            ]}
          />
          {data.money_visible && (
            <p className="flex items-start gap-2 text-xs text-text-muted">
              <Info className="mt-0.5 size-3 shrink-0" />
              Amounts are priced from the current pay and billable rates. Approved timesheets keep the rates they were approved with.
              {data.other_currency && ' Time priced in another currency is not included.'}
            </p>
          )}

          {mode !== 'day' && (
            <Panel title="Hours per day">
              <div className="p-4">
                {data.totals.logged_seconds ? (
                  <ColumnChart
                    data={data.by_day.map((x) => ({ date: x.date, billable: x.billable_seconds, other: x.seconds - x.billable_seconds }))}
                    x="date"
                    series={[
                      { key: 'billable', label: 'Billable', color: 'var(--color-secondary)' },
                      { key: 'other', label: 'Non-billable', color: 'var(--color-border-strong)' },
                    ]}
                    format={d}
                    xFormat={(v) => fmtDate(v, mode === 'month' ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' })}
                  />
                ) : (
                  <EmptyState title="No time in this period" />
                )}
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Hours by client">
              <div className="p-4">
                {data.by_client.length ? (
                  <StackedBars rows={data.by_client.slice(0, 10).map((c) => ({ label: c.name, value: c.seconds, sub: c.bill_minor ? money(c.bill_minor) : undefined }))} format={d} />
                ) : (
                  <EmptyState title="No client time" />
                )}
              </div>
            </Panel>
            <Panel title="Hours by project">
              <div className="p-4">
                {data.by_project.length ? (
                  <StackedBars rows={data.by_project.slice(0, 10).map((p) => ({ label: p.name, value: p.seconds, color: p.color, sub: p.client_name ?? undefined }))} format={d} />
                ) : (
                  <EmptyState title="No project time" />
                )}
              </div>
            </Panel>
          </div>

          <Panel title="People">
            <DataTable
              rows={data.members}
              columns={columns}
              rowKey={(m) => m.membership_id}
              onRowClick={org.can('members:read') ? (m) => router.push(`${org.base}/workers/${m.membership_id}`) : undefined}
              searchable
              searchPlaceholder="Search people…"
              caption="Time and money per person"
              initialSort={{ key: 'logged', dir: 'desc' }}
              empty={<EmptyState title="Nobody to show" />}
            />
          </Panel>
        </div>
      )}
    </>
  );
}
