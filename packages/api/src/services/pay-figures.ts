import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { billingEntries, holidays, projects, rollupWorkerDay, timeEntries, workSchedules, type Tx } from '@tallywork/db';
import { addDaysToDate, amountForSeconds, dayOfWeek, overtimeByDay, resolveRate, startOfWeek, type OvertimeRules } from '@tallywork/domain';
import { loadRates } from './finance';
import { computeShifts } from './operations';
import { timeTypeCoefficients } from './time-types';

const NONE = ['00000000-0000-7000-8000-000000000000'];

export interface PricedEntry {
  membershipId: string;
  projectId: string;
  clientId: string | null;
  localDate: string;
  billable: boolean;
  seconds: number;
  payMinor: number;
  billMinor: number;
  /** priced at approval (the official amount), not estimated */
  approved: boolean;
  /** the pay or bill rate is in another currency: that amount is left out (0) */
  payForeign: boolean;
  billForeign: boolean;
}

/**
 * Every live time entry in [from, to], priced the way pay is made official: approved time at the
 * amounts fixed when it was approved (rounded per entry), and time not approved yet per entry at
 * today's rates and time-type coefficients, exactly as approving it now would. Summaries and
 * estimates built on this agree to the cent with payroll and "Approved owed".
 */
export async function priceEntries(tx: Tx, currency: string, from: string, to: string, membershipIds: string[] | 'all'): Promise<PricedEntry[]> {
  const rows = await tx
    .select({
      m: timeEntries.membershipId,
      p: timeEntries.projectId,
      c: projects.clientId,
      d: timeEntries.localDate,
      billable: timeEntries.billable,
      s: timeEntries.durationSeconds,
      type: timeEntries.timeTypeId,
      bPay: billingEntries.payAmountMinor,
      bBill: billingEntries.billAmountMinor,
      bBillable: billingEntries.billable,
      bCurrency: billingEntries.currency,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(billingEntries, and(eq(billingEntries.timeEntryId, timeEntries.id), isNull(billingEntries.voidedAt)))
    .where(
      and(
        isNull(timeEntries.deletedAt),
        gte(timeEntries.localDate, from),
        lte(timeEntries.localDate, to),
        membershipIds === 'all' ? undefined : inArray(timeEntries.membershipId, membershipIds.length ? membershipIds : NONE),
      ),
    );
  const rates = await loadRates(tx);
  const coef = await timeTypeCoefficients(tx);
  return rows.map((r) => {
    const base = { membershipId: r.m, projectId: r.p, clientId: r.c, localDate: r.d, seconds: r.s };
    if (r.bPay !== null) {
      const foreign = r.bCurrency !== currency;
      return { ...base, billable: !!r.bBillable, payMinor: foreign ? 0 : r.bPay, billMinor: foreign ? 0 : (r.bBill ?? 0), approved: true, payForeign: foreign, billForeign: foreign && !!r.bBillable };
    }
    const rc = { date: r.d, membershipId: r.m, projectId: r.p, clientId: r.c };
    const k = coef(r.type);
    const pay = resolveRate(rates, 'PAY', rc);
    const bill = r.billable ? resolveRate(rates, 'BILL', rc) : null;
    const payForeign = !!pay && pay.currency !== currency;
    const billForeign = !!bill && bill.currency !== currency;
    return {
      ...base,
      billable: r.billable,
      payMinor: pay && !payForeign ? amountForSeconds(Math.round(r.s * k.pay), pay.amountMinor) : 0,
      billMinor: bill && !billForeign ? amountForSeconds(Math.round(r.s * k.bill), bill.amountMinor) : 0,
      approved: false,
      payForeign,
      billForeign,
    };
  });
}

/**
 * Paid holidays in [from, to] and the hours each person is paid for them: their scheduled hours that
 * day (none when it is not one of their working days), or, without a schedule, a standard 8-hour
 * weekday (the same default time off uses). Holidays not marked paid pay nothing.
 */
export async function paidHolidayHours(tx: Tx, membershipIds: string[], from: string, to: string): Promise<Map<string, Array<{ date: string; hours: number }>>> {
  const out = new Map<string, Array<{ date: string; hours: number }>>();
  if (!membershipIds.length) return out;
  const days = (await tx.select({ d: holidays.date }).from(holidays).where(and(eq(holidays.paid, true), gte(holidays.date, from), lte(holidays.date, to)))).map((h) => h.d).sort();
  if (!days.length) return out;
  const scheds = await tx.select().from(workSchedules).where(inArray(workSchedules.membershipId, membershipIds));
  const shifts = await computeShifts(tx, membershipIds, days[0]!, days[days.length - 1]!);
  for (const m of membershipIds) {
    for (const d of days) {
      const scheduled = scheds.some((s) => s.membershipId === m && s.effectiveFrom <= d && (!s.effectiveTo || d < s.effectiveTo));
      const secs = shifts.filter((s) => s.membership_id === m && s.date === d).reduce((n, s) => n + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 1000, 0);
      const hours = scheduled || secs > 0 ? Math.round((secs / 3600) * 100) / 100 : [0, 6].includes(dayOfWeek(d)) ? 0 : 8;
      if (hours > 0) out.set(m, [...(out.get(m) ?? []), { date: d, hours }]);
    }
  }
  return out;
}

/**
 * Regular and overtime seconds per person for the days in [from, to]. Overtime is worked out on whole
 * weeks (loading the days of a week that fall outside the range), then each day keeps its own share
 * (see overtimeByDay), so a week split between two pay periods is not cut into two short weeks.
 */
export async function overtimeInRange(tx: Tx, weekStart: number, rules: OvertimeRules, membershipIds: string[], from: string, to: string): Promise<Map<string, { regular: number; overtime: number }>> {
  const out = new Map<string, { regular: number; overtime: number }>();
  if (!membershipIds.length) return out;
  const first = startOfWeek(from, weekStart);
  const last = addDaysToDate(startOfWeek(to, weekStart), 6);
  const rows = await tx
    .select({ m: rollupWorkerDay.membershipId, d: rollupWorkerDay.localDate, tracked: rollupWorkerDay.trackedSeconds, manual: rollupWorkerDay.manualSeconds })
    .from(rollupWorkerDay)
    .where(and(inArray(rollupWorkerDay.membershipId, membershipIds), gte(rollupWorkerDay.localDate, first), lte(rollupWorkerDay.localDate, last)));
  const weeks = new Map<string, number[]>(); // `${member}|${week start}` → seconds per day
  for (const r of rows) {
    const wk = startOfWeek(r.d, weekStart);
    const key = `${r.m}|${wk}`;
    const days = weeks.get(key) ?? Array(7).fill(0);
    days[Math.round((Date.parse(r.d) - Date.parse(wk)) / 86400000)] += r.tracked + r.manual;
    weeks.set(key, days);
  }
  for (const [key, days] of weeks) {
    const [m, wk] = key.split('|') as [string, string];
    const acc = out.get(m) ?? { regular: 0, overtime: 0 };
    overtimeByDay(days, rules).forEach((d, i) => {
      const date = addDaysToDate(wk, i);
      if (date < from || date > to) return;
      acc.regular += d.regular;
      acc.overtime += d.overtime;
    });
    out.set(m, acc);
  }
  return out;
}
