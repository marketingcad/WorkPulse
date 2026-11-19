/**
 * Size limits shared by the API schemas and the browser. No zod here: web pages import this file
 * alone (@tallywork/contracts/limits), without the schemas.
 */

/** Longest document logo the API accepts, as a data-URL string (about 150 KB of image). */
export const DOCUMENT_LOGO_MAX_CHARS = 200_000;

/** The longest client portal period: `to` at most this many days after `from`. */
export const PORTAL_MAX_RANGE_DAYS = 93;

/**
 * What is wrong with a portal period, so the date fields can say it before asking the server; null when
 * it is valid (the same rule as portalRangeInput).
 */
export function portalRangeProblem(r: { from: string; to: string }): 'missing' | 'order' | 'too_long' | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(r.from) || !day.test(r.to) || Number.isNaN(Date.parse(r.from)) || Number.isNaN(Date.parse(r.to))) return 'missing';
  if (r.from > r.to) return 'order';
  if ((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 > PORTAL_MAX_RANGE_DAYS) return 'too_long';
  return null;
}

/**
 * A host name as the URL list compares them ("bank.example", "intranet", "10.0.0.5"): letters, digits
 * and hyphens in dot-separated labels. Anything else could never match a visited site (form
 * validation audit, 20 Nov 2026).
 */
export const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
