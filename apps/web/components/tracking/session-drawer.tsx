'use client';
import Link from 'next/link';
import type { SessionDto } from '@tallywork/contracts';
import { Drawer, ErrorState, Kbd, SkeletonRows, Stat, StatusBadge, cx, fmtDateTime, fmtTime, humanize } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { localDateOf } from './time';

export interface SessionDetail extends SessionDto {
  transitions: Array<{ from: string | null; to: string; trigger: string; cause: string | null; actor_type: string; occurred_at: string }>;
  segments: Array<{ kind: 'WORK' | 'IDLE' | 'BREAK'; started_at: string; ended_at: string | null }>;
}

const SEGMENT_TONE: Record<string, string> = {
  WORK: 'bg-secondary',
  IDLE: 'bg-warning',
  BREAK: 'bg-info',
};

export function SessionDrawer({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const org = useOrg();
  const q = useOrgQuery<SessionDetail>(sessionId ? `/sessions/${sessionId}` : null);
  const s = q.data;
  const segSeconds = (g: SessionDetail['segments'][number]) => Math.max(0, ((g.ended_at ? Date.parse(g.ended_at) : Date.now()) - Date.parse(g.started_at)) / 1000);

  return (
    <Drawer
      open={!!sessionId}
      onOpenChange={(o) => !o && onClose()}
      title={s ? `${s.project_name ?? 'Session'}${s.task_title ? ` / ${s.task_title}` : ''}` : 'Session'}
      subtitle={s ? `${s.worker_name ?? ''} · ${fmtDateTime(s.started_at)}` : undefined}
      width={520}
    >
      {q.isLoading ? (
        <SkeletonRows rows={6} cols={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : s ? (
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <StatusBadge status={s.state === 'ACTIVE' ? 'TRACKING' : s.state} />
            <StatusBadge status={s.source} />
            {s.end_reason && <span className="text-xs text-text-muted">Ended: {humanize(s.end_reason)}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border px-5 py-4 sm:grid-cols-3">
            <Stat label="Started" value={fmtDateTime(s.started_at)} />
            <Stat label="Ended" value={s.ended_at ? fmtDateTime(s.ended_at) : 'Still running'} />
            <Stat label="Worked" value={org.fmtDuration(s.worked_seconds)} />
          </dl>
          {s.note && (
            <div className="border-b border-border px-5 py-3 text-sm">
              <div className="text-xs text-text-muted">Note</div>
              {s.note}
            </div>
          )}

          <section className="border-b border-border px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold">Segments</h3>
            {s.segments.length === 0 ? (
              <p className="text-sm text-text-muted">No segments recorded.</p>
            ) : (
              <ul className="divide-y divide-border rounded-sm border border-border">
                {s.segments.map((g, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className={cx('size-2 shrink-0 rounded-full', SEGMENT_TONE[g.kind] ?? 'bg-text-faint')} aria-hidden />
                    <span className="w-14 text-xs font-medium">{humanize(g.kind)}</span>
                    <span className="tabular flex-1 text-xs text-text-muted">
                      {fmtTime(g.started_at)} – {g.ended_at ? fmtTime(g.ended_at) : 'now'}
                    </span>
                    <span className="tabular text-xs font-medium">{org.fmtDuration(segSeconds(g))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold">State changes</h3>
            {s.transitions.length === 0 ? (
              <p className="text-sm text-text-muted">No transitions recorded.</p>
            ) : (
              <ol className="relative ml-1.5 border-l border-border">
                {s.transitions.map((t, i) => (
                  <li key={i} className="relative pb-3 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-border-strong" aria-hidden />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="tabular text-xs text-text-muted">{fmtDateTime(t.occurred_at)}</span>
                      <Kbd>{t.trigger}</Kbd>
                      <span className="text-xs">
                        {t.from ? humanize(t.from) : 'New'} → <span className="font-medium">{humanize(t.to)}</span>
                      </span>
                    </div>
                    <div className="text-xs text-text-faint">
                      by {humanize(t.actor_type)}
                      {t.cause && ` · ${humanize(t.cause)}`}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <div className="border-t border-border px-5 py-3">
            <Link href={`${org.base}/activity?member=${s.membership_id}&date=${localDateOf(s.started_at, org.membership.timezone || org.organization.timezone)}`} className="text-sm font-medium text-interactive hover:underline">
              View activity for this day →
            </Link>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
