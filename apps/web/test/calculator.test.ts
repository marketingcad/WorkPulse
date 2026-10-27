import { describe, expect, it } from 'vitest';
import { clockSeconds, convertHours, payFor, shiftSeconds, totalShiftSeconds } from '../components/calculator/math';

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
    expect(payFor({ hours: '7:30', payRate: '75.50', billRate: '120' })).toEqual({ errors: {}, seconds: 27000, payMinor: 56625, billMinor: 90000, marginMinor: 33375 });
    // 1 minute at $10/h is 16.67 cents: rounds to 17.
    expect(payFor({ hours: '1m', payRate: '10', billRate: '' })).toMatchObject({ payMinor: 17, billMinor: null, marginMinor: null });
  });

  it('accepts hours as 7:30, 7h 30m or 7.5, all giving the same pay', () => {
    const pay = (hours: string) => payFor({ hours, payRate: '20', billRate: '' }).payMinor;
    expect([pay('7:30'), pay('7h 30m'), pay('7.5'), pay('450m')]).toEqual([15000, 15000, 15000, 15000]);
  });

  it('refuses a decimal comma rather than reading 12,50 as 1,250.00', () => {
    const r = payFor({ hours: '8', payRate: '12,50', billRate: '' });
    expect(r.errors.payRate).toBe('Enter an amount like 75 or 75.50');
    expect(r.payMinor).toBeNull();
  });

  it('flags unreadable hours and shows nothing until there is enough to work with', () => {
    expect(payFor({ hours: 'eight', payRate: '20', billRate: '' }).errors.hours).toBe('Enter hours like 7:30, 7h 30m or 7.5');
    expect(payFor({ hours: '', payRate: '', billRate: '' })).toEqual({ errors: {}, seconds: null, payMinor: null, billMinor: null, marginMinor: null });
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
    expect(convertHours('soon')).toEqual({ kind: 'error', message: 'Enter hours like 7:30, 7h 30m or 7.5' });
  });
});
