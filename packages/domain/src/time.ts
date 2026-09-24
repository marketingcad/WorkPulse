/**
 * Time utilities. All instants are UTC `Date`s; "local" concepts (dates, midnight)
 * are always computed against an explicit IANA timezone.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface Interval {
  start: Date;
  end: Date;
}

export function durationSeconds(i: Interval): number {
  return Math.max(0, Math.round((i.end.getTime() - i.start.getTime()) / SECOND));
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(instant: Date, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. Positive east of Greenwich. */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / SECOND) * SECOND;
}

/** ISO local date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The UTC instant at which the given local wall-clock time occurs in `timeZone`.
 * For wall times skipped by DST (spring forward) returns the first valid instant after;
 * for ambiguous wall times (fall back) returns the earlier instant.
 */
export function zonedWallTimeToUtc(
  date: string,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute, second);
  // Two-pass offset resolution handles DST boundaries.
  const off1 = tzOffsetMs(new Date(naive), timeZone);
  const guess = naive - off1;
  const off2 = tzOffsetMs(new Date(guess), timeZone);
  if (off2 === off1) return new Date(guess);
  const alt = naive - off2;
  const matches = (t: number) => {
    const p = wallParts(new Date(t), timeZone);
    return p.hour === hour && p.minute === minute && p.second === second;
  };
  const valid = [guess, alt].filter(matches);
  // ambiguous (fall back): earlier instant; gap (spring forward): later instant
  return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(guess, alt));
}

export function startOfLocalDay(date: string, timeZone: string): Date {
  return zonedWallTimeToUtc(date, timeZone, 0, 0, 0);
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for an ISO date string. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Start date of the week containing `date`, with weeks starting on `weekStart` (0=Sun, 1=Mon). */
export function startOfWeek(date: string, weekStart: number): string {
  const dow = dayOfWeek(date);
  const diff = (dow - weekStart + 7) % 7;
  return addDaysToDate(date, -diff);
}

export function eachDate(from: string, toInclusive: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= toInclusive; d = addDaysToDate(d, 1)) out.push(d);
  return out;
}

/**
 * Split an interval at every local midnight in `timeZone`, so each piece belongs
 * to exactly one local date. Used to derive per-day time entries.
 */
export function splitAtLocalMidnight(
  interval: Interval,
  timeZone: string,
): Array<Interval & { localDate: string }> {
  const out: Array<Interval & { localDate: string }> = [];
  let cursor = interval.start;
  while (cursor < interval.end) {
    const day = localDate(cursor, timeZone);
    const nextMidnight = startOfLocalDay(addDaysToDate(day, 1), timeZone);
    const end = nextMidnight < interval.end ? nextMidnight : interval.end;
    if (end > cursor) out.push({ start: cursor, end, localDate: day });
    cursor = end;
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Format seconds as "7h 45m" (or "45m", "0m"). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Format seconds as a clock "HH:MM:SS". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
