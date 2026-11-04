import type { MiddlewareHandler } from 'hono';
import { sql } from 'drizzle-orm';
import { rateLimitBuckets } from '@tallywork/db';
import { DomainError } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { clientIp } from '../lib/cidr';

/**
 * Fixed-window rate limiter backed by Postgres (works on serverless without Redis).
 * Keyed by bucket + client IP (or principal when authenticated).
 */
export function rateLimit(bucket: string, max: number, windowSeconds: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { db, config, now } = c.var.deps;
    if (config.env === 'test' && c.req.header('x-test-rate-limit') !== 'on') return next();
    const p = c.var.principal;
    const who =
      p?.type === 'user' ? `u:${p.userId}` : p?.type === 'agent' ? `d:${p.deviceId}` : p?.type === 'api_key' ? `k:${p.keyId}` : `ip:${clientIp((n) => c.req.header(n)) ?? 'local'}`;
    const key = `${bucket}:${who}`;
    const t = now();
    const windowStart = new Date(Math.floor(t.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
    const rows = await db
      .insert(rateLimitBuckets)
      .values({ key, count: 1, windowStart })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: {
          count: sql`case when ${rateLimitBuckets.windowStart} = ${windowStart} then ${rateLimitBuckets.count} + 1 else 1 end`,
          windowStart,
        },
      })
      .returning({ count: rateLimitBuckets.count });
    const count = rows[0]?.count ?? 1;
    if (count > max) {
      const retry = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - t.getTime()) / 1000);
      c.header('Retry-After', String(retry));
      throw new DomainError('rate_limited', 'rate_limited', 'Too many requests. Please slow down.');
    }
    await next();
  };
}
