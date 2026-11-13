import { ApiError } from '../../lib/api';

/**
 * A timesheet action refused because the timesheet changed since the page loaded (QA audit 13 Nov
 * 2026, BUG-18): approved, submitted or reopened in another tab or by someone else. The server
 * answers 409 (an impossible transition, or a stale version).
 */
export function isConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409;
}

/** What to tell the person: the server's reason, and that the page now shows the current state. */
export function conflictMessage(e: ApiError): string {
  const reason = e.title.replace(/[.\s]+$/, '');
  return `${reason}. It changed since this page opened, so it now shows its current status.`;
}
