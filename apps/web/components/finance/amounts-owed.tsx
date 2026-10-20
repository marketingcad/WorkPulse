'use client';
import { useState } from 'react';
import { DataTable, EmptyState, ErrorState, Field, FilterBar, Input, KpiStrip, Panel, PersonCell, fmtMoney, type Column } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { ExportMenu } from '@/components/reports/export-menu';
import { monthRange, type AmountOwedRow } from './types';

/**
 * What the organization owes each member for a period: tracked time at today's pay rates
 * (estimate) and approved time at the rates snapshotted on approval (payroll-ready).
 * Shown on Payroll › Owed; the same numbers as the Amounts Owed report.
 */
export function AmountsOwed() {
  const org = useOrg();
  const initial = monthRange(todayIn(org.organization.timezone));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = from && to && from <= to;
  const q = useOrgQuery<AmountOwedRow[]>(valid ? `/billing/amounts-owed${qs({ from, to })}` : null);
  const rows = q.data ?? [];
  const currency = rows[0]?.currency ?? org.organization.currency;
  const totals = rows.reduce(
    (t, r) => ({ tracked: t.tracked + r.tracked_seconds, approved: t.approved + r.approved_seconds, est: t.est + r.estimated_amount_minor, appr: t.appr + r.approved_amount_minor }),
    { tracked: 0, approved: 0, est: 0, appr: 0 },
  );

  const columns: Column<AmountOwedRow>[] = [
    { key: 'name', header: 'Member', cell: (r) => <PersonCell name={r.worker_name || 'Member'} />, value: (r) => r.worker_name, priority: 'primary' },
    { key: 'tracked', header: 'Tracked', align: 'right', cell: (r) => org.fmtDuration(r.tracked_seconds), value: (r) => r.tracked_seconds, priority: 'secondary' },
    { key: 'approved', header: 'Approved', align: 'right', cell: (r) => org.fmtDuration(r.approved_seconds), value: (r) => r.approved_seconds, priority: 'secondary' },
    { key: 'est', header: 'Estimated owed', align: 'right', cell: (r) => fmtMoney(r.estimated_amount_minor, r.currency), value: (r) => r.estimated_amount_minor },
    { key: 'appr', header: 'Approved owed', align: 'right', cell: (r) => <span className="font-semibold">{fmtMoney(r.approved_amount_minor, r.currency)}</span>, value: (r) => r.approved_amount_minor, priority: 'primary' },
  ];

  return (
    <>
      <FilterBar>
        <Field label="From" htmlFor="owed-from">
          <Input id="owed-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label="To" htmlFor="owed-to">
          <Input id="owed-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        {!valid && <span className="self-end pb-1.5 text-xs text-danger">The start date must be before the end date.</span>}
        {org.can('reports:finance') && valid && (
          <div className="ml-auto self-end">
            <ExportMenu reportKey="amounts-owed" from={from} to={to} />
          </div>
        )}
      </FilterBar>
      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Tracked', value: org.fmtDuration(totals.tracked) },
          { label: 'Approved', value: org.fmtDuration(totals.approved) },
          { label: 'Estimated owed', value: fmtMoney(totals.est, currency), hint: 'at current pay rates' },
          { label: 'Approved owed', value: fmtMoney(totals.appr, currency), hint: 'payroll-ready' },
        ]}
      />
      <Panel
        title="Amounts owed by member"
        footer="Estimated amounts apply today's pay rates to all tracked time. Approved amounts are snapshotted when a timesheet is approved and do not change if rates change later."
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(r) => r.membership_id}
            initialSort={{ key: 'name', dir: 'asc' }}
            searchable
            searchPlaceholder="Search members…"
            empty={<EmptyState title="No tracked time in this period" description="Pick a different date range, or check that members are tracking time." />}
            footer={
              rows.length > 1 ? (
                <tr className="h-10">
                  <td className="px-3 text-sm">Total</td>
                  <td className="tabular px-3 text-right text-sm">{org.fmtDuration(totals.tracked)}</td>
                  <td className="tabular px-3 text-right text-sm">{org.fmtDuration(totals.approved)}</td>
                  <td className="tabular px-3 text-right text-sm">{fmtMoney(totals.est, currency)}</td>
                  <td className="tabular px-3 text-right text-sm">{fmtMoney(totals.appr, currency)}</td>
                </tr>
              ) : undefined
            }
          />
        )}
      </Panel>
    </>
  );
}
