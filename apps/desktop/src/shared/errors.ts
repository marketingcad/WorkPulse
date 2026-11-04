/**
 * Errors in words a worker understands. Network failures arrive as Chromium codes
 * (net::ERR_INTERNET_DISCONNECTED) or "fetch failed", and a server without a message as
 * "Request failed (502)"; those are replaced. A message the server wrote for people is kept.
 */
export const OFFLINE_MESSAGE = 'Can’t reach WorkPulse. Check your internet connection and try again.';

export function plainError(message: string): string {
  const m = message.trim();
  if (/net::ERR_CERT|certificate/i.test(m)) return 'WorkPulse’s secure connection could not be checked. Make sure the date and time on this computer are right, then try again. If it keeps happening, tell your administrator.';
  if (/net::ERR_|fetch failed|failed to fetch|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(m)) return OFFLINE_MESSAGE;
  const status = /(?:Request|Token refresh) failed \((\d{3})\)/.exec(m)?.[1];
  if (status === '429') return 'Too many attempts. Wait a minute, then try again.';
  if (status?.startsWith('5')) return 'WorkPulse is having a problem right now. Your time is safe on this computer. Try again in a few minutes.';
  if (status) return 'That didn’t work. Try again, and tell your administrator if it keeps happening.';
  return m;
}

/** True when the failure means the server could not be reached at all. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && plainError(e.message) === OFFLINE_MESSAGE);
}
