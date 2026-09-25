import { nearestLimit, type TrackingPolicy } from '@tallywork/domain';

const SHIFT_LEAD_MS = 10 * 60_000;
const LIMIT_WARN_SECONDS = 15 * 60;

/**
 * A "your shift starts soon" reminder is due from 10 minutes before the shift until it
 * starts, while the timer is not running. Returns the reminder's key (one per shift) or null.
 */
export function shiftReminder(next: { starts_at: string } | null, tracking: boolean, now: number, lastKey: string | null): string | null {
  if (!next || tracking) return null;
  const start = Date.parse(next.starts_at);
  if (now < start - SHIFT_LEAD_MS || now >= start) return null;
  const key = `shift|${next.starts_at}`;
  return key === lastKey ? null : key;
}

/**
 * What to do about time limits while tracking: warn once when 15 minutes or less remain,
 * and stop locally once the limit is reached (the server stops the session too).
 */
export function limitAction(
  limits: TrackingPolicy['limits'],
  todaySeconds: number,
  weekSeconds: number,
  today: string,
  lastKey: string | null,
): { action: 'warn' | 'stop'; kind: 'daily' | 'weekly'; remainingSeconds: number; key: string } | null {
  const l = nearestLimit(limits, todaySeconds, weekSeconds);
  if (!l) return null;
  if (l.remainingSeconds <= 0) return { action: 'stop', kind: l.kind, remainingSeconds: 0, key: `stop|${l.kind}|${today}` };
  if (l.remainingSeconds > LIMIT_WARN_SECONDS) return null;
  const key = `warn|${l.kind}|${today}`;
  return key === lastKey ? null : { action: 'warn', kind: l.kind, remainingSeconds: l.remainingSeconds, key };
}
