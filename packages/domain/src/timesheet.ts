import { conflict } from './errors';
import { addDaysToDate, dayOfWeek, startOfWeek } from './time';

export const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export type TimesheetAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'REOPEN' | 'EDIT';

const TRANSITIONS: Record<TimesheetStatus, Partial<Record<TimesheetAction, TimesheetStatus>>> = {
  DRAFT: { SUBMIT: 'SUBMITTED', EDIT: 'DRAFT' },
  SUBMITTED: { APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_CHANGES: 'DRAFT' },
  REJECTED: { EDIT: 'DRAFT', SUBMIT: 'SUBMITTED' },
  APPROVED: { REOPEN: 'DRAFT' },
};

export function timesheetTransition(from: TimesheetStatus, action: TimesheetAction): TimesheetStatus {
  const to = TRANSITIONS[from][action];
  if (!to) {
    throw conflict('invalid_timesheet_transition', `Cannot ${action.toLowerCase().replace('_', ' ')} a timesheet that is ${from.toLowerCase()}`, { from, action });
  }
  return to;
}

/** Entries of a timesheet are editable only while DRAFT or REJECTED. */
export function isTimesheetEditable(status: TimesheetStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

export type PayPeriodConfig =
  | { type: 'weekly' }
  | { type: 'biweekly'; anchorDate: string }
  | { type: 'semimonthly' }
  | { type: 'monthly' };

export interface Period {
  start: string; // inclusive ISO date
  end: string; // inclusive ISO date
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function lastDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The pay period containing `date`. */
export function periodFor(date: string, config: PayPeriodConfig, weekStart: number): Period {
  switch (config.type) {
    case 'weekly': {
      const start = startOfWeek(date, weekStart);
      return { start, end: addDaysToDate(start, 6) };
    }
    case 'biweekly': {
      const anchor = startOfWeek(config.anchorDate, weekStart);
      const diff = daysBetween(anchor, date);
      const offset = Math.floor(diff / 14) * 14;
      const start = addDaysToDate(anchor, offset);
      return { start, end: addDaysToDate(start, 13) };
    }
    case 'semimonthly': {
      const month = date.slice(0, 8);
      const day = Number(date.slice(8, 10));
      return day <= 15 ? { start: `${month}01`, end: `${month}15` } : { start: `${month}16`, end: lastDayOfMonth(date) };
    }
    case 'monthly':
      return { start: `${date.slice(0, 8)}01`, end: lastDayOfMonth(date) };
  }
}

export function isWeekend(date: string): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}
