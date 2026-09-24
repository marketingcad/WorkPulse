import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { apiKeys, userSessions, withSystem } from '@tallywork/db';
import { DomainError } from '@tallywork/domain';
import type { AppEnv, Principal } from '../context';
import { safeEqual, sha256, hmac, verifyToken } from '../lib/crypto';

export const SESSION_COOKIE = 'tw_session';
export const API_KEY_PREFIX = 'tw_live_';

export const unauthenticated = () => new DomainError('unauthenticated', 'unauthenticated', 'Please sign in to continue');

interface DeviceTokenPayload extends Record<string, unknown> {
  d: string;
  m: string;
  o: string;
  u: string;
}

/**
 * Resolves the principal from (in order): device bearer token, API key, session cookie.
 * Never throws for missing credentials — routes decide what they require.
 */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db, config, now } = c.var.deps;
  let principal: Principal | null = null;
  const authz = c.req.header('authorization');

  if (authz?.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    if (token.startsWith(API_KEY_PREFIX)) {
      const rest = token.slice(API_KEY_PREFIX.length);
      const sep = rest.indexOf('_');
      const prefix = sep > 0 ? rest.slice(0, sep) : '';
      const secret = sep > 0 ? rest.slice(sep + 1) : '';
      if (prefix && secret) {
        const key = await withSystem(db, async (tx) => {
          const [k] = await tx.select().from(apiKeys).where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt))).limit(1);
          if (!k) return null;
          if (k.expiresAt && k.expiresAt < now()) return null;
          if (!safeEqual(k.secretHash, hmac(config.appSecret, secret))) return null;
          await tx.update(apiKeys).set({ lastUsedAt: now() }).where(eq(apiKeys.id, k.id));
          return k;
        });
        if (key) principal = { type: 'api_key', keyId: key.id, organizationId: key.organizationId, createdBy: key.createdBy, scopes: key.scopes };
      }
      if (!principal) throw new DomainError('unauthenticated', 'invalid_api_key', 'The API key is invalid, expired or revoked');
    } else {
      const payload = verifyToken<DeviceTokenPayload>(config.appSecret, 'device-access', token);
      if (!payload) throw new DomainError('unauthenticated', 'invalid_token', 'The access token is invalid or expired');
      principal = { type: 'agent', deviceId: payload.d, membershipId: payload.m, organizationId: payload.o, userId: payload.u };
    }
  } else {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const [s] = await db
        .select()
        .from(userSessions)
        .where(and(eq(userSessions.tokenHash, sha256(token)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now())))
        .limit(1);
      if (s) {
        principal = { type: 'user', userId: s.userId, sessionId: s.id, mfaVerified: s.mfaVerified };
        // Touch at most every 5 minutes to limit writes.
        if (now().getTime() - s.lastSeenAt.getTime() > 5 * 60_000) {
          await db.update(userSessions).set({ lastSeenAt: now() }).where(eq(userSessions.id, s.id));
        }
        // CSRF: cookie-authenticated state changes must come from our own origin.
        if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) assertSameOrigin(c.req.header('origin'), c.req.header('host'), config.appUrl);
      }
    }
  }
  c.set('principal', principal);
  await next();
};

function assertSameOrigin(origin: string | undefined, host: string | undefined, appUrl: string): void {
  if (!origin) throw new DomainError('forbidden', 'csrf_origin_missing', 'Missing Origin header');
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new DomainError('forbidden', 'csrf_origin_invalid', 'Invalid Origin header');
  }
  const allowed = new Set([new URL(appUrl).host, host].filter(Boolean));
  if (!allowed.has(o.host)) throw new DomainError('forbidden', 'csrf_origin_mismatch', 'Cross-site request blocked');
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.var.principal;
  if (!p || p.type !== 'user') throw unauthenticated();
  await next();
};

export function userId(c: { var: { principal: Principal | null } }): string {
  const p = c.var.principal;
  if (!p || p.type !== 'user') throw unauthenticated();
  return p.userId;
}
