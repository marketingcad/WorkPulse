import type { DateRange, RangePreset } from '../components/tracking/time';

/** The longest custom range a list accepts. */
export const MAX_RANGE_DAYS = 400;

const PRESETS: Array<Exclude<RangePreset, 'custom'>> = ['today', 'yesterday', 'this_week', 'last_week'];
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const span = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/**
 * The range in the address (`range=last_week`, or `from=…&to=…`), or `fallback` when it is missing,
 * unknown, malformed or longer than allowed. Reversed dates are put in order.
 */
export function parseRange(p: { range: string | null; from: string | null; to: string | null }, fallback: DateRange, preset: (name: Exclude<RangePreset, 'custom'>) => DateRange): DateRange {
  if (p.range && (PRESETS as string[]).includes(p.range)) return preset(p.range as Exclude<RangePreset, 'custom'>);
  if (isDate(p.from) && isDate(p.to)) {
    const [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
    if (span(from, to) <= MAX_RANGE_DAYS) return { preset: 'custom', from, to };
  }
  return fallback;
}

/** The address params for a range: a preset by name (so "this week" stays this week), else its dates; the default is left out. */
export function rangeParams(r: DateRange, fallback: DateRange): { range: string | null; from: string | null; to: string | null } {
  if (r.preset !== 'custom') return { range: r.preset === fallback.preset ? null : r.preset, from: null, to: null };
  return { range: null, from: r.from, to: r.to };
}
