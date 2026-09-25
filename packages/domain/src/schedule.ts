import { addDaysToDate, startOfWeek } from './time';

/**
 * Report schedules use standard 5-field cron (minute hour day-of-month month day-of-week),
 * evaluated in the schedule's time zone. Supported: `*`, numbers, lists `1,15`, ranges `1-5`,
 * steps `*\/15` and `1-30/5`. Day-of-week is 0–6 (Sunday = 0; 7 also means Sunday).
 */
const FIELDS: Array<[min: number, max: number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(src: string, [min, max]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    const lo = m[1] === '*' ? min : Number(m[2]);
    const hi = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : lo;
    if (step < 1 || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

/** Parse a cron expression, or null when it is not valid. */
export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]!));
  if (sets.some((s) => !s)) return null;
  const dow = sets[4]!;
  if (dow.has(7)) dow.add(0);
  return { minute: sets[0]!, hour: sets[1]!, dom: sets[2]!, month: sets[3]!, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

/** Wall-clock parts of `at` in `timeZone`. */
export function zonedParts(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!) };
}

/** Whether the schedule fires in the minute containing `at` (cron day rule: dom OR dow when both are set). */
export function cronMatches(c: Cron, at: Date, timeZone: string): boolean {
  const t = zonedParts(at, timeZone);
  if (!c.minute.has(t.minute) || !c.hour.has(t.hour) || !c.month.has(t.month)) return false;
  const domOk = c.dom.has(t.day);
  const dowOk = c.dow.has(t.dow);
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowOk;
  if (c.dowAny) return domOk;
  return domOk || dowOk;
}

/** Relative date ranges for saved and scheduled reports, resolved on the day they run. */
export const REPORT_RANGES = ['today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export function resolveRange(range: ReportRange, today: string, weekStart: number): { from: string; to: string } {
  const monthStart = (d: string) => `${d.slice(0, 8)}01`;
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDaysToDate(today, -1);
      return { from: y, to: y };
    }
    case 'this_week':
      return { from: startOfWeek(today, weekStart), to: today };
    case 'last_week': {
      const s = addDaysToDate(startOfWeek(today, weekStart), -7);
      return { from: s, to: addDaysToDate(s, 6) };
    }
    case 'last_7_days':
      return { from: addDaysToDate(today, -7), to: addDaysToDate(today, -1) };
    case 'this_month':
      return { from: monthStart(today), to: today };
    case 'last_month': {
      const end = addDaysToDate(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case 'last_30_days':
      return { from: addDaysToDate(today, -30), to: addDaysToDate(today, -1) };
  }
}
