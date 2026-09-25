'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Download, FileDown } from 'lucide-react';
import { Button, StatusBadge, useToast } from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { ReportRun } from '@/components/reports/format';

const RUN_STATUS: Record<ReportRun['status'], { status: string; label: string }> = {
  QUEUED: { status: 'PENDING', label: 'Queued' },
  RUNNING: { status: 'IN_PROGRESS', label: 'Preparing' },
  DONE: { status: 'DONE', label: 'Ready' },
  FAILED: { status: 'FAILED', label: 'Failed' },
};

/**
 * Queue a JSON export of one member's personal data. The file is delivered like other background
 * exports (Recent exports + a notification); the run started here is tracked inline until it is ready.
 */
export function DataExportAction({ membershipId, label = 'Export data' }: { membershipId: string; label?: string }) {
  const org = useOrg();
  const toast = useToast();
  const [runId, setRunId] = useState<string | null>(null);
  const m = useOrgMutation<Record<string, never>, { id: string; status: 'QUEUED' }>('POST', `/workers/${membershipId}/data-export`, {
    onSuccess: (r) => {
      setRunId(r.id);
      toast.success('Export started. You will be notified when the file is ready.');
    },
  });
  const runsQ = useOrgQuery<ReportRun[]>(runId ? '/report-runs' : null, {
    refetchInterval: (query) => {
      const run = query.state.data?.find((r) => r.id === runId);
      return !run || run.status === 'QUEUED' || run.status === 'RUNNING' ? 3000 : false;
    },
  });
  const run = runsQ.data?.find((r) => r.id === runId);
  const s = run ? RUN_STATUS[run.status] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<FileDown className="size-3.5" />} loading={m.isPending} onClick={() => m.mutate({}, { onError: (e) => toast.error(errorMessage(e)) })}>
          {label}
        </Button>
        {s && <StatusBadge status={s.status} label={s.label} />}
        {run?.status === 'DONE' && run.download_url && (
          <a href={run.download_url} className="inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline">
            <Download className="size-3.5" aria-hidden /> Download JSON
          </a>
        )}
      </div>
      {run?.status === 'FAILED' && run.error && <p className="text-xs text-danger">{run.error}</p>}
      {runId && org.can('reports:read') && (
        <Link href={`${org.base}/reports?runs=1`} className="text-xs font-medium text-interactive hover:underline">
          See all in Recent exports →
        </Link>
      )}
    </div>
  );
}
