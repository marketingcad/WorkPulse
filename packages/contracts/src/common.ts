import { z } from 'zod';
import { isValidTimeZone } from '@tallywork/domain';
import { phoneProblem, toE164 } from './phone';

export const id = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
export const timeZone = z.string().min(1).max(64).refine(isValidTimeZone, 'Invalid IANA time zone');
export const currency = z.string().length(3).regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code, e.g. USD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
export const nonEmpty = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable();

export const EMAIL_MESSAGE = 'Enter a valid email address, like name@example.com';
/**
 * An email address, with accidental spaces around it removed first (form validation audit, 20 Nov
 * 2026: " ada@example.com" was refused by API clients that do not trim). zod's pattern needs a domain
 * with a dot and a top-level part of 2+ letters, so "user@gmail" and "user.com" are refused.
 */
export const email = z.string().trim().max(254, 'Use at most 254 characters').pipe(z.email(EMAIL_MESSAGE));

export const PERSON_NAME_MESSAGE = "Use letters, spaces, hyphens, apostrophes and periods";
/**
 * A person's name: any script (José, Nguyễn, 李小龙, O'Brien, Mary-Jane), with at least one letter, and
 * none of the symbols a name never needs (<>{}[]\/@#$%^*=+|~`_ ;:!?"&). Digits are allowed so names like
 * "Henry 8" and existing accounts keep working, but a name of digits alone is refused.
 */
const PERSON_NAME = /^[\p{L}\p{M}\p{N}\s'’.,\-()]+$/u;
export const personNameProblem = (v: string): string | null =>
  !/\p{L}/u.test(v) ? 'A name needs at least one letter' : !PERSON_NAME.test(v) ? PERSON_NAME_MESSAGE : null;
export const personName = (max = 100) =>
  nonEmpty(max).superRefine((v, ctx) => {
    // Blank is already 'required'; one message per problem.
    const problem = v ? personNameProblem(v) : null;
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
/** An optional person's name; blank is the same as none. */
export const optionalPersonName = (max = 100) =>
  z
    .string()
    .trim()
    .max(max)
    .superRefine((v, ctx) => {
      const problem = v ? personNameProblem(v) : null;
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional()
    .nullable();

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const dateRangeQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: '`from` must be on or before `to`', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 400, { message: 'Date range is limited to 400 days', path: ['to'] });

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Numbered pages with a total, for lists people page through. `page` is 1-based. */
export interface OffsetPage<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  request_id?: string;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * An optional phone number, stored in E.164 (form validation audit, 20 Nov 2026). It must include its
 * country code ("+63 917 123 4567"); spaces, dashes and brackets are removed. Blank clears it.
 */
export const optionalPhone = z
  .string()
  .trim()
  .max(50, 'Use at most 50 characters')
  .transform((v, ctx) => {
    if (!v) return null;
    const problem = phoneProblem(v);
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
      return z.NEVER;
    }
    return toE164(v);
  })
  .optional()
  .nullable();
