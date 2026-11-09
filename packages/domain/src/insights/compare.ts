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
