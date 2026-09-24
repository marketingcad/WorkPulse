/**
 * Attendance, overtime and time-off rules. Attendance is independent of activity.
 */

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'UNSCHEDULED';

export interface AttendanceInput {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  firstIn: Date | null;
  lastOut: Date | null;
  workedSeconds: number;
  onLeave: boolean;
  isHoliday: boolean;
  lateGraceMinutes: number;
  now: Date;
}

export interface AttendanceResult {
  status: AttendanceStatus;
  lateSeconds: number;
  earlyLeaveSeconds: number;
  scheduledSeconds: number;
  overtimeSeconds: number;
}

export function classifyAttendance(i: AttendanceInput): AttendanceResult {
  const scheduledSeconds =
    i.scheduledStart && i.scheduledEnd ? Math.max(0, (i.scheduledEnd.getTime() - i.scheduledStart.getTime()) / 1000) : 0;
  const base = { lateSeconds: 0, earlyLeaveSeconds: 0, scheduledSeconds, overtimeSeconds: 0 };
  if (i.isHoliday && !i.firstIn) return { ...base, status: 'HOLIDAY' };
  if (i.onLeave && !i.firstIn) return { ...base, status: 'ON_LEAVE' };
  if (!i.scheduledStart || !i.scheduledEnd) {
    return { ...base, status: i.firstIn ? 'PRESENT' : 'UNSCHEDULED', overtimeSeconds: 0 };
  }
  if (!i.firstIn) {
    // Only absent once the shift has started plus grace.
    const graceEnd = i.scheduledStart.getTime() + i.lateGraceMinutes * 60000;
    return { ...base, status: i.now.getTime() > graceEnd ? 'ABSENT' : 'UNSCHEDULED' };
  }
  const lateMs = i.firstIn.getTime() - i.scheduledStart.getTime();
  const lateSeconds = lateMs > i.lateGraceMinutes * 60000 ? Math.round(lateMs / 1000) : 0;
  const shiftOver = i.now >= i.scheduledEnd;
  const earlyLeaveSeconds =
    shiftOver && i.lastOut && i.lastOut < i.scheduledEnd ? Math.round((i.scheduledEnd.getTime() - i.lastOut.getTime()) / 1000) : 0;
  const overtimeSeconds = Math.max(0, i.workedSeconds - scheduledSeconds);
  return { status: lateSeconds > 0 ? 'LATE' : 'PRESENT', lateSeconds, earlyLeaveSeconds, scheduledSeconds, overtimeSeconds };
}

export interface OvertimeRules {
  dailyThresholdSeconds: number | null; // e.g. 8h
  weeklyThresholdSeconds: number | null; // e.g. 40h
}

export const DEFAULT_OVERTIME: OvertimeRules = { dailyThresholdSeconds: null, weeklyThresholdSeconds: 40 * 3600 };

/**
 * Split a week of daily worked seconds into regular and overtime.
 * Daily overtime is computed first; weekly overtime applies to the remaining regular hours.
 */
export function splitOvertime(dailySeconds: number[], rules: OvertimeRules): { regular: number; overtime: number } {
  let overtime = 0;
  let regular = 0;
  for (const d of dailySeconds) {
    if (rules.dailyThresholdSeconds !== null && d > rules.dailyThresholdSeconds) {
      overtime += d - rules.dailyThresholdSeconds;
      regular += rules.dailyThresholdSeconds;
    } else regular += d;
  }
  if (rules.weeklyThresholdSeconds !== null && regular > rules.weeklyThresholdSeconds) {
    overtime += regular - rules.weeklyThresholdSeconds;
    regular = rules.weeklyThresholdSeconds;
  }
  return { regular, overtime };
}

/** Time-off accrual policy. Balance is always the sum of a ledger. */
export interface AccrualPolicy {
  type: 'none' | 'annual' | 'monthly' | 'per_hour_worked';
  /** hours granted per period (annual/monthly) or per hour worked */
  amountHours: number;
  maxBalanceHours: number | null;
  carryOverHours: number | null;
}

export interface LedgerEntry {
  hours: number; // positive = credit, negative = debit
  kind: 'ACCRUAL' | 'REQUEST' | 'REVERSAL' | 'ADJUSTMENT' | 'CARRYOVER_EXPIRY';
}

export function ledgerBalance(entries: LedgerEntry[]): number {
  return Math.round(entries.reduce((s, e) => s + e.hours, 0) * 100) / 100;
}

/** Accrual credit for one period, respecting the balance cap. */
export function accrualCredit(policy: AccrualPolicy, currentBalance: number, hoursWorked = 0): number {
  let credit = 0;
  if (policy.type === 'annual' || policy.type === 'monthly') credit = policy.amountHours;
  else if (policy.type === 'per_hour_worked') credit = hoursWorked * policy.amountHours;
  if (policy.maxBalanceHours !== null) credit = Math.max(0, Math.min(credit, policy.maxBalanceHours - currentBalance));
  return Math.round(credit * 100) / 100;
}

/** Working hours requested between two dates, excluding weekends/holidays, at `hoursPerDay`. */
export function requestedHours(dates: string[], isNonWorking: (d: string) => boolean, hoursPerDay: number, halfDay = false): number {
  const days = dates.filter((d) => !isNonWorking(d)).length;
  return halfDay && days === 1 ? hoursPerDay / 2 : days * hoursPerDay;
}
