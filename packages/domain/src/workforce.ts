/**
 * Attendance, overtime and time-off rules. Attendance is independent of activity.
 */

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'UNSCHEDULED';

export interface AttendanceInput {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  /** the day's shift time in seconds; with split shifts (09–12 and 13–17) less than end − start */
  scheduledSeconds?: number;
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
    i.scheduledStart && i.scheduledEnd ? (i.scheduledSeconds ?? Math.max(0, (i.scheduledEnd.getTime() - i.scheduledStart.getTime()) / 1000)) : 0;
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
  return overtimeByDay(dailySeconds, rules).reduce((s, d) => ({ regular: s.regular + d.regular, overtime: s.overtime + d.overtime }), { regular: 0, overtime: 0 });
}

/**
 * The same split, day by day in date order: daily overtime on its own day, and weekly overtime on the
 * days its hours were worked (the hours past the weekly threshold, so at the end of the week). A pay
 * period holding part of a week then counts exactly the overtime worked on its own days.
 */
export function overtimeByDay(dailySeconds: number[], rules: OvertimeRules): Array<{ regular: number; overtime: number }> {
  let weekRegular = 0;
  return dailySeconds.map((d) => {
    let regular = d;
    let overtime = 0;
    if (rules.dailyThresholdSeconds !== null && d > rules.dailyThresholdSeconds) {
      overtime = d - rules.dailyThresholdSeconds;
      regular = rules.dailyThresholdSeconds;
    }
    if (rules.weeklyThresholdSeconds !== null) {
      const room = Math.max(0, rules.weeklyThresholdSeconds - weekRegular);
      if (regular > room) {
        overtime += regular - room;
        regular = room;
      }
    }
    weekRegular += regular;
    return { regular, overtime };
  });
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

/**
 * Share of an accrual period a member is entitled to when they join part-way through it:
 * 1 when they were a member for the whole period, otherwise the fraction of days remaining
 * (joining on the last day still earns one day's share). Dates are inclusive ISO dates.
 */
export function proRataFactor(periodStart: string, periodEnd: string, joinedOn: string): number {
  if (joinedOn <= periodStart) return 1;
  if (joinedOn > periodEnd) return 0;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  const total = day(periodEnd) - day(periodStart) + 1;
  const remaining = day(periodEnd) - day(joinedOn) + 1;
  return Math.round((remaining / total) * 10000) / 10000;
}

/** Hours that expire at the start of a new year when only `carryOverHours` may be carried (null = unlimited). */
export function carryOverExpiry(balanceHours: number, carryOverHours: number | null): number {
  if (carryOverHours === null || balanceHours <= carryOverHours) return 0;
  return Math.round((balanceHours - carryOverHours) * 100) / 100;
}

export interface LimitStatus {
  kind: 'daily' | 'weekly';
  limitSeconds: number;
  /** seconds left before the limit (negative = over it) */
  remainingSeconds: number;
}

/** The limit closest to being reached, or null when no limit applies. */
export function nearestLimit(limits: { dailySeconds: number | null; weeklySeconds: number | null }, todaySeconds: number, weekSeconds: number): LimitStatus | null {
  const c: LimitStatus[] = [];
  if (limits.dailySeconds != null) c.push({ kind: 'daily', limitSeconds: limits.dailySeconds, remainingSeconds: limits.dailySeconds - todaySeconds });
  if (limits.weeklySeconds != null) c.push({ kind: 'weekly', limitSeconds: limits.weeklySeconds, remainingSeconds: limits.weeklySeconds - weekSeconds });
  return c.sort((a, b) => a.remainingSeconds - b.remainingSeconds)[0] ?? null;
}
