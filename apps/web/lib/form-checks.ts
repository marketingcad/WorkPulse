import { ApiError } from './api';

/**
 * Checks forms run before sending, with the server's rules and wording, so a mistake is shown next
 * to its field at once instead of after a round trip. The server still checks everything.
 *
 * Not imported from @tallywork/contracts: its root brings every schema and zod to the page
 * (test/bundle-imports.test.ts). test/form-checks.test.ts compares these with the server's schemas,
 * so they cannot drift apart.
 *
 * QA audit 11 Nov 2026 (BUG-05, BUG-10): Invite member and New client sent "not-an-email" to the
 * server, New project an end date before its start date, and the join page a too-short password.
 */

/** zod's email pattern, as the server's `z.email()` uses it. */
const EMAIL = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
export const EMAIL_MESSAGE = 'Enter a valid email address, like name@example.com';

/** The server's message for a malformed or too long email, or null when it is fine. */
export function emailProblem(value: string): string | null {
  return EMAIL.test(value) && value.length <= 254 ? null : EMAIL_MESSAGE;
}

/** The server's password rule (10 to 200 characters), or null when it is fine. */
export function passwordProblem(value: string): string | null {
  if (value.length < 10) return 'Use at least 10 characters';
  if (value.length > 200) return 'Use at most 200 characters';
  return null;
}

/** The server's message when an end date ('YYYY-MM-DD') is before the start date; null otherwise or when either is empty. */
export function dateOrderProblem(start: string, end: string): string | null {
  return start && end && end < start ? 'Must be on or after the start date' : null;
}

/** A form error on one field, shaped like the server's, so the form shows it the same way. */
export function fieldError(field: string, message: string): ApiError {
  return new ApiError(422, 'validation', message, undefined, [{ field, message }]);
}
