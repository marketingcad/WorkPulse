'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, BadgeDollarSign, BarChart3, CalendarClock, ChevronRight, Clock, Pencil, ShieldCheck, Trash2, Users, type LucideIcon } from 'lucide-react';
import { Badge, ConfirmDialog, EmptyState, ErrorState, IconButton, PageHeader, Panel, PermissionState, SkeletonRows, Spinner, fmtDateTime, useToast } from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { CatalogItem, SavedReport } from '@/components/reports/format';
import { RecentExports } from '@/components/reports/recent-exports';
import { SaveReportDialog } from '@/components/reports/save-dialog';
import { describeCron } from '@/components/reports/schedule';
import { HelpLink } from '@/components/help/help-link';

const CATEGORIES: Array<{ key: CatalogItem['category']; label: string; icon: LucideIcon }> = [
  { key: 'Time', label: 'Time', icon: Clock },
  { key: 'Activity', label: 'Activity', icon: Activity },
  { key: 'People', label: 'People', icon: Users },
  { key: 'Finance', label: 'Finance', icon: BadgeDollarSign },
  { key: 'Compliance', label: 'Compliance', icon: ShieldCheck },
];

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <ReportsCatalog />
    </Suspense>
  );
}

function ReportsCatalog() {
  const org = useOrg();
  const toast = useToast();
  // ?runs=1 is the link in the "export is ready" notification.
  const showRuns = useSearchParams().get('runs') === '1';
  const runsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showRuns) runsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showRuns]);
  const [editing, setEditing] = useState<SavedReport | null>(null);
  const catalogQ = useOrgQuery<CatalogItem[]>('/reports');
  const savedQ = useOrgQuery<SavedReport[]>('/saved-reports');
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/saved-reports/${b.id}`, {
    onSuccess: () => {
      toast.success('Saved report deleted');
      setDeleting(null);
    },
  });

  if (!org.can('reports:read')) return <PermissionState />;
  const titleOf = (key: string) => catalogQ.data?.find((c) => c.key === key)?.title ?? (key === 'data-export' ? 'Personal data export' : key);

  return (
    <>
      <PageHeader title="Report library" description="Pick the question you need answered. Every report can be filtered, exported and saved." actions={<HelpLink article="reports" />} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {catalogQ.isLoading ? (
            <Panel title="Reports">
              <SkeletonRows rows={8} cols={2} />
            </Panel>
          ) : catalogQ.error ? (
            <Panel>
              <ErrorState error={catalogQ.error} onRetry={() => catalogQ.refetch()} />
            </Panel>
          ) : !catalogQ.data?.length ? (
            <Panel>
              <EmptyState title="No reports available" description="Your role does not include any reports. Ask an admin for report access." icon={<BarChart3 className="size-5" />} />
            </Panel>
          ) : (
            CATEGORIES.map((cat) => {
              const items = catalogQ.data!.filter((r) => r.category === cat.key && !r.hidden);
              if (!items.length) return null;
              const Icon = cat.icon;
              return (
                <Panel
                  key={cat.key}
                  title={
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="size-4 text-text-muted" aria-hidden />
                      {cat.label}
                    </h2>
                  }
                >
                  <ul className="divide-y divide-border">
                    {items.map((r) => (
                      <li key={r.key}>
                        <Link href={`${org.base}/reports/${r.key}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted/60 focus:bg-surface-muted/60 focus:outline-none">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{r.title}</span>
                            <span className="block truncate text-xs text-text-muted">{r.question}</span>
                          </span>
                          {r.groupings.length > 0 && <Badge className="hidden sm:inline-flex">Group by</Badge>}
                          <ChevronRight className="size-4 shrink-0 text-text-faint group-hover:text-text-muted" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Panel title="Saved reports">
            {savedQ.isLoading ? (
              <SkeletonRows rows={3} cols={2} />
            ) : savedQ.error ? (
              <ErrorState error={savedQ.error} onRetry={() => savedQ.refetch()} />
            ) : !savedQ.data?.length ? (
              <EmptyState title="No saved reports" description="Run a report, set filters, then choose “Save report” to keep it here." />
            ) : (
              <ul className="divide-y divide-border">
                {savedQ.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-4 py-2">
                    <Link href={`${org.base}/reports/${s.report_key}?saved=${s.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {titleOf(s.report_key)}
                        {s.shared && ' · Shared'}
                        {!s.owner && ' · by a teammate'}
                      </span>
                      {s.schedule_cron && (
                        <span className="flex items-center gap-1 truncate text-xs text-text-muted">
                          <CalendarClock className="size-3 shrink-0 text-text-faint" aria-hidden />
                          <span className="truncate">
                            {describeCron(s.schedule_cron)}
                            {s.schedule_timezone && s.schedule_timezone !== org.organization.timezone && ` (${s.schedule_timezone})`}
                            {` · ${s.recipients.length} ${s.recipients.length === 1 ? 'recipient' : 'recipients'}`}
                          </span>
                        </span>
                      )}
                      {s.last_run_at && <span className="block truncate text-xs text-text-faint">Last run {fmtDateTime(s.last_run_at, org.membership.timezone)}</span>}
                    </Link>
                    {s.owner && (
                      <>
                        <IconButton label={`Edit ${s.name}`} size="xs" onClick={() => setEditing(s)}>
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton label={`Delete ${s.name}`} size="xs" onClick={() => setDeleting(s)}>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <RecentExports ref={runsRef} titleOf={titleOf} highlight={showRuns} />
        </div>
      </div>

      <SaveReportDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} reportKey={editing?.report_key ?? ''} defaultName={editing?.name ?? ''} params={editing?.params ?? {}} existing={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete saved report?"
        description={deleting ? `“${deleting.name}” will be removed for everyone it is shared with. The underlying data is not affected.` : undefined}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate({ id: deleting.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}
