/**
 * The arithmetic behind WorkPulse charts, kept free of React so it can be tested on its own. It never
 * changes a value: it only decides axes, totals and how to compare two periods honestly.
 */

/** Axis ticks from zero: round steps (1, 2, 2.5 or 5 × 10ⁿ) covering `max`. `unit` makes steps whole units (e.g. 3600 for hours). */
export function niceTicks(max: number, count = 4, unit = 1): number[] {
  if (!(max > 0)) return [0];
  const raw = max / unit / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow * unit;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** A row's total over the shown series; `null` when every value is missing (not zero: no data). */
export function rowTotal(row: Record<string, unknown>, keys: string[]): number | null {
  let seen = false;
  let sum = 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      seen = true;
      sum += v;
    }
  }
  return seen ? sum : null;
}

/**
 * Current against previous period, fairly. A period still in progress is compared with the same
 * number of days of the previous one ("so far"), never with the whole of it, which would always
 * look like a drop. Returns null when there is nothing to compare with.
 */
export function periodChange(current: number, previousByDay: number[], elapsedDays: number | null): { previous: number; change: number | null; toDate: boolean } | null {
  if (!previousByDay.length) return null;
  const toDate = elapsedDays !== null && elapsedDays < previousByDay.length;
  const previous = (toDate ? previousByDay.slice(0, Math.max(0, elapsedDays!)) : previousByDay).reduce((a, b) => a + b, 0);
  return { previous, change: previous > 0 ? (current - previous) / previous : null, toDate };
}

/** The largest `keep` items, the rest summed as one "other" item (a donut stays readable). */
export function topWithOther<T extends { value: number }>(items: T[], keep: number, other: (value: number, count: number) => T): T[] {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep + 1) return sorted;
  const rest = sorted.slice(keep);
  return [...sorted.slice(0, keep), other(rest.reduce((s, i) => s + i.value, 0), rest.length)];
}

/** Which x labels to show so they never overlap: every nth, always the first and last. */
export function labelEvery(count: number, room: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, room)));
}
