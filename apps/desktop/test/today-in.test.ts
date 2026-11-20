import { describe, expect, it } from 'vitest';
import { todayIn } from '../src/renderer/src/dates';

// QA BUG-63: approved time off can be cancelled in the desktop app only until it starts, on the
// worker's own calendar (as the server decides), not the computer's.
describe('today in a time zone', () => {
  const now = new Date('2026-11-20T20:00:00Z'); // 21 November in Manila, still 20 November in New York

  it('is the date in that zone', () => {
    expect(todayIn('Asia/Manila', now)).toBe('2026-11-21');
    expect(todayIn('America/New_York', now)).toBe('2026-11-20');
  });

  it('is the computer’s date without a zone', () => {
    expect(todayIn(undefined, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
