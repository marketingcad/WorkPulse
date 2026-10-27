import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { and, eq, sql } from 'drizzle-orm';
import { rateLimitBuckets, withQueryStats } from '@tallywork/db';
import { DomainError, newId } from '@tallywork/domain';
import type { AppEnv, Deps } from './context';
import { fromDatabaseError, problemFromError } from './lib/http';
import { safeEqual, verifyToken } from './lib/crypto';
import { authenticate } from './middleware/auth';
import { tenant } from './middleware/tenant';
import { supportRoutes } from './routes/support';
import { portalRoutes } from './routes/portal';
import { rateLimit } from './middleware/rate-limit';

export const API_KEY_REQUESTS_PER_MINUTE = 600;
import { authRoutes, meRoutes } from './routes/auth';
import { orgRoutes } from './routes/org';
import { timeRoutes } from './routes/time';
import { financeRoutes, opsRoutes } from './routes/ops-finance';
import { insightRoutes, platformRoutes } from './routes/insight-platform';
import { agentRoutes } from './routes/agent';
import { dispatchOutbox, runDaily, runTick } from './jobs';
import { opsMetrics, readiness } from './services/ops';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api/v1');

  app.use(async (c, next) => {
    c.set('deps', deps);
    const rid = c.req.header('x-request-id')?.slice(0, 64) || newId();
    c.set('requestId', rid);
    c.header('X-Request-Id', rid);
    const started = performance.now();
    const db = await withQueryStats(async (stats) => {
      await next();
      return { ...stats };
    });
    const dbMs = Math.round(db.ms);
    // Signed-in requests only: on sign-in and other anonymous routes a query count could tell whether an account exists.
    if (c.var.principal) c.header('Server-Timing', `db;dur=${dbMs};desc="${db.queries} queries, ${db.connects} new connections"`);
    // One structured line per request for log drains: route pattern (no ids or query strings), status, latency and database work.
    if (deps.config.env !== 'test') console.info(JSON.stringify({ level: 'info', msg: 'request', request_id: rid, method: c.req.method, route: c.req.routePath, status: c.res.status, ms: Math.round(performance.now() - started), db_queries: db.queries, db_ms: dbMs, db_connects: db.connects }));
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
    if (!(err instanceof DomainError) && !fromDatabaseError(err)) console.error(JSON.stringify({ level: 'error', request_id: rid, path: c.req.path, msg: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6) : undefined }));
    const p = problemFromError(err, rid);
    return c.json(p, p.status as 400, { 'Content-Type': 'application/problem+json', ...(p.status === 503 ? { 'Retry-After': '5' } : {}) });
  });
  app.notFound((c) => c.json({ type: 'about:blank', title: 'Not found', status: 404, code: 'route_not_found', request_id: c.var.requestId }, 404));

  app.get('/health', (c) => c.json({ ok: true, time: deps.now().toISOString() }));
  // Readiness for load balancers and uptime checks: 503 when the database does not answer.
  app.get('/health/ready', async (c) => {
    const r = await readiness(deps);
    return c.json(r, r.ok ? 200 : 503);
  });

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
  app.get('/cron/tick', async (c) => (cronAuth(c.req.header('authorization')) ? c.json((await runTickOnce(deps)) ?? { skipped: true }) : c.json({ status: 401, code: 'unauthorized' }, 401)));
  // Monitoring: operational gauges and firing alerts (counts only; cron secret required).
  app.get('/ops/metrics', async (c) => (cronAuth(c.req.header('authorization')) ? c.json(await opsMetrics(deps)) : c.json({ status: 401, code: 'unauthorized' }, 401)));
  app.get('/cron/daily', async (c) => (cronAuth(c.req.header('authorization')) ? c.json(await runDaily(deps)) : c.json({ status: 401, code: 'unauthorized' }, 401)));

  app.use(authenticate);
  app.route('/auth', authRoutes);
  app.route('/me', meRoutes);
  app.route('/agent', agentRoutes);

  // API keys are rate limited per key (people and devices have their own limits on auth and ingest).
  const apiKeyLimit = rateLimit('api-key', API_KEY_REQUESTS_PER_MINUTE, 60);
  app.use('/orgs/:orgId/*', (c, next) => (c.var.principal?.type === 'api_key' ? apiKeyLimit(c, next) : next()));
  app.route('/support', supportRoutes);
  app.route('/portal', portalRoutes);
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

const TICK_LEASE = 'job:tick:lease';
/** A run that started longer ago than the function limit (300 s) has crashed; its lease can be taken over. */
const TICK_STALE_MS = 6 * 60_000;

/**
 * Claims the minute tick across all instances: at most one run per minute, and never two at once.
 * The lease row keeps the start of the current or last run in `window_start`; `count` is 1 while it runs.
 * Returns the start time to release with, or null when another run has this minute or is still going.
 */
export async function claimTick(deps: Deps): Promise<Date | null> {
  const now = deps.now();
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const stale = new Date(now.getTime() - TICK_STALE_MS);
  const rows = await deps.db
    .insert(rateLimitBuckets)
    .values({ key: TICK_LEASE, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: { count: 1, windowStart: now },
      setWhere: sql`(${rateLimitBuckets.count} = 0 and ${rateLimitBuckets.windowStart} < ${minute}) or ${rateLimitBuckets.windowStart} < ${stale}`,
    })
    .returning({ startedAt: rateLimitBuckets.windowStart });
  return rows[0]?.startedAt ?? null;
}

export async function releaseTick(deps: Deps, startedAt: Date): Promise<void> {
  await deps.db
    .update(rateLimitBuckets)
    .set({ count: 0 })
    .where(and(eq(rateLimitBuckets.key, TICK_LEASE), eq(rateLimitBuckets.windowStart, startedAt)));
}

/** The minute tick under the shared lease (Vercel Cron and the opportunistic tick both go through here). */
export async function runTickOnce(deps: Deps): Promise<Awaited<ReturnType<typeof runTick>> | null> {
  const startedAt = await claimTick(deps);
  if (!startedAt) return null;
  try {
    return await runTick(deps);
  } finally {
    await releaseTick(deps, startedAt).catch((e) => console.error('tick release failed', e));
  }
}

/** True the first time it is called in each minute: one instance tries the lease once a minute, not on every request. */
export function minuteGate(): (now: Date) => boolean {
  let last = -1;
  return (now) => {
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute === last) return false;
    last = minute;
    return true;
  };
}

const tickGate = minuteGate();

/** Run the minute tick opportunistically, in case cron is unavailable. */
export async function maybeTick(deps: Deps): Promise<void> {
  if (deps.config.env === 'test' || !tickGate(deps.now())) return;
  await runTickOnce(deps).catch((e) => console.error('tick failed', e));
}

export type App = ReturnType<typeof createApp>;
