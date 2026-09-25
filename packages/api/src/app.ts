import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { rateLimitBuckets } from '@tallywork/db';
import { DomainError, newId } from '@tallywork/domain';
import type { AppEnv, Deps } from './context';
import { problemFromError } from './lib/http';
import { safeEqual, verifyToken } from './lib/crypto';
import { authenticate } from './middleware/auth';
import { tenant } from './middleware/tenant';
import { rateLimit } from './middleware/rate-limit';

export const API_KEY_REQUESTS_PER_MINUTE = 600;
import { authRoutes, meRoutes } from './routes/auth';
import { orgRoutes } from './routes/org';
import { timeRoutes } from './routes/time';
import { financeRoutes, opsRoutes } from './routes/ops-finance';
import { insightRoutes, platformRoutes } from './routes/insight-platform';
import { agentRoutes } from './routes/agent';
import { dispatchOutbox, runDaily, runTick } from './jobs';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api/v1');

  app.use(async (c, next) => {
    c.set('deps', deps);
    const rid = c.req.header('x-request-id')?.slice(0, 64) || newId();
    c.set('requestId', rid);
    c.header('X-Request-Id', rid);
    await next();
    // Deliver outbox events right after successful mutations (near-real-time without a worker),
    // and run the minute tick opportunistically (lease-guarded) in case cron is unavailable.
    if (c.req.method !== 'GET' && c.res.status < 400) afterMutation(deps);
    deps.defer(() => maybeTick(deps));
  });
  app.use(secureHeaders({ crossOriginResourcePolicy: 'same-origin', referrerPolicy: 'strict-origin-when-cross-origin' }));
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.onError((err, c) => {
    const rid = c.var.requestId ?? 'unknown';
    if (!(err instanceof DomainError)) console.error(JSON.stringify({ level: 'error', request_id: rid, path: c.req.path, msg: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6) : undefined }));
    const p = problemFromError(err, rid);
    return c.json(p, p.status as 400, { 'Content-Type': 'application/problem+json' });
  });
  app.notFound((c) => c.json({ type: 'about:blank', title: 'Not found', status: 404, code: 'route_not_found', request_id: c.var.requestId }, 404));

  app.get('/health', (c) => c.json({ ok: true, time: deps.now().toISOString() }));

  // Signed, short-lived media URLs (screenshots). Authorization happened when the URL was minted.
  app.get('/media/:token', async (c) => {
    const data = verifyToken<{ k: string; o: string; v: string; n?: string }>(deps.config.appSecret, 'media', c.req.param('token'));
    if (!data || !data.k.startsWith(`org/${data.o}/`)) return c.json({ title: 'Link expired', status: 404, code: 'media_expired' }, 404);
    let obj = data.v === 'thumb' ? await deps.storage.get(`${data.k}.thumb`) : null;
    obj ??= await deps.storage.get(data.k);
    if (!obj) return c.json({ title: 'Not found', status: 404, code: 'media_not_found' }, 404);
    // Export files carry a file name and are always downloaded, never rendered inline.
    const disposition: Record<string, string> = data.n ? { 'Content-Disposition': `attachment; filename="${data.n.replace(/[^\w.-]/g, '_')}"` } : {};
    return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", ...disposition } });
  });

  // Vercel Cron (Authorization: Bearer CRON_SECRET).
  const cronAuth = (h: string | undefined) => !!deps.config.cronSecret && !!h && safeEqual(h, `Bearer ${deps.config.cronSecret}`);
  app.get('/cron/tick', async (c) => (cronAuth(c.req.header('authorization')) ? c.json(await runTick(deps)) : c.json({ status: 401, code: 'unauthorized' }, 401)));
  app.get('/cron/daily', async (c) => (cronAuth(c.req.header('authorization')) ? c.json(await runDaily(deps)) : c.json({ status: 401, code: 'unauthorized' }, 401)));

  app.use(authenticate);
  app.route('/auth', authRoutes);
  app.route('/me', meRoutes);
  app.route('/agent', agentRoutes);

  // API keys are rate limited per key (people and devices have their own limits on auth and ingest).
  const apiKeyLimit = rateLimit('api-key', API_KEY_REQUESTS_PER_MINUTE, 60);
  app.use('/orgs/:orgId/*', (c, next) => (c.var.principal?.type === 'api_key' ? apiKeyLimit(c, next) : next()));
  app.use('/orgs/:orgId/*', tenant);
  app.route('/orgs/:orgId', orgRoutes);
  app.route('/orgs/:orgId', timeRoutes);
  app.route('/orgs/:orgId', opsRoutes);
  app.route('/orgs/:orgId', financeRoutes);
  app.route('/orgs/:orgId', insightRoutes);
  app.route('/orgs/:orgId', platformRoutes);

  return app;
}

/** Schedule event dispatch after the response (Next.js `after()` in production). */
export function afterMutation(deps: Deps) {
  deps.defer(async () => {
    await dispatchOutbox(deps, 100).catch((e) => console.error('dispatch failed', e));
  });
}

/** Run the minute tick at most once per minute across all instances (DB lease). */
export async function maybeTick(deps: Deps): Promise<void> {
  if (deps.config.env === 'test') return;
  const minute = new Date(Math.floor(deps.now().getTime() / 60_000) * 60_000);
  const rows = await deps.db
    .insert(rateLimitBuckets)
    .values({ key: 'job:tick', count: 1, windowStart: minute })
    .onConflictDoUpdate({ target: rateLimitBuckets.key, set: { count: sql`case when ${rateLimitBuckets.windowStart} = ${minute} then ${rateLimitBuckets.count} + 1 else 1 end`, windowStart: minute } })
    .returning({ count: rateLimitBuckets.count });
  if ((rows[0]?.count ?? 2) === 1) await runTick(deps).catch((e) => console.error('tick failed', e));
}

export type App = ReturnType<typeof createApp>;
