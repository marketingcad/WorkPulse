'use client';
/**
 * A project's revision history (GET /projects/:id/revisions, read from the audit log): each revision's
 * number, time, author, reason and the fields that changed, from the previous to the new value.
 * Used by the project's History tab and the client folder accordion.
 */
import { useState } from 'react';
import { ArrowRight, History } from 'lucide-react';
import type { ProjectRevisionDto, ProjectRevisionsDto } from '@tallywork/contracts';
import { Badge, EmptyState, ErrorState, Pagination, SegmentedControl, SkeletonRows, fmtDate, fmtDateTime, fmtMoney } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { PROJECT_STATUSES } from './basics';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  client_id: 'Client',
  status: 'Status',
  description: 'Description',
  short_name: 'Short name',
  color: 'Colour',
  billable_default: 'Billable by default',
  start_date: 'Start date',
  end_date: 'End date',
  estimate_seconds: 'Estimate',
  estimate_unit: 'Estimate unit',
  member_ids: 'Members',
  team_ids: 'Teams',
  breaks: 'Planned breaks',
  pay_rate_minor: 'Pay rate',
  bill_rate_minor: 'Bill rate',
};

const ACTION_LABELS: Record<ProjectRevisionDto['action'], { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  'project.created': { label: 'Created', tone: 'success' },
  'project.updated': { label: 'Edited', tone: 'info' },
  'project.archived': { label: 'Archived', tone: 'warning' },
  'project.restored': { label: 'Restored', tone: 'neutral' },
};

const PAGE_SIZE = 20;

export function ProjectRevisions({ projectId, currency }: { projectId: string; currency: string }) {
  const org = useOrg();
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const q = useOrgQuery<ProjectRevisionsDto>(`/projects/${projectId}/revisions${qs({ order, page, page_size: PAGE_SIZE })}`);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <SkeletonRows rows={4} cols={2} />;
  const { total, data, names } = q.data;

  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return '—';
    switch (field) {
      case 'status':
        return PROJECT_STATUSES.find((s) => s.value === v)?.label ?? String(v);
      case 'client_id':
        return names[String(v)] ?? 'Another client';
      case 'member_ids':
      case 'team_ids':
        return (v as string[]).map((id) => names[id] ?? (field === 'member_ids' ? 'Former member' : 'Removed team')).join(', ');
      case 'billable_default':
        return v ? 'Yes' : 'No';
      case 'estimate_seconds':
        return org.fmtDuration(Number(v));
      case 'estimate_unit':
        return v === 'DAYS' ? 'Days' : 'Hours';
      case 'start_date':
      case 'end_date':
        return fmtDate(String(v));
      case 'pay_rate_minor':
      case 'bill_rate_minor':
        return `${fmtMoney(Number(v), currency)}/h`;
      case 'breaks':
        return Array.isArray(v) ? `${v.length} ${v.length === 1 ? 'break' : 'breaks'}` : '—';
      default:
        return String(v);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="project-revisions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text tabular">{total}</span> {total === 1 ? 'revision' : 'revisions'}
        </p>
        {total > 1 && (
          <SegmentedControl
            size="xs"
            label="Order"
            value={order}
            onChange={(v) => (setOrder(v), setPage(1))}
            options={[
              { value: 'desc', label: 'Newest first' },
              { value: 'asc', label: 'Oldest first' },
            ]}
          />
        )}
      </div>
      {!data.length ? (
        <EmptyState icon={<History className="size-5" />} title="No revisions yet" description="Changes to this project’s details, members and status will be listed here." />
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Revisions">
          {data.map((r) => {
            const a = ACTION_LABELS[r.action] ?? { label: r.action, tone: 'neutral' as const };
            return (
              <li key={r.id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-text-faint">#{r.number}</span>
                  <Badge tone={a.tone}>{a.label}</Badge>
                  <span className="font-medium">{r.actor_name ?? (r.actor_type === 'system' ? 'WorkPulse' : 'Integration')}</span>
                  <time className="tabular text-text-muted" dateTime={r.created_at}>
                    {fmtDateTime(r.created_at, org.organization.timezone)}
                  </time>
                </div>
                {r.reason && <p className="mt-1.5 text-sm text-text-muted">“{r.reason}”</p>}
                {r.changes.length > 0 ? (
                  <dl className="mt-2 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-x-4">
                    {r.changes.map((c) => (
                      <div key={c.field} className="contents">
                        <dt className="text-text-muted">{FIELD_LABELS[c.field] ?? c.field}</dt>
                        <dd className="flex min-w-0 flex-wrap items-center gap-1.5 break-words">
                          {r.action === 'project.created' ? null : c.before_known ? (
                            <>
                              <span className="text-text-muted line-through decoration-text-faint">{show(c.field, c.before)}</span>
                              <ArrowRight aria-label="changed to" className="size-3 shrink-0 text-text-faint" />
                            </>
                          ) : (
                            <span className="text-xs text-text-faint">(previous value not recorded)</span>
                          )}
                          <span>{show(c.field, c.after)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  r.action === 'project.updated' && <p className="mt-1.5 text-xs text-text-faint">Saved with no changes to the details shown here.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
    </div>
  );
}
