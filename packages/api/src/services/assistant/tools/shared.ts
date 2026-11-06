import { z } from 'zod';
import { isoDate } from '@tallywork/contracts';
import type { Permission } from '@tallywork/domain';
import type { Actor } from '../../../context';

/** Longest date range a data tool accepts, counting both ends. */
export const MAX_RANGE_DAYS = 93;

type Range = { from: string; to: string };
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** `from`/`to` as ISO dates, from on or before to, at most 93 days counting both ends. */
export function dateRange<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({ from: isoDate, to: isoDate, ...extra })
    .strict()
    .refine((v) => (v as Range).from <= (v as Range).to, { message: 'from must be on or before to', path: ['to'] })
    .refine((v) => days((v as Range).from, (v as Range).to) <= MAX_RANGE_DAYS, { message: `Choose a range of up to ${MAX_RANGE_DAYS} days`, path: ['to'] });
}

/** A name argument: a person, project or team name as the user said it. */
export const nameArg = z.string().trim().min(1).max(120);

/** Seconds as decimal hours, rounded to 0.01. */
export const hours = (seconds: number) => Math.round(seconds / 36) / 100;

export const has = (actor: Actor, p: Permission) => actor.grants[p] !== undefined;

/**
 * Match a name against rows the actor may already see (the service applied scope): exact
 * case-insensitive matches first, otherwise every row whose name contains it. Never widens scope:
 * a name outside the list matches nothing.
 */
export function matchByName<R extends { name: string }>(rows: R[], name: string): R[] {
  const q = name.trim().toLowerCase();
  const exact = rows.filter((r) => r.name.toLowerCase() === q);
  return exact.length ? exact : rows.filter((r) => r.name.toLowerCase().includes(q));
}

/** Cap rows and serialized size; reports whether anything was cut. */
export function capOutput<T>(rows: T[], maxRows = 50, maxBytes = 8192): { rows: T[]; truncated: boolean } {
  let n = Math.min(rows.length, maxRows);
  while (n > 0 && Buffer.byteLength(JSON.stringify(rows.slice(0, n))) > maxBytes) n--;
  return { rows: rows.slice(0, n), truncated: n < rows.length };
}

export const NO_MEMBER = 'No matching member you can see.';
export const NO_PROJECT = 'No matching project you can see.';
export const NO_TEAM = 'No matching team you can see.';
