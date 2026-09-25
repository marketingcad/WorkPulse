import type { TrackingPolicy } from '@tallywork/domain';
import type { Assignment, IpcPayload } from '../../shared/ipc';

const MAX_SECONDS = 24 * 3600;

/**
 * Checks a manual time request before it is queued, so obvious mistakes are
 * caught while offline. The server re-checks everything (overlaps, locked
 * timesheets, approval) when the request is delivered.
 */
export function manualRequestError(r: IpcPayload<'manualTime:request'>, policy: TrackingPolicy, assignments: Assignment[], now = Date.now()): string | null {
  if (!policy.manualTime.allowed) return 'Manual time is disabled by your organization';
  const project = assignments.find((a) => a.project_id === r.projectId);
  if (!project) return 'You are not assigned to this project';
  if (r.taskId && !project.tasks.some((t) => t.id === r.taskId)) return 'This task is not part of the project';
  const start = Date.parse(r.startedAt);
  const end = Date.parse(r.endedAt);
  if (end <= start) return 'End must be after start';
  if (end > now) return 'Manual time cannot be in the future';
  if ((end - start) / 1000 > MAX_SECONDS) return 'Manual time is limited to 24 hours per entry';
  if (policy.manualTime.reasonRequired && !r.reason.trim()) return 'A reason is required for manual time';
  return null;
}

/** Identifies one reminder per period per calendar day, so the notification is shown at most daily. */
export function reminderKey(due: { period_start: string } | null, today: string): string | null {
  return due ? `${due.period_start}|${today}` : null;
}
