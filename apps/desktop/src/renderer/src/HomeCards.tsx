import type { AgentState } from '../../shared/ipc';
import { card, fmtDay, fmtHm, fmtTime, useMe, type View } from './lib';
import type { SessionDto, SummaryDto } from './types';

/** Today's totals: live tracked time from the agent; active, idle and activity from the server. */
export function TodaySummaryCard({ s, now }: { s: AgentState; now: number }) {
  const limits = s.policy!.limits;
  const sum = useMe<SummaryDto>('summary', {}, { refreshMs: 60_000, deps: [s.tracking.state, s.tracking.sessionId] });
  const shift = s.nextShift && new Date(s.nextShift.startsAt).toDateString() === new Date(now).toDateString() ? s.nextShift : null;
  const d = sum.data;
  return (
    <section className={card} aria-label="Today's summary">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Today's summary</h2>
        {sum.error && !d && <span className="text-2xs text-warning">Offline</span>}
      </div>
      <dl className="flex flex-col gap-3 px-4 py-3">
        <Total label="Tracked today" seconds={s.todaySeconds} limit={limits.dailySeconds} />
        <Total label="This week" seconds={s.weekSeconds} limit={limits.weeklySeconds} />
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
          <Mini label="Active" value={d ? fmtHm(d.active_seconds) : '—'} />
          <Mini label="Away" value={d ? fmtHm(d.idle_seconds) : '—'} warn={!!d && d.idle_seconds > 0} />
          <Mini label="Activity" value={d?.activity_pct != null ? `${d.activity_pct}%` : '—'} />
        </div>
        {shift && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-text-muted">Your shift</dt>
            <dd className="tabular text-sm font-semibold">
              {fmtTime(shift.startsAt)} – {fmtTime(shift.endsAt)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-text-muted">{label}</dt>
      <dd className={`tabular truncate text-sm font-semibold ${warn ? 'text-warning' : ''}`}>{value}</dd>
    </div>
  );
}

/** A total, with a progress bar toward the organization's limit when it has one. */
export function Total({ label, seconds, limit }: { label: string; seconds: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((seconds / limit) * 100)) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-text-muted">{label}</dt>
        <dd className="tabular text-sm font-semibold">
          {fmtHm(seconds)}
          {limit && <span className="font-normal text-text-muted"> / {fmtHm(limit)}</span>}
        </dd>
      </div>
      {pct !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pct}% of the limit`}>
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : pct >= 90 ? 'bg-warning' : 'bg-interactive'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function CurrentSessionCard({ s, now }: { s: AgentState; now: number }) {
  const t = s.tracking;
  const project = s.assignments.find((a) => a.project_id === t.projectId);
  const task = project?.tasks.find((x) => x.id === t.taskId);
  const running = t.state !== 'stopped' && t.startedAt;
  return (
    <section className={card} aria-label="Current session">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Current session</h2>
      </div>
      {running ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 text-sm">
          <Field label="Started" value={`${fmtTime(t.startedAt!)} · ${fmtHm((now - Date.parse(t.startedAt!)) / 1000)} ago`} />
          <Field label="Status" value={t.state === 'paused' ? 'Paused' : 'Tracking'} />
          <Field label="Project" value={project?.project_name ?? '—'} />
          <Field label="Task" value={task?.title ?? 'No task'} />
          <Field label="Device" value="This computer" />
          <Field label="Note" value={t.note || '—'} />
        </dl>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-text-muted">No session running. Start the timer to begin one.</p>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-text-muted">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function RecentSessionsCard({ s, go }: { s: AgentState; go: (v: View) => void }) {
  const q = useMe<SessionDto[]>('sessions', {}, { refreshMs: 120_000, deps: [s.tracking.state, s.tracking.sessionId] });
  const done = (q.data ?? []).filter((x) => x.state === 'STOPPED').sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 5);
  return (
    <section className={card} aria-label="Recent sessions">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Recent sessions</h2>
        <button onClick={() => go('tracking')} className="text-xs font-medium text-interactive hover:underline">
          View all
        </button>
      </div>
      <SessionList sessions={done} loading={q.loading && !q.data} error={q.error} s={s} empty="No finished sessions in the last 7 days." />
    </section>
  );
}

/** Sessions as rows: project colour, project · task, time range and worked time. */
export function SessionList({ sessions, loading, error, s, empty }: { sessions: SessionDto[]; loading: boolean; error: string | null; s: AgentState; empty: string }) {
  if (loading) return <p className="px-4 py-6 text-center text-sm text-text-muted">Loading…</p>;
  if (error && !sessions.length) return <p className="px-4 py-6 text-center text-sm text-warning">{error}</p>;
  if (!sessions.length) return <p className="px-4 py-6 text-center text-sm text-text-muted">{empty}</p>;
  const color = (id: string) => s.assignments.find((a) => a.project_id === id)?.color ?? 'var(--tw-text-faint)';
  return (
    <ul className="divide-y divide-border">
      {sessions.map((x) => (
        <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color(x.project_id) }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {x.project_name}
              {x.task_title && <span className="font-normal text-text-muted"> · {x.task_title}</span>}
            </span>
            <span className="tabular block text-2xs text-text-muted">
              {fmtDay(localDay(x.started_at))} · {fmtTime(x.started_at)} – {x.ended_at ? fmtTime(x.ended_at) : 'now'}
              {x.source === 'WEB' ? ' · web' : ''}
            </span>
          </span>
          <span className="tabular shrink-0 text-sm font-semibold">{fmtHm(x.worked_seconds)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The calendar day (this computer's zone) of an ISO timestamp, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
