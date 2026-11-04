import { refusedReason } from '@tallywork/domain';
/**
 * Records the server refused when they arrived (usually tracked offline under settings that changed
 * meanwhile: a project archived, the worker taken off it, a monitor turned off, a limit reached).
 * They are never dropped silently: the app keeps them on this computer, shows the worker what was
 * not added and why, and lets them ask for the time as manual time (which goes through approval and
 * the server's checks again) or remove the note once they have seen it.
 */
export interface RejectedRecord {
  /** the account (organization:member) that recorded it */
  account: string;
  eventId: string;
  type: string;
  sessionId: string | null;
  projectId: string | null;
  taskId: string | null;
  occurredAt: string;
  code: string;
  message: string;
  rejectedAt: string;
}

/** One thing the worker sees: a session's time, or monitoring data, that was not added. */
export interface NotAddedItem {
  /** the session id, or the event id for records without a session */
  id: string;
  kind: 'time' | 'data';
  projectId: string | null;
  taskId: string | null;
  from: string;
  to: string;
  reason: string;
  count: number;
}

const DATA_TYPES: Record<string, string> = {
  'activity.minutes': 'Activity levels',
  'app.spans': 'App usage',
  'url.spans': 'Website usage',
  'screenshot.captured': 'Screenshots',
  'idle.started': 'Time-away records',
  'idle.resolved': 'Time-away records',
  'session.note': 'Session notes',
};

/** Why, in plain words. `first` is the earliest refused record of the group: its reason explains the rest. */
export function plainReason(first: RejectedRecord, kind: 'time' | 'data'): string {
  // Shared with managers' "Time not added" page (packages/domain/src/refused.ts), in the worker's words.
  const reason = refusedReason(first.code, first.message, { audience: 'worker', data: { label: DATA_TYPES[first.type] ?? 'this data', plural: first.type === 'screenshot.captured' } });
  return reason === 'The server did not accept it.' ? (kind === 'time' ? 'The server did not accept this time.' : 'The server did not accept this data.') : reason;
}

/**
 * Groups refused records by session. A session counts as time not added when any of its session
 * events was refused (its start, a pause, its stop); otherwise only monitoring data was refused.
 */
export function notAddedItems(records: RejectedRecord[]): NotAddedItem[] {
  const groups = new Map<string, RejectedRecord[]>();
  for (const r of records) {
    const key = r.sessionId ?? r.eventId;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([id, rs]) => {
      const sorted = [...rs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      const kind: 'time' | 'data' = sorted.some((r) => r.type.startsWith('session.') && r.type !== 'session.note') ? 'time' : 'data';
      const first = kind === 'time' ? sorted.find((r) => r.type.startsWith('session.'))! : sorted[0]!;
      return {
        id,
        kind,
        projectId: sorted.find((r) => r.projectId)?.projectId ?? null,
        taskId: sorted.find((r) => r.taskId)?.taskId ?? null,
        from: sorted[0]!.occurredAt,
        to: sorted[sorted.length - 1]!.occurredAt,
        reason: plainReason(first, kind),
        count: rs.length,
      };
    })
    .sort((a, b) => b.from.localeCompare(a.from));
}
