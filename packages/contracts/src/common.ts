import { z } from 'zod';
import { isValidTimeZone } from '@tallywork/domain';

export const id = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
export const timeZone = z.string().min(1).max(64).refine(isValidTimeZone, 'Invalid IANA time zone');
export const currency = z.string().length(3).regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code, e.g. USD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
export const nonEmpty = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable();

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
