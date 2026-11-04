import { describe, expect, it } from 'vitest';
import { fromZonedInput, toZonedInput } from '../lib/zoned';

// Audit 28 Oct 2026 (U7/FE-4): entry times are edited on the member's clock, not the browser's.
describe('wall-clock times in a named time zone', () => {
  it('reads and writes a time on another zone’s clock', () => {
    expect(toZonedInput('2026-10-05T14:30:00Z', 'Asia/Manila')).toBe('2026-10-05T22:30');
    expect(fromZonedInput('2026-10-05T22:30', 'Asia/Manila')).toBe('2026-10-05T14:30:00.000Z');
    expect(toZonedInput('2026-10-05T14:30:00Z', 'UTC')).toBe('2026-10-05T14:30');
    expect(fromZonedInput('2026-10-05T09:00', 'America/New_York')).toBe('2026-10-05T13:00:00.000Z');
  });

  it('round-trips across a daylight-saving change', () => {
    // New York: 1 Nov 2026 the clocks go back at 02:00 (EDT -4 → EST -5); 8 Mar 2026 forward.
    expect(fromZonedInput('2026-11-02T09:00', 'America/New_York')).toBe('2026-11-02T14:00:00.000Z');
    expect(fromZonedInput('2026-03-09T09:00', 'America/New_York')).toBe('2026-03-09T13:00:00.000Z');
    for (const iso of ['2026-11-01T05:30:00.000Z', '2026-03-08T08:00:00.000Z', '2026-07-01T00:00:00.000Z']) {
      expect(fromZonedInput(toZonedInput(iso, 'America/New_York'), 'America/New_York')).toBe(iso);
    }
  });

  it('refuses something that is not a time', () => {
    expect(fromZonedInput('', 'UTC')).toBeNull();
    expect(fromZonedInput('tomorrow', 'UTC')).toBeNull();
  });
});
