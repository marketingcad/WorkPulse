import type { Context } from 'hono';
import { z } from 'zod';
import { DomainError, validation } from '@tallywork/domain';
import type { Problem } from '@tallywork/contracts';

const STATUS: Record<DomainError['category'], number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  business_rule: 422,
  rate_limited: 429,
};

export function problemFromError(err: unknown, requestId: string): Problem {
  if (err instanceof DomainError) {
    const errors = Array.isArray(err.details?.errors) ? (err.details.errors as Problem['errors']) : undefined;
    return {
      type: `https://docs.tallywork.app/errors/${err.code}`,
      title: err.message,
      status: STATUS[err.category],
      code: err.code,
      request_id: requestId,
      ...(errors ? { errors } : {}),
      ...(err.details && !errors ? { detail: JSON.stringify(err.details) } : {}),
    };
  }
  return { type: 'about:blank', title: 'Something went wrong on our side', status: 500, code: 'internal_error', request_id: requestId };
}

function zodToDomain(e: z.ZodError): DomainError {
  const errors = e.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
  return validation(errors[0] ? `${errors[0].field}: ${errors[0].message}` : 'Invalid request', { errors });
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw zodToDomain(r.error);
  return r.data;
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw validation('Request body must be valid JSON');
  }
  return parse(schema, json);
}

export function query<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const q: Record<string, string | string[]> = {};
  const url = new URL(c.req.url);
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    const k = key.endsWith('[]') ? key.slice(0, -2) : key;
    q[k] = key.endsWith('[]') || all.length > 1 ? all : all[0]!;
  }
  return parse(schema, q);
}

/** Opaque cursor for keyset pagination. */
export function encodeCursor(values: Array<string | number>): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Array<string | number> | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(v) ? v : null;
  } catch {
    throw validation('Invalid cursor');
  }
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Parse a comma-separated or repeated id list query param. */
export const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)))
  .pipe(z.array(z.uuid()).max(500).optional());
