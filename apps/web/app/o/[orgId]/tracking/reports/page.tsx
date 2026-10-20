'use client';
import { useState } from 'react';
import type { EodReportDto } from '@tallywork/contracts';
import { Badge, EmptyState, ErrorState, FilterBar, PageHeader, Panel, PermissionState, PersonCell, Select, SkeletonRows, fmtTime } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { DateRangeFilter, MemberFilter, useDefaultRange } from '@/components/tracking/filters';
import type { DateRange } from '@/components/tracking/time';

/** A local date ('YYYY-MM-DD') as "Tue, Oct 20", without a time-zone shift. */
const fmtLocalDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export default function EodReportsPage() {
  const org = useOrg();
  const [range, setRange] = useState<DateRange>(useDefaultRange('this_week'));
  const [member, setMember] = useState('');
  const [show, setShow] = useState<'all' | 'finished'>('all');
  const allowed = org.can('tracking:read');
  const q = useOrgQuery<EodReportDto[]>(allowed ? `/eod-reports${qs({ from: range.from, to: range.to, membership_ids: member || undefined })}` : null);

  if (!allowed) return <PermissionState />;
  const rows = (q.data ?? []).filter((r) => show === 'all' || r.finished);

  return (
    <>
      <PageHeader title="End-of-day reports" description="What each person completed, written when they clock out in the desktop app." />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} />
        <Select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'all' | 'finished')} className="w-44">
          <option value="all">All reports</option>
          <option value="finished">Finished work only</option>
        </Select>
      </FilterBar>
      <Panel title="Reports" actions={q.data && <span className="tabular text-xs text-text-muted">{rows.length === 1 ? '1 report' : `${rows.length} reports`}</span>}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <SkeletonRows rows={4} cols={3} />
        ) : !rows.length ? (
          show === 'finished' && q.data?.length ? (
            <EmptyState title="No finished work in this period" description="Reports where the person ticked “This work is finished” appear here." />
          ) : (
            <EmptyState title="No end-of-day reports in this period" description="A report is written each time someone clocks out in the desktop app. Try a wider date range." />
          )
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <article aria-label={`${r.worker_name}, ${fmtLocalDay(r.local_date)}`} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <PersonCell name={r.worker_name} />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      {r.finished && <Badge tone="success">Finished</Badge>}
                      <span className="tabular">
                        {fmtLocalDay(r.local_date)} · {fmtTime(r.started_at)}–{r.ended_at ? fmtTime(r.ended_at) : '…'} · {org.fmtDuration(r.worked_seconds)}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-text-muted">
                    {r.project_name}
                    {r.task_title && <> / {r.task_title}</>}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{r.body}</p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
