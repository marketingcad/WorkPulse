import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { conflictMessage, isConflict } from '../components/timesheets/conflict';

/** QA audit 13 Nov 2026 (BUG-18): a timesheet decided elsewhere meanwhile. */
describe('timesheet conflicts', () => {
  it('a 409 is a conflict; other errors are not', () => {
    expect(isConflict(new ApiError(409, 'invalid_timesheet_transition', 'Cannot approve a timesheet that is approved'))).toBe(true);
    expect(isConflict(new ApiError(409, 'stale_version', 'This timesheet changed; reload and try again'))).toBe(true);
    expect(isConflict(new ApiError(403, 'forbidden', 'Forbidden'))).toBe(false);
    expect(isConflict(new Error('network'))).toBe(false);
  });

  it('says why, and that the page now shows the current status', () => {
    const m = conflictMessage(new ApiError(409, 'invalid_timesheet_transition', 'Cannot approve a timesheet that is approved'));
    expect(m).toBe('Cannot approve a timesheet that is approved. It changed since this page opened, so it now shows its current status.');
    expect(conflictMessage(new ApiError(409, 'stale_version', 'This timesheet changed; reload and try again.'))).toMatch(/^This timesheet changed; reload and try again\. It changed/);
  });
});
