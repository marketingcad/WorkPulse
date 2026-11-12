/**
 * The project form as typed, and the request body built from it. Pure (no React), so it is unit-tested
 * (test/project-rate-start.test.ts); shared.tsx re-exports it.
 */
import { ApiError } from '../../lib/api';
import { toMinor } from '../finance/types';

export interface ProjectForm {
  name: string;
  client_id: string;
  description: string;
  color: string;
  status: string;
  billable_default: boolean;
  member_ids: string[];
  team_ids: string[];
  short_name: string;
  start_date: string;
  end_date: string;
  /** in `estimate_unit`, as typed */
  estimate: string;
  estimate_unit: 'HOURS' | 'DAYS';
  pay_rate: string;
  bill_rate: string;
  /** first day the rates apply, 'YYYY-MM-DD'; '' = the project's start date when earlier, else today (new), or today (edit) */
  rates_from: string;
  /** planned breaks, as typed: time 'HH:MM' or '', minutes or '' */
  breaks: ProjectBreakForm[];
}

export interface ProjectBreakForm {
  break_type_id: string;
  start_time: string;
  minutes: string;
}

export const unitSeconds = (unit: 'HOURS' | 'DAYS', hoursPerDay: number) => (unit === 'DAYS' ? hoursPerDay * 3600 : 3600);

/** The request body's `breaks`; a blank time or length means "any time" / "the break type's maximum". */
export function breaksPayload(breaks: ProjectBreakForm[]) {
  return breaks.map((b, i) => {
    const m = b.minutes.trim() === '' ? null : Number(b.minutes);
    if (m !== null && !(Number.isInteger(m) && m >= 1 && m <= 480)) throw new ApiError(422, 'validation', 'Enter a valid break length', undefined, [{ field: `breaks.${i}.duration_minutes`, message: 'Whole minutes, 1 to 480' }]);
    if (!b.break_type_id) throw new ApiError(422, 'validation', 'Pick a break type', undefined, [{ field: `breaks.${i}.break_type_id`, message: 'Pick a break type' }]);
    return { break_type_id: b.break_type_id, start_time: b.start_time || null, duration_minutes: m };
  });
}

/**
 * Request body for the form. Rates are only sent when they changed and the editor may manage
 * rates; the estimate is converted from hours or days to seconds.
 */
export function projectPayload(f: ProjectForm, opts: { workers?: boolean; teams?: boolean; hoursPerDay?: number; initial?: ProjectForm; canManageRates?: boolean } = {}) {
  // A start date sends the rates with it, so an unchanged amount can be moved to an earlier day.
  const datedRates = !!f.rates_from;
  const rate = (key: 'pay_rate' | 'bill_rate', field: 'pay_rate_minor' | 'bill_rate_minor') => {
    if (!opts.canManageRates || (opts.initial && f[key] === opts.initial[key] && !(datedRates && f[key].trim()))) return {};
    if (!f[key].trim()) return opts.initial ? { [field]: null } : {};
    const minor = toMinor(f[key]);
    if (minor === null) throw new ApiError(422, 'validation', 'Enter a valid amount', undefined, [{ field, message: 'Enter an amount like 75 or 75.50' }]);
    return { [field]: minor };
  };
  const est = f.estimate.trim() === '' ? null : Number(f.estimate);
  if (est !== null && !(est >= 0)) throw new ApiError(422, 'validation', 'Enter a valid estimate', undefined, [{ field: 'estimate_seconds', message: 'A number of hours or days' }]);
  const full = {
    name: f.name,
    client_id: f.client_id || null,
    description: f.description || null,
    color: f.color,
    status: f.status,
    billable_default: f.billable_default,
    short_name: f.short_name.trim() || null,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    estimate_seconds: est === null ? null : Math.round(est * unitSeconds(f.estimate_unit, opts.hoursPerDay ?? 8)),
    estimate_unit: f.estimate_unit,
    ...rate('pay_rate', 'pay_rate_minor'),
    ...rate('bill_rate', 'bill_rate_minor'),
    ...(datedRates && opts.canManageRates ? { rate_effective_from: f.rates_from } : {}),
    breaks: breaksPayload(f.breaks),
    ...(opts.workers ? { member_ids: f.member_ids } : {}),
    ...(opts.teams ? { team_ids: f.team_ids } : {}),
  };
  const i = opts.initial;
  if (!i) return full;
  // Editing: only what was changed here (U3). Access changed meanwhile in Members & teams is not
  // overwritten from this form's snapshot, and an estimate left alone is not recomputed from today's
  // hours per day.
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const estimateSame = f.estimate.trim() === i.estimate.trim() && f.estimate_unit === i.estimate_unit;
  const unchanged: Record<string, boolean> = {
    name: f.name === i.name,
    client_id: (f.client_id || null) === (i.client_id || null),
    description: (f.description || null) === (i.description || null),
    color: f.color === i.color,
    status: f.status === i.status,
    billable_default: f.billable_default === i.billable_default,
    short_name: f.short_name.trim() === i.short_name.trim(),
    start_date: (f.start_date || null) === (i.start_date || null),
    end_date: (f.end_date || null) === (i.end_date || null),
    estimate_seconds: estimateSame,
    estimate_unit: estimateSame,
    breaks: JSON.stringify(full.breaks) === JSON.stringify(breaksPayload(i.breaks)),
    member_ids: sameSet(f.member_ids, i.member_ids),
    team_ids: sameSet(f.team_ids, i.team_ids),
  };
  return Object.fromEntries(Object.entries(full).filter(([k]) => !unchanged[k]));
}
