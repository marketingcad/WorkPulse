import { addDaysToDate, dayOfWeek } from '../time';

/**
 * Forecasts computed in code (never by the AI), always presented as estimates. Each returns null when
 * there is not enough to go on, and the caller says so instead of guessing.
 */

/**
 * When a project's open tasks will be done at the pace of the last four weeks. `late` when that is
 * after the project's end date. null without open tasks or without any recent progress.
 */
export function finishForecast(input: { open: number; doneLast28: number; today: string; endDate: string | null }): { weeks: number; finishDate: string; late: boolean } | null {
  if (input.open <= 0 || input.doneLast28 <= 0) return null;
  const perWeek = input.doneLast28 / 4;
  const weeks = Math.ceil((input.open / perWeek) * 10) / 10;
  const finishDate = addDaysToDate(input.today, Math.ceil(weeks * 7));
  return { weeks, finishDate, late: input.endDate !== null && finishDate > input.endDate };
}

const isWeekday = (d: string) => {
  const w = dayOfWeek(d);
  return w !== 0 && w !== 6;
};

/**
 * This calendar month's total at month end, from what was recorded on the weekdays before today,
 * scaled to all of the month's weekdays. null in the first working days (fewer than 3 elapsed).
 */
export function monthEndProjection(input: { today: string; soFar: number }): { monthStart: string; monthEnd: string; elapsedWeekdays: number; totalWeekdays: number; projected: number } | null {
  const monthStart = `${input.today.slice(0, 7)}-01`;
  const monthEnd = addDaysToDate(addDaysToDate(monthStart, 32).slice(0, 7) + '-01', -1);
  let elapsedWeekdays = 0;
  let totalWeekdays = 0;
  for (let d = monthStart; d <= monthEnd; d = addDaysToDate(d, 1)) {
    if (!isWeekday(d)) continue;
    totalWeekdays++;
    if (d < input.today) elapsedWeekdays++;
  }
  if (elapsedWeekdays < 3) return null;
  return { monthStart, monthEnd, elapsedWeekdays, totalWeekdays, projected: Math.round((input.soFar * totalWeekdays) / elapsedWeekdays) };
}
