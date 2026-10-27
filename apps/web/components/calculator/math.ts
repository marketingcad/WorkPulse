import { amountForSeconds } from '@tallywork/domain';
import { asHm, parseDuration } from '../../lib/duration';
import { toMinor } from '../finance/types';

/**
 * The calculator's arithmetic. It reads hours and amounts with the same rules as the rest of WorkPulse
 * ("7:30", "7h 30m" or "7.5"; "75.50", never "75,50") and rounds money as payroll does, so a figure
 * checked here matches the one the app shows.
 */

export const HOURS_HINT = 'Enter hours like 7:30, 7h 30m or 7.5';
export const AMOUNT_HINT = 'Enter an amount like 75 or 75.50';
const DAY = 24 * 3600;

/** "09:00" (or "9:00") → seconds after midnight; null when it is not a time of day. */
export function clockSeconds(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m || Number(m[1]) > 23) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

export interface Shift {
  start: string;
  end: string;
  /** unpaid break, as typed; empty is no break */
  breakText: string;
}

export type ShiftResult =
  | { kind: 'empty' }
  | { kind: 'error'; field: 'start' | 'end' | 'break'; message: string }
  | { kind: 'ok'; seconds: number; overnight: boolean };

/** Time worked in one shift: end − start − break. An end before the start runs past midnight. */
export function shiftSeconds(s: Shift): ShiftResult {
  if (!s.start.trim() && !s.end.trim()) return { kind: 'empty' };
  const start = clockSeconds(s.start);
  if (start === null) return { kind: 'error', field: 'start', message: 'Enter a start time like 09:00' };
  const end = clockSeconds(s.end);
  if (end === null) return { kind: 'error', field: 'end', message: 'Enter an end time like 17:30' };
  if (end === start) return { kind: 'error', field: 'end', message: 'The start and end are the same time' };
  const overnight = end < start;
  const span = overnight ? end + DAY - start : end - start;
  const brk = s.breakText.trim() ? parseDuration(s.breakText) : 0;
  if (brk === null) return { kind: 'error', field: 'break', message: 'Enter the break like 0:30, 30m or 0.5' };
  if (brk >= span) return { kind: 'error', field: 'break', message: 'The break is as long as the shift or longer' };
  return { kind: 'ok', seconds: span - brk, overnight };
}

/** Total of the shifts that read correctly. */
export function totalShiftSeconds(shifts: Shift[]): number {
  return shifts.reduce((sum, s) => {
    const r = shiftSeconds(s);
    return r.kind === 'ok' ? sum + r.seconds : sum;
  }, 0);
}

export interface PayInput {
  hours: string;
  payRate: string;
  billRate: string;
}

export interface PayResult {
  errors: Partial<Record<keyof PayInput, string>>;
  seconds: number | null;
  payMinor: number | null;
  billMinor: number | null;
  /** bill − pay, when both rates are given */
  marginMinor: number | null;
}

/** Pay and bill amounts for a number of hours, each rounded half-up to the cent as payroll and invoices do. */
export function payFor(i: PayInput): PayResult {
  const errors: PayResult['errors'] = {};
  const seconds = i.hours.trim() ? parseDuration(i.hours) : null;
  if (i.hours.trim() && seconds === null) errors.hours = HOURS_HINT;
  const rate = (text: string, field: 'payRate' | 'billRate') => {
    if (!text.trim()) return null;
    const minor = toMinor(text);
    if (minor === null) errors[field] = AMOUNT_HINT;
    return minor;
  };
  const pay = rate(i.payRate, 'payRate');
  const bill = rate(i.billRate, 'billRate');
  const payMinor = seconds !== null && pay !== null ? amountForSeconds(seconds, pay) : null;
  const billMinor = seconds !== null && bill !== null ? amountForSeconds(seconds, bill) : null;
  return { errors, seconds, payMinor, billMinor, marginMinor: payMinor !== null && billMinor !== null ? billMinor - payMinor : null };
}

export type ConvertResult = { kind: 'empty' } | { kind: 'error'; message: string } | { kind: 'ok'; seconds: number; hm: string; decimal: string; minutes: number };

/** One duration in the three ways WorkPulse shows hours: 7:30, 7.50 and 450 minutes. */
export function convertHours(v: string): ConvertResult {
  if (!v.trim()) return { kind: 'empty' };
  const seconds = parseDuration(v);
  if (seconds === null) return { kind: 'error', message: HOURS_HINT };
  return { kind: 'ok', seconds, hm: asHm(seconds), decimal: (seconds / 3600).toFixed(2), minutes: Math.round(seconds / 60) };
}
