'use client';
import { Drawer, EmptyState, ErrorState, Field, Input, SkeletonRows, fmtTime } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

export interface SpanRow {
  name: string;
  detail: string | null;
  started_at: string;
  ended_at: string;
  seconds: number;
}

/** Raw app/URL spans of one member for one day (GET /apps/spans, /urls/spans). */
export function SpansDrawer({
  kind,
  target,
  onDateChange,
  onClose,
}: {
  kind: 'apps' | 'urls';
  target: { membershipId: string; name: string; date: string } | null;
  onDateChange: (date: string) => void;
  onClose: () => void;
}) {
  const org = useOrg();
  const q = useOrgQuery<SpanRow[]>(target ? `/${kind}/spans${qs({ membership_id: target.membershipId, date: target.date })}` : null);
  const label = kind === 'apps' ? 'App' : 'URL';
  return (
    <Drawer open={!!target} onOpenChange={(o) => !o && onClose()} title={`${label} timeline`} subtitle={target?.name} width={560}>
      {target && (
        <div className="border-b border-border px-5 py-3">
          <Field label="Day" htmlFor="spans-date">
            <Input id="spans-date" type="date" className="w-40" value={target.date} onChange={(e) => e.target.value && onDateChange(e.target.value)} />
          </Field>
        </div>
      )}
      {q.isLoading ? (
        <SkeletonRows rows={8} cols={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title={`No ${kind === 'apps' ? 'app' : 'URL'} activity on this day`} description="Spans appear when the desktop app records usage and your tracking policy allows it." />
      ) : (
        <>
          <p className="px-5 pt-3 text-xs text-text-muted">
            {q.data.length} spans{q.data.length >= 2000 && ' (first 2,000 shown)'} · times in your local timezone
          </p>
          <ul className="divide-y divide-border">
            {q.data.map((s, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-2">
                <span className="tabular w-28 shrink-0 pt-0.5 text-xs text-text-muted">
                  {fmtTime(s.started_at)} – {fmtTime(s.ended_at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  {s.detail && s.detail !== s.name && <span className="block truncate text-xs text-text-faint" title={s.detail}>{s.detail}</span>}
                </span>
                <span className="tabular shrink-0 pt-0.5 text-xs font-medium">{org.fmtDuration(s.seconds)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}
