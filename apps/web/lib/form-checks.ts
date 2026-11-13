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

export const REQUIRED_MESSAGE = 'This field is required';

/** The server's rule for a required short text (`nonEmpty(max)`: trimmed, 1 to `max` characters). */
export function requiredTextProblem(value: string, max: number): string | null {
  const v = value.trim();
  if (!v) return REQUIRED_MESSAGE;
  return v.length > max ? `Use at most ${max} characters` : null;
}

export interface SignupForm {
  name: string;
  email: string;
  password: string;
  organization_name: string;
}

/**
 * Every problem with a sign-up form, checked before sending (QA audit 12 Nov 2026, BUG-16): the page
 * sent empty and invalid forms to the server, and each try counted toward the per-address sign-up
 * limit. The email is checked as it is sent (trimmed); an empty organization name is left out.
 */
export function signupProblems(f: SignupForm): Array<{ field: keyof SignupForm; message: string }> {
  const out: Array<{ field: keyof SignupForm; message: string }> = [];
  const add = (field: keyof SignupForm, message: string | null) => void (message && out.push({ field, message }));
  add('name', requiredTextProblem(f.name, 100));
  const email = f.email.trim();
  add('email', email ? emailProblem(email) : REQUIRED_MESSAGE);
  add('password', passwordProblem(f.password));
  if (f.organization_name.trim()) add('organization_name', requiredTextProblem(f.organization_name, 100));
  return out;
}

/** Several field errors at once, shaped like the server's validation error. */
export function formErrors(errors: ReadonlyArray<{ field: string; message: string }>): ApiError {
  return new ApiError(422, 'validation', errors[0]?.message ?? 'Check the form', undefined, [...errors]);
}

/**
 * Problems with a sign-in form, checked before sending (QA audit 13 Nov 2026, BUG-17): an empty form
 * went to the server and came back as one combined line, "Email: This field is required (and 1
 * more)", above the form instead of under each field. Same rules as the server's `loginInput`.
 */
export function loginProblems(f: { email: string; password: string }): Array<{ field: 'email' | 'password'; message: string }> {
  const out: Array<{ field: 'email' | 'password'; message: string }> = [];
  const email = f.email.trim();
  const emailIssue = email ? emailProblem(email) : REQUIRED_MESSAGE;
  if (emailIssue) out.push({ field: 'email', message: emailIssue });
  if (!f.password) out.push({ field: 'password', message: REQUIRED_MESSAGE });
  else if (f.password.length > 200) out.push({ field: 'password', message: 'Use at most 200 characters' });
  return out;
}
