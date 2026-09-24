import { addDays, todayIn, weekStartOf } from '@/lib/org';

/** Offset (ms) of `tz` from UTC at instant `ms` (positive east of UTC). */
export function tzOffsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC epoch ms of local midnight of `date` (YYYY-MM-DD) in `tz`. */
export function dayStartMs(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  // Second pass settles DST transitions.
  t = guess - tzOffsetMs(t, tz);
  return t;
}

export type RangePreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'custom';
export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, tz: string, weekStart: number): DateRange {
  const today = todayIn(tz);
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y };
    }
    case 'this_week': {
      const s = weekStartOf(today, weekStart);
      return { preset, from: s, to: addDays(s, 6) };
    }
    case 'last_week': {
      const s = addDays(weekStartOf(today, weekStart), -7);
      return { preset, from: s, to: addDays(s, 6) };
    }
  }
}

/** Days between two ISO dates (inclusive of both ends). */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDateOf(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}
