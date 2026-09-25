import { REPORT_RANGES, type ReportRange } from '@tallywork/domain';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';
export const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'CSV', label: 'CSV' },
  { value: 'XLSX', label: 'Excel (XLSX)' },
  { value: 'PDF', label: 'PDF' },
];

/** Relative ranges a saved report can keep (`params.range`); the API resolves them on the day it runs. */
export const RANGE_LABEL: Record<ReportRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  last_7_days: 'Last 7 days',
  this_month: 'This month',
  last_month: 'Last month',
  last_30_days: 'Last 30 days',
};
export const RANGES = REPORT_RANGES.map((value) => ({ value, label: RANGE_LABEL[value] }));

export function isRange(v: unknown): v is ReportRange {
  return typeof v === 'string' && (REPORT_RANGES as readonly string[]).includes(v);
}

export type Frequency = 'daily' | 'weekly' | 'monthly';
export interface Schedule {
  frequency: Frequency;
  /** 0–6, Sunday = 0 (weekly) */
  weekday: number;
  /** 1–28 (monthly) */
  day: number;
  /** HH:MM */
  time: string;
}

export const DEFAULT_SCHEDULE: Schedule = { frequency: 'weekly', weekday: 1, day: 1, time: '08:00' };

/** Choices → 5-field cron (minute hour day-of-month month day-of-week). */
export function buildCron(s: Schedule): string {
  const [h = 0, m = 0] = s.time.split(':').map(Number);
  if (s.frequency === 'daily') return `${m} ${h} * * *`;
  if (s.frequency === 'weekly') return `${m} ${h} * * ${s.weekday}`;
  return `${m} ${h} ${s.day} * *`;
}

/** Inverse of buildCron; null for any other cron expression. */
export function parseSchedule(cron: string | null | undefined): Schedule | null {
  const x = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|\d)$/.exec(cron?.trim().replace(/\s+/g, ' ') ?? '');
  if (!x) return null;
  const minute = Number(x[1]);
  const hour = Number(x[2]);
  if (minute > 59 || hour > 23) return null;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const [, , , dom, dow] = x;
  if (dom === '*' && dow === '*') return { ...DEFAULT_SCHEDULE, frequency: 'daily', time };
  if (dom === '*' && Number(dow) <= 7) return { ...DEFAULT_SCHEDULE, frequency: 'weekly', weekday: Number(dow) % 7, time };
  if (dow === '*' && Number(dom) >= 1 && Number(dom) <= 28) return { ...DEFAULT_SCHEDULE, frequency: 'monthly', day: Number(dom), time };
  return null;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Every Monday at 08:00"; other cron strings are shown as-is. */
export function describeCron(cron: string): string {
  const s = parseSchedule(cron);
  if (!s) return `Cron ${cron}`;
  if (s.frequency === 'daily') return `Every day at ${s.time}`;
  if (s.frequency === 'weekly') return `Every ${WEEKDAY[s.weekday]} at ${s.time}`;
  return `Monthly on the ${ordinal(s.day)} at ${s.time}`;
}
