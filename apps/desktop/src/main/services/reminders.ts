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

const BREAK_REMINDER_WINDOW_MS = 10 * 60_000;

/** Minutes since local midnight of an 'HH:MM' time. */
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The local date ('YYYY-MM-DD') and time in minutes since midnight in a time zone. */
export function localClock(now: number, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * A planned break whose time has come: due from its start time for 10 minutes, while the worker
 * is clocked in on that project and not already on a break. Each break is reminded once a day.
 */
export function breakReminder(
  breaks: Array<{ start_time: string | null }>,
  projectId: string,
  clock: { date: string; minutes: number },
  reminded: string[],
): { index: number; key: string } | null {
  for (const [index, b] of breaks.entries()) {
    if (!b.start_time) continue;
    const since = clock.minutes - minutesOf(b.start_time);
    if (since < 0 || since * 60_000 >= BREAK_REMINDER_WINDOW_MS) continue;
    const key = `break|${clock.date}|${projectId}|${index}`;
    if (!reminded.includes(key)) return { index, key };
  }
  return null;
}

/** "Your break is over": once, when a break with a set length has run its length. */
export function breakOver(startedAt: string | null, minutes: number | null, now: number, lastKey: string | null): string | null {
  if (!startedAt || !minutes) return null;
  if (now < Date.parse(startedAt) + minutes * 60_000) return null;
  const key = `over|${startedAt}`;
  return key === lastKey ? null : key;
}
