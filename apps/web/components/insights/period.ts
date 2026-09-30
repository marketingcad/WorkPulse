import { fmtDate } from '@tallywork/ui';
import { addDays, weekStartOf } from '@/lib/org';

export type PeriodMode = 'day' | 'week' | 'fortnight' | 'month';

export const PERIOD_OPTIONS: Array<{ value: PeriodMode; label: string }> = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'fortnight', label: 'Fortnightly' },
  { value: 'month', label: 'Monthly' },
];

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/**
 * The period containing `today`, moved `offset` periods back (negative) or forward.
 * Fortnights follow the biweekly pay-period anchor when there is one, otherwise they are
 * two-week blocks aligned to the workspace's first day of the week.
 */
export function periodRange(mode: PeriodMode, today: string, offset: number, weekStart: number, anchor?: string): { from: string; to: string; label: string } {
  if (mode === 'day') {
    const d = addDays(today, offset);
    return { from: d, to: d, label: fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
  }
  if (mode === 'month') {
    const [y, m] = today.split('-').map(Number) as [number, number];
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const from = first.toISOString().slice(0, 10);
    const to = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { from, to, label: fmtDate(from, { month: 'long', year: 'numeric' }) };
  }
  let from: string;
  if (mode === 'week') from = addDays(weekStartOf(today, weekStart), offset * 7);
  else {
    const base = anchor ?? weekStartOf('2024-01-01', weekStart);
    const blocks = Math.floor(days(base, today) / 14);
    from = addDays(base, (blocks + offset) * 14);
  }
  const to = addDays(from, mode === 'week' ? 6 : 13);
  return { from, to, label: `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}` };
}
