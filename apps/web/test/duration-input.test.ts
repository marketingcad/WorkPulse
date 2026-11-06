import { describe, expect, it } from 'vitest';
import { asHm, parseDuration } from '../lib/duration';

/** The "Duplicate" dialog prefills a duration as H:MM; it must read back as the same time. */
describe('duration prefill', () => {
  it('rounds to the nearest minute without ever producing ":60"', () => {
    expect(asHm(3570)).toBe('1:00'); // 59.5 min; was "0:60"
    expect(asHm(3540)).toBe('0:59');
    expect(asHm(2 * 3600 + 30 * 60)).toBe('2:30');
    expect(asHm(7199)).toBe('2:00');
    expect(asHm(0)).toBe('0:00');
  });

  it('reads back to the same minutes', () => {
    for (const secs of [59, 60, 3570, 3599, 5400, 7199, 8 * 3600 + 59 * 60]) {
      expect(parseDuration(asHm(secs))).toBe(Math.round(secs / 60) * 60);
    }
  });
});

/** One reading of typed hours for time entry and the calculator (lib/duration.ts). */
describe('parseDuration', () => {
  it('reads every supported way of typing hours', () => {
    const cases: Array<[string, number]> = [
      ['2:30', 9000],
      ['0:05', 300],
      ['120:30', 120 * 3600 + 1800], // a month's total in H:MM
      ['2h 30m', 9000],
      ['2h30', 9000], // the "m" is optional after hours
      ['2h30m', 9000],
      ['2.5h', 9000],
      ['.5h', 1800],
      ['2h', 7200],
      ['90m', 5400],
      ['2.5', 9000],
      ['.5', 1800], // a leading dot
      ['7', 25200],
      [' 1H 15M ', 4500],
    ];
    for (const [typed, secs] of cases) expect(parseDuration(typed), typed).toBe(secs);
  });

  it('refuses anything it would have to guess', () => {
    for (const v of ['', 'eight', '2:60', '2:5', '1,5', '-1', '2h 30s', '2..5', '2:30h', 'h', 'm', '1.5m', '12345:00']) {
      expect(parseDuration(v), v).toBeNull();
    }
  });
});
