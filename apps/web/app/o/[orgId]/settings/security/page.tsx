'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, ErrorState, Input, PageHeader, Panel, PermissionState, SkeletonRows, Stat, StatusBadge, cx, useToast } from '@tallywork/ui';
import { ApiError, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

interface Retention {
  data_class: string;
  keep_days: number;
  min_days: number;
}

const CLASS_INFO: Record<string, { label: string; help: string }> = {
  SCREENSHOTS: { label: 'Screenshots', help: 'Screen captures and thumbnails.' },
  ACTIVITY: { label: 'Activity levels', help: 'Per-minute keyboard and mouse counts.' },
  APPS: { label: 'Application usage', help: 'Foreground application names and durations.' },
  URLS: { label: 'Website usage', help: 'Visited domains or addresses, per policy.' },
  SESSIONS: { label: 'Tracking sessions', help: 'Timer sessions, idle and break records.' },
  TIMESHEETS: { label: 'Timesheets', help: 'Submitted and approved timesheets. Kept at least 7 years.' },
  INVOICES: { label: 'Invoices & payments', help: 'Financial records. Kept at least 7 years.' },
  AUDIT: { label: 'Audit log', help: 'Who changed what. Kept at least 1 year.' },
  LOCATION: { label: 'Location', help: 'Not collected today (requires the mobile app).' },
};

function humanDays(d: number): string {
  if (d >= 365 && d % 365 === 0) return `${d / 365} ${d === 365 ? 'year' : 'years'}`;
  if (d >= 365) return `about ${Math.round((d / 365) * 10) / 10} years`;
  if (d >= 30 && d % 30 === 0) return `${d / 30} ${d === 30 ? 'month' : 'months'}`;
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

export default function SecurityPage() {
  const org = useOrg();
  const toast = useToast();
  const canView = org.can('retention:manage') || org.can('settings:security');
  const canEdit = org.can('retention:manage');
  const q = useOrgQuery<Retention[]>(canView ? '/retention-policies' : null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.map((r) => [r.data_class, String(r.keep_days)])));
  }, [q.data]);
  const changed = useMemo(() => (q.data ?? []).filter((r) => draft[r.data_class] !== undefined && Number(draft[r.data_class]) !== r.keep_days), [q.data, draft]);
  const invalid = (q.data ?? []).some((r) => {
    const v = Number(draft[r.data_class]);
    return !Number.isInteger(v) || v < r.min_days || v > 36500;
  });
  const m = useOrgMutation<{ policies: Array<{ data_class: string; keep_days: number }> }, Retention[]>('PUT', '/retention-policies', { onSuccess: () => toast.success('Retention saved') });
  const err = m.error instanceof ApiError ? m.error : null;

  if (!canView) return <PermissionState />;
  const s = org.organization.settings as { sessionTtlHours?: number; requireDeviceApproval?: boolean; enforceMfa?: string };
  const ttl = s.sessionTtlHours ?? 336;

  return (
    <>
      <PageHeader title="Security & retention" description="How long monitoring and business data is kept, and how sign-in is protected." />
      <div className="flex max-w-4xl flex-col gap-4">
        <Panel
          title="Security summary"
          actions={
            org.can('org:update') ? (
              <Link href={`${org.base}/settings`} className="text-sm font-medium text-interactive hover:underline">
                Change in Organization settings
              </Link>
            ) : undefined
          }
        >
          <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <Stat label="Session lifetime" value={ttl >= 48 ? `${Math.round(ttl / 24)} days` : `${ttl} hours`} />
            <div className="min-w-0">
              <dt className="text-xs text-text-muted">New desktop devices</dt>
              <dd className="mt-0.5">{s.requireDeviceApproval ? <StatusBadge status="PENDING" label="Admin approval required" /> : <StatusBadge status="ACTIVE" label="Approved automatically" />}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-text-muted">Two-factor authentication</dt>
              <dd className="mt-0.5 text-sm">
                {s.enforceMfa === 'all' ? 'Required for everyone' : s.enforceMfa === 'admins' ? 'Required for admins' : 'Optional'}
                <span className="block text-xs text-text-faint">Enforcement coming soon</span>
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Data retention"
          actions={
            canEdit && q.data ? (
              <>
                <Button size="sm" disabled={!changed.length || m.isPending} onClick={() => setDraft(Object.fromEntries(q.data!.map((r) => [r.data_class, String(r.keep_days)])))}>
                  Discard
                </Button>
                <Button size="sm" variant="primary" disabled={!changed.length || invalid} loading={m.isPending} onClick={() => m.mutate({ policies: changed.map((r) => ({ data_class: r.data_class, keep_days: Number(draft[r.data_class]) })) })}>
                  Save retention
                </Button>
              </>
            ) : undefined
          }
          footer="Data older than its retention period is permanently deleted by a daily cleanup job. Shortening a period deletes existing older data at the next run."
        >
          {err && (
            <p role="alert" className="m-4 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
              {err.title}
            </p>
          )}
          {q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <SkeletonRows rows={8} cols={3} />
          ) : !q.data?.length ? (
            <EmptyState title="No retention rules" description="Retention defaults are created with the organization. Contact support if this list is empty." />
          ) : (
            <ul className="divide-y divide-border">
              {q.data.map((r) => {
                const info = CLASS_INFO[r.data_class] ?? { label: r.data_class, help: '' };
                const v = draft[r.data_class] ?? String(r.keep_days);
                const n = Number(v);
                const bad = !Number.isInteger(n) || n < r.min_days || n > 36500;
                const id = `ret-${r.data_class}`;
                return (
                  <li key={r.data_class} className={cx('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', n !== r.keep_days && 'bg-interactive-soft/30')}>
                    <div className="min-w-0">
                      <label htmlFor={id} className="block text-sm font-medium">
                        {info.label}
                      </label>
                      <p className="text-xs text-text-muted">{info.help}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                      <span className="inline-flex items-center gap-2">
                        <Input id={id} type="number" min={r.min_days} max={36500} className="tabular w-28 text-right" value={v} disabled={!canEdit} aria-invalid={bad} onChange={(e) => setDraft((d) => ({ ...d, [r.data_class]: e.target.value }))} />
                        <span className="text-xs text-text-muted">days</span>
                      </span>
                      <span className={cx('text-2xs', bad ? 'text-danger' : 'text-text-faint')}>{bad ? `Minimum ${r.min_days} days` : `${humanDays(n)}${r.min_days > 1 ? ` · min ${humanDays(r.min_days)}` : ''}`}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
