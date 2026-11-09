import { addDaysToDate } from '../time';
import { periodFor, type PayPeriodConfig, type Period as PayPeriod } from '../timesheet';
import type { InsightSection, Period } from './types';

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The period of the same length ending the day before `from` (calendar dates, UTC arithmetic). */
export function previousPeriod(from: string, to: string): Period {
  const days = Math.round((toMs(to) - toMs(from)) / DAY) + 1;
  const end = toMs(from) - DAY;
  return { from: toIso(end - (days - 1) * DAY), to: toIso(end) };
}

/**
 * Change from `previous` to `current` in percent, to one decimal. Null when there is no previous
 * value or it is below `minBaseline`: a change from almost nothing is not a trend.
 */
export function percentChange(current: number, previous: number | null, minBaseline: number): number | null {
  if (previous === null || previous <= 0 || previous < minBaseline) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function findingId(section: InsightSection, category: string, key: string): string {
  return `${section}:${category}:${key}`;
}

/** The pay period just before the one starting on `periodStart`. */
export function previousPayPeriod(periodStart: string, config: PayPeriodConfig, weekStart: number): PayPeriod {
  return periodFor(addDaysToDate(periodStart, -1), config, weekStart);
}

/** Pay periods overlapping [from..to] that ended before `today`: the latest `max` of them, oldest first. */
export function endedPayPeriods(from: string, to: string, today: string, config: PayPeriodConfig, weekStart: number, max: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = periodFor(from, config, weekStart);
  while (p.start <= to) {
    if (p.end < today) out.push(p);
    p = periodFor(addDaysToDate(p.end, 1), config, weekStart);
  }
  return out.slice(-max);
}

const RANK = { warning: 0, attention: 1, info: 2 } as const;

/** The `max` most important findings (warnings first, order kept within a level), and a note when some were left out. */
export function capFindings<F extends { severity: keyof typeof RANK }>(findings: F[], max: number): { findings: F[]; limitation: string | null } {
  if (findings.length <= max) return { findings, limitation: null };
  const sorted = findings.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i).map((x) => x.f);
  return { findings: sorted.slice(0, max), limitation: `Showing the ${max} most important of ${findings.length} findings.` };
}
