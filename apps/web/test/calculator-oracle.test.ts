import { describe, expect, it } from 'vitest';
import { convertHours, payFor, shiftSeconds, totalShiftSeconds } from '../components/calculator/math';

/**
 * Accuracy check: thousands of seeded random inputs, typed the ways people type them, against an
 * independent reference written here with exact integer arithmetic (BigInt, half-up to the cent).
 * The reference never calls the calculator's code, so a wrong formula, a lost cent or a parsing slip
 * shows up as a mismatch with the input that caused it.
 */

/** mulberry32: a small seeded PRNG, so every run checks the same cases. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pad = (n: number) => String(n).padStart(2, '0');

/** Exact amount for `seconds` at `rateMinor` per hour, rounded half-up to the minor unit. */
function refAmount(seconds: number, rateMinor: number): number {
  const n = BigInt(seconds) * BigInt(rateMinor);
  const q = n / 3600n;
  return Number(2n * (n % 3600n) >= 3600n ? q + 1n : q);
}

/** A rate in minor units typed as "1234.5", "1,234.50" or "75". */
function typeRate(minor: number, style: number): string {
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  const grouped = whole.toLocaleString('en-US');
  if (style === 0) return `${whole}.${pad(cents)}`;
  if (style === 1) return `${grouped}.${pad(cents)}`;
  if (style === 2 && cents === 0) return String(whole);
  if (style === 2 && cents % 10 === 0) return `${whole}.${cents / 10}`;
  return `${whole}.${pad(cents)}`;
}

/** Hours typed as 7:30, 7h 30m, 450m or 7.5 (decimal only when it is exact in hundredths of an hour). */
function typeHours(minutes: number, style: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (style === 0 && h <= 99) return `${h}:${pad(m)}`;
  if (style === 1) return m ? (h ? `${h}h ${m}m` : `${m}m`) : `${h}h`;
  if (style === 2) return `${minutes}m`;
  if (style === 3 && (minutes * 100) % 60 === 0) return String((minutes * 100) / 60 / 100);
  return `${minutes}m`;
}

const CASES = 5_000;

describe('pay and bill against an exact reference', () => {
  it(`${CASES} random hours and rates in every input style`, () => {
    const r = rng(20261028);
    const mismatches: string[] = [];
    for (let i = 0; i < CASES; i++) {
      const minutes = int(r, 0, 300 * 60);
      const pay = int(r, 0, 999_999);
      const bill = int(r, 0, 999_999);
      const input = { hours: typeHours(minutes, int(r, 0, 3)), payRate: typeRate(pay, int(r, 0, 2)), billRate: typeRate(bill, int(r, 0, 2)) };
      const got = payFor(input);
      const want = { payMinor: refAmount(minutes * 60, pay), billMinor: refAmount(minutes * 60, bill) };
      const ok = got.seconds === minutes * 60 && got.payMinor === want.payMinor && got.billMinor === want.billMinor && got.marginMinor === want.billMinor - want.payMinor && Object.keys(got.errors).length === 0;
      if (!ok && mismatches.length < 10) mismatches.push(`${JSON.stringify(input)} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('rounds an exact half cent up, and anything below half down', () => {
    // 1 minute at 0.30/h = 0.5 cent → 1; at 0.29/h = 0.4833 cent → 0.
    expect(payFor({ hours: '1m', payRate: '0.30', billRate: '0.29' })).toMatchObject({ payMinor: 1, billMinor: 0 });
    // Every exact half in a sweep of rates rounds up, matching the reference.
    for (let rate = 1; rate <= 2000; rate++) for (const min of [1, 3, 7, 59]) expect(payFor({ hours: `${min}m`, payRate: typeRate(rate, 0), billRate: '' }).payMinor).toBe(refAmount(min * 60, rate));
  });
});

describe('shift hours against an exact reference', () => {
  it(`${CASES} random shifts, including past midnight`, () => {
    const r = rng(7);
    const mismatches: string[] = [];
    for (let i = 0; i < CASES; i++) {
      const start = int(r, 0, 1439);
      let end = int(r, 0, 1439);
      if (end === start) end = (start + 1) % 1440;
      const span = (end - start + 1440) % 1440;
      const brk = int(r, 0, span - 1);
      const shift = { start: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`, end: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`, breakText: brk ? typeHours(brk, int(r, 0, 2)) : '' };
      const got = shiftSeconds(shift);
      const want = { kind: 'ok', seconds: (span - brk) * 60, overnight: end < start };
      if (JSON.stringify(got) !== JSON.stringify(want) && mismatches.length < 10) mismatches.push(`${JSON.stringify(shift)} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('totals many shifts exactly', () => {
    const r = rng(99);
    for (let t = 0; t < 500; t++) {
      const shifts = Array.from({ length: int(r, 1, 7) }, () => {
        const start = int(r, 0, 1000);
        const len = int(r, 1, 400);
        const brk = int(r, 0, len - 1);
        const end = start + len;
        return { s: { start: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`, end: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`, breakText: brk ? `${brk}m` : '' }, worked: len - brk };
      });
      expect(totalShiftSeconds(shifts.map((x) => x.s))).toBe(shifts.reduce((n, x) => n + x.worked * 60, 0));
    }
  });
});

describe('conversions against an exact reference', () => {
  it('every whole minute up to 99:59 in each style', () => {
    const mismatches: string[] = [];
    for (let minutes = 0; minutes < 100 * 60; minutes++) {
      // Decimal hours to 2 places, rounded half-up with integers only.
      const q = Math.floor((minutes * 100) / 60);
      const hundredths = 2 * ((minutes * 100) % 60) >= 60 ? q + 1 : q;
      const want = { kind: 'ok', seconds: minutes * 60, hm: `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`, decimal: `${Math.floor(hundredths / 100)}.${pad(hundredths % 100)}`, minutes };
      for (const style of [0, 1, 2]) {
        const got = convertHours(typeHours(minutes, style));
        if (JSON.stringify(got) !== JSON.stringify(want) && mismatches.length < 10) mismatches.push(`${typeHours(minutes, style)} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
