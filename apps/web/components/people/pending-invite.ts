/**
 * The pending invitation a new one to `email` would replace (QA audit 11 Nov 2026, C-8): inviting an
 * address again revokes its earlier invitation, so that link stops working. The form says so first.
 * Emails are compared the way the server stores them (trimmed, lower case); expired invitations are
 * past use already and are not worth a warning.
 */
export function pendingInviteFor<T extends { email: string; expired: boolean }>(pending: readonly T[] | undefined, email: string): T | undefined {
  const e = email.trim().toLowerCase();
  if (!e) return undefined;
  return pending?.find((i) => !i.expired && i.email.toLowerCase() === e);
}
