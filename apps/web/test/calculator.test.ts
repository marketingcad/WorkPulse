import { describe, expect, it } from 'vitest';
import { clockSeconds, convertHours, decimalHours, lineSeconds, payFor, shiftSeconds, signedHm, sumDurations, totalShiftSeconds } from '../components/calculator/math';

/** The floating calculator: hours and money read and rounded exactly as the rest of WorkPulse does. */
describe('shift hours', () => {
  it('works out end − start − break', () => {
    expect(shiftSeconds({ start: '09:00', end: '17:30', breakText: '0:30' })).toEqual({ kind: 'ok', seconds: 8 * 3600, overnight: false });
    expect(shiftSeconds({ start: '9:15', end: '12:00', breakText: '' })).toEqual({ kind: 'ok', seconds: 2 * 3600 + 45 * 60, overnight: false });
    expect(shiftSeconds({ start: '08:00', end: '16:00', breakText: '45m' })).toMatchObject({ seconds: 7 * 3600 + 15 * 60 });
  });

  it('runs past midnight when the end is earlier than the start', () => {
    expect(shiftSeconds({ start: '22:00', end: '06:00', breakText: '1' })).toEqual({ kind: 'ok', seconds: 7 * 3600, overnight: true });
  });

  it('says which field is wrong instead of guessing', () => {
    expect(shiftSeconds({ start: '', end: '', breakText: '' })).toEqual({ kind: 'empty' });
    expect(shiftSeconds({ start: '25:00', end: '17:00', breakText: '' })).toMatchObject({ kind: 'error', field: 'start' });
    expect(shiftSeconds({ start: '09:00', end: '', breakText: '' })).toMatchObject({ kind: 'error', field: 'end' });
    expect(shiftSeconds({ start: '09:00', end: '09:00', breakText: '' })).toMatchObject({ kind: 'error', field: 'end' });
    expect(shiftSeconds({ start: '09:00', end: '17:00', breakText: 'lunch' })).toMatchObject({ kind: 'error', field: 'break' });
    expect(shiftSeconds({ start: '09:00', end: '10:00', breakText: '1:00' })).toMatchObject({ kind: 'error', field: 'break' });
  });

  it('totals only the shifts that read correctly', () => {
    const shifts = [
      { start: '09:00', end: '17:30', breakText: '0:30' },
      { start: '09:00', end: 'nope', breakText: '' },
      { start: '13:00', end: '15:15', breakText: '' },
    ];
    expect(totalShiftSeconds(shifts)).toBe(10 * 3600 + 15 * 60);
  });

  it('reads 24-hour clock times only', () => {
    expect(clockSeconds('00:00')).toBe(0);
    expect(clockSeconds('23:59')).toBe(23 * 3600 + 59 * 60);
    for (const v of ['24:00', '9', '9:5', '9:60', 'noon']) expect(clockSeconds(v)).toBeNull();
  });
});

describe('pay and bill', () => {
  it('multiplies hours by each rate and rounds half-up to the cent, as payroll does', () => {
    expect(payFor({ hours: '7:30', payRate: '75.50', billRate: '120' })).toEqual({ errors: {}, seconds: 27000, payMinor: 56625, billMinor: 90000, marginMinor: 33375, marginPct: (33375 * 100) / 90000, markupPct: (33375 * 100) / 56625 });
    // 1 minute at $10/h is 16.67 cents: rounds to 17.
    expect(payFor({ hours: '1m', payRate: '10', billRate: '' })).toMatchObject({ payMinor: 17, billMinor: null, marginMinor: null, marginPct: null, markupPct: null });
  });

  it('accepts hours as 7:30, 7h 30m or 7.5, all giving the same pay', () => {
    const pay = (hours: string) => payFor({ hours, payRate: '20', billRate: '' }).payMinor;
    expect([pay('7:30'), pay('7h 30m'), pay('7.5'), pay('450m')]).toEqual([15000, 15000, 15000, 15000]);
  });

  it('refuses a decimal comma rather than reading 12,50 as 1,250.00', () => {
    const r = payFor({ hours: '8', payRate: '12,50', billRate: '' });
    expect(r.errors.payRate).toBe('calc.error.amount');
    expect(r.payMinor).toBeNull();
  });

  it('flags unreadable hours and shows nothing until there is enough to work with', () => {
    expect(payFor({ hours: 'eight', payRate: '20', billRate: '' }).errors.hours).toBe('calc.error.hours');
    expect(payFor({ hours: '', payRate: '', billRate: '' })).toEqual({ errors: {}, seconds: null, payMinor: null, billMinor: null, marginMinor: null, marginPct: null, markupPct: null });
  });

  it('shows a negative margin when billing below cost', () => {
    expect(payFor({ hours: '2', payRate: '50', billRate: '40' }).marginMinor).toBe(-2000);
  });
});

describe('convert hours', () => {
  it('shows one duration as H:MM, decimal hours and minutes', () => {
    expect(convertHours('7.75')).toEqual({ kind: 'ok', seconds: 27900, hm: '7:45', decimal: '7.75', minutes: 465 });
    expect(convertHours('1h 20m')).toEqual({ kind: 'ok', seconds: 4800, hm: '1:20', decimal: '1.33', minutes: 80 });
  });

  it('is empty or explains the format', () => {
    expect(convertHours('  ')).toEqual({ kind: 'empty' });
    expect(convertHours('soon')).toEqual({ kind: 'error', message: 'calc.error.hours' });
  });
});

describe('margin and markup percentages', () => {
  it('are worked out from the rounded amounts shown above them', () => {
    // 8 h: pay $200.00, bill $320.00, margin $120.00 → 37.5 % of the bill, 60 % of the pay.
    const r = payFor({ hours: '8', payRate: '25', billRate: '40' });
    expect(r.marginPct).toBe(37.5);
    expect(r.markupPct).toBe(60);
  });

  it('are negative when billing below cost, and absent when they would divide by zero', () => {
    expect(payFor({ hours: '2', payRate: '50', billRate: '40' })).toMatchObject({ marginPct: -25, markupPct: -20 });
    expect(payFor({ hours: '8', payRate: '0', billRate: '0' })).toMatchObject({ marginMinor: 0, marginPct: null, markupPct: null });
    expect(payFor({ hours: '8', payRate: '0', billRate: '10' })).toMatchObject({ marginPct: 100, markupPct: null });
  });
});

describe('adding and taking away time', () => {
  it('adds and subtracts each line, skipping empty ones', () => {
    const lines = [
      { op: '+' as const, text: '7:30' },
      { op: '+' as const, text: '8h 15m' },
      { op: '+' as const, text: '' },
      { op: '-' as const, text: '45m' },
    ];
    expect(sumDurations(lines)).toBe(15 * 3600); // 7:30 + 8:15 − 0:45
  });

  it('goes below zero and shows the sign', () => {
    const s = sumDurations([{ op: '+', text: '1' }, { op: '-', text: '2:30' }]);
    expect(s).toBe(-1.5 * 3600);
    expect(signedHm(s)).toBe('-1:30');
    expect(decimalHours(s)).toBe('-1.50');
    expect(signedHm(0)).toBe('0:00');
  });

  it('flags a line it cannot read and leaves it out of the total', () => {
    expect(lineSeconds({ op: '+', text: 'lunch' })).toEqual({ kind: 'error', message: 'calc.error.hours' });
    expect(sumDurations([{ op: '+', text: '2' }, { op: '-', text: 'lunch' }])).toBe(2 * 3600);
  });
});
