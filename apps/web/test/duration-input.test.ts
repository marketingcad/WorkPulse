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
