import { localDate, zonedWallTimeToUtc, addDaysToDate } from './time';

/**
 * Screenshot retention: which screenshots a cleanup run may delete, and when the next run is due.
 * Pure functions, shared by the API (scheduling, eligibility) and its tests.
 */
export type CleanupFrequency = 'DAILY' | 'WEEKLY';

export interface CleanupSchedule {
  frequency: CleanupFrequency;
  /** Local wall time, 'HH:MM' (24-hour). */
  runAt: string;
  /** For WEEKLY: 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export const RETENTION_PRESET_DAYS = [7, 14, 30, 60, 90] as const;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
export const DEFAULT_SCREENSHOT_CLEANUP = {
  enabled: true,
  retentionDays: 30,
  frequency: 'DAILY' as CleanupFrequency,
  runAt: '02:00',
  weekday: 0,
  retryFailed: true,
};
/** A screenshot whose storage deletion failed this many times is left for an administrator. */
export const MAX_PURGE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

/**
 * The fixed cutoff for a run: exactly `retentionDays` × 24 hours before the run started. A
 * screenshot is expired when it was captured strictly before the cutoff; one captured exactly at
 * the cutoff is kept.
 */
export function cleanupCutoff(runStartedAt: Date, retentionDays: number): Date {
  return new Date(runStartedAt.getTime() - retentionDays * DAY_MS);
}

export function isExpired(capturedAt: Date, cutoff: Date): boolean {
  return capturedAt.getTime() < cutoff.getTime();
}

export function parseRunAt(runAt: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(runAt);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * The first scheduled run strictly after `after`, at the local `runAt` in `timeZone` (DST-safe:
 * a wall time skipped by spring-forward runs at the first valid instant after it).
 */
export function nextCleanupAt(after: Date, schedule: CleanupSchedule, timeZone: string): Date {
  const at = parseRunAt(schedule.runAt);
  if (!at) throw new Error(`Invalid run time: ${schedule.runAt}`);
  const today = localDate(after, timeZone);
  for (let i = 0; i <= 8; i++) {
    const date = addDaysToDate(today, i);
    if (schedule.frequency === 'WEEKLY' && weekdayOf(date) !== schedule.weekday) continue;
    const candidate = zonedWallTimeToUtc(date, timeZone, at.hour, at.minute);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('No cleanup time found within 8 days');
}

/** A change that would delete more than what was approved: a shorter retention period. */
export function isMaterialRetentionChange(previousDays: number, nextDays: number): boolean {
  return nextDays < previousDays;
}

/** Wait before retrying a failed storage deletion: 2, 4, 8 … minutes, at most a day. */
export function purgeRetryDelayMs(attempts: number): number {
  return Math.min(2 ** Math.max(1, attempts) * 60_000, DAY_MS);
}
