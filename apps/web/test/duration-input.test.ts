import { describe, expect, it } from 'vitest';
import { asHm, entryDurationProblem, parseDuration } from '../lib/duration';

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

/** QA audit, 11 Nov 2026 (C-9): "25:00" was told its format was wrong, not that it was too long. */
describe('entryDurationProblem', () => {
  it('names the 24-hour limit for one entry', () => {
    for (const v of ['25:00', '30h', '24:01', '1500m']) expect(entryDurationProblem(v)).toBe('One entry can hold at most 24 hours. Split longer work across days.');
  });
  it('keeps the format hint for what cannot be read, and asks for at least a minute', () => {
    expect(entryDurationProblem('two hours')).toBe('Enter the time worked, e.g. 2:30 or 1.5');
    expect(entryDurationProblem('')).toBe('Enter the time worked, e.g. 2:30 or 1.5');
    expect(entryDurationProblem('0:00')).toBe('Enter at least 1 minute');
  });
  it('accepts up to 24 hours', () => {
    for (const v of ['24:00', '2:30', '2.5', '90m', '0:01']) expect(entryDurationProblem(v)).toBeNull();
  });
});
