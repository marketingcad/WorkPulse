'use client';
import { useMemo } from 'react';
import type { EffectivePolicyDto, ProjectDto, TaskDto, WorkerDto } from '@tallywork/contracts';
import { Badge, type Tone } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { Assignment } from '@/components/project-task-picker';

/** Approval action recorded by GET /timesheets/:id/history. */
export interface TimesheetHistoryItem {
  action: string;
  from: string;
  to: string;
  comment: string | null;
  actor_name: string;
  created_at: string;
}

/** Revision row from GET /time-entries/:id/revisions. */
export interface EntryRevision {
  revision: number;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actor_type: string;
  actor_id: string;
  created_at: string;
}

export interface BulkResult {
  id: string;
  ok: boolean;
  error?: string;
}

/** ISO instant -> value for <input type="datetime-local"> in the viewer's browser timezone. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value (browser wall time) -> ISO instant. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const FLAG_META: Record<string, { label: string; tone: Tone }> = {
  high_manual: { label: 'High manual', tone: 'warning' },
  under_expected: { label: 'Under expected', tone: 'warning' },
  over_expected: { label: 'Over expected', tone: 'info' },
  low_activity: { label: 'Low activity', tone: 'secondary' },
  late_time: { label: 'Time added after submit', tone: 'danger' },
  needs_review: { label: 'Needs review', tone: 'warning' },
};

export function FlagBadges({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="text-xs text-text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone={FLAG_META[f]?.tone ?? 'neutral'}>
          {FLAG_META[f]?.label ?? f}
        </Badge>
      ))}
    </span>
  );
}

export function periodLabel(start: string, end: string): string {
  const fmt = (d: string, year: boolean) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  return `${fmt(start, start.slice(0, 4) !== end.slice(0, 4))} – ${fmt(end, true)}`;
}

/**
 * Projects/tasks a member can log time to, for the picker.
 * Own: GET /me/assignments. Another member: there is no per-member assignments
 * endpoint, so options are derived from /projects + /tasks + the worker's teams
 * (the server still validates the target on save).
 */
export function useAssignmentsFor(membershipId: string): { assignments: Assignment[] | undefined; loading: boolean } {
  const org = useOrg();
  const self = membershipId === org.membership.id;
  const mine = useOrgQuery<Assignment[]>(self ? '/me/assignments' : null, { staleTime: 60_000 });
  const projects = useOrgQuery<ProjectDto[]>(self ? null : '/projects', { staleTime: 60_000 });
  const tasks = useOrgQuery<TaskDto[]>(self ? null : '/tasks', { staleTime: 60_000 });
  const worker = useOrgQuery<WorkerDto>(self ? null : `/workers/${membershipId}`, { staleTime: 60_000, retry: false });
  const derived = useMemo(() => {
    if (self || !projects.data) return undefined;
    const teams = new Set(worker.data?.team_ids ?? []);
    return projects.data
      .filter((p) => !p.archived_at && p.status === 'ACTIVE' && (p.member_ids.includes(membershipId) || p.team_ids.some((t) => teams.has(t))))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<Assignment>((p) => ({
        project_id: p.id,
        project_name: p.name,
        color: p.color,
        client_name: p.client_name,
        tasks: (tasks.data ?? []).filter((t) => t.project_id === p.id && t.status !== 'DONE').map((t) => ({ id: t.id, title: t.title, status: t.status })),
      }));
  }, [self, projects.data, tasks.data, worker.data, membershipId]);
  if (self) return { assignments: mine.data, loading: mine.isLoading };
  return { assignments: derived, loading: projects.isLoading || tasks.isLoading };
}

/**
 * Whether policy requires a reason for manual time / edits. Only readable with
 * policies:read; otherwise returns null (unknown) and the UI shows a hint.
 */
export function useReasonPolicy(membershipId: string): { manual: boolean | null; edits: boolean | null } {
  const org = useOrg();
  const q = useOrgQuery<EffectivePolicyDto>(org.can('policies:read') ? `/workers/${membershipId}/effective-policy` : null, { staleTime: 300_000, retry: false });
  const p = q.data?.policy as unknown as { manualTime?: { reasonRequired?: boolean }; timeEdits?: { reasonRequired?: boolean } } | undefined;
  return { manual: p?.manualTime?.reasonRequired ?? null, edits: p?.timeEdits?.reasonRequired ?? null };
}

/** Durations aggregated from TimeEntryDto rows (display only). */
export function sumBy<T>(rows: T[], key: (r: T) => string, val: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return m;
}
