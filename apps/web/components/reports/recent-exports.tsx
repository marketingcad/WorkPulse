'use client';
import { forwardRef } from 'react';
import { Download, FileDown } from 'lucide-react';
import { Badge, EmptyState, ErrorState, Panel, SkeletonRows, StatusBadge, cx, fmtDateTime, fmtRelative } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { ReportRun } from './format';

const STATUS: Record<ReportRun['status'], { status: string; label: string }> = {
  QUEUED: { status: 'PENDING', label: 'Queued' },
  RUNNING: { status: 'IN_PROGRESS', label: 'Running' },
  DONE: { status: 'DONE', label: 'Ready' },
  FAILED: { status: 'FAILED', label: 'Failed' },
};

/** The member's background and scheduled exports; polls while any is still queued or running, and now and then otherwise so the 15-minute download links stay fresh. */
export const RecentExports = forwardRef<HTMLDivElement, { titleOf: (key: string) => string; highlight?: boolean }>(function RecentExports({ titleOf, highlight }, ref) {
  const org = useOrg();
  const q = useOrgQuery<ReportRun[]>('/report-runs', { refetchInterval: (query) => (query.state.data?.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ? 5000 : 10 * 60_000) });
  return (
    <div ref={ref} id="recent-exports" className={cx('scroll-mt-20 rounded-md', highlight && 'ring-2 ring-interactive/40')}>
      <Panel title="Recent exports">
        {q.isLoading ? (
          <SkeletonRows rows={3} cols={2} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="No exports yet" description="For large reports, choose “Export in background” on the report. The file appears here when it is ready." icon={<FileDown className="size-5" />} />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{titleOf(r.report_key)}</span>
                    <Badge>{r.format}</Badge>
                  </span>
                  <span className="block truncate text-xs text-text-muted" title={fmtDateTime(r.created_at, org.membership.timezone)}>
                    {fmtRelative(r.created_at)}
                    {r.scheduled && ' · Scheduled'}
                    {r.row_count !== null && <span className="tabular"> · {r.row_count.toLocaleString()} {r.row_count === 1 ? 'row' : 'rows'}</span>}
                  </span>
                  {r.status === 'FAILED' && r.error && <span className="block truncate text-xs text-danger" title={r.error}>{r.error}</span>}
                </span>
                <StatusBadge status={STATUS[r.status].status} label={STATUS[r.status].label} />
                {r.status === 'DONE' && r.download_url && (
                  <a href={r.download_url} className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium text-interactive hover:bg-surface-muted hover:underline">
                    <Download className="size-3.5" aria-hidden />
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
});
