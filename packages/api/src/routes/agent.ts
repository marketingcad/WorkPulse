import { Hono } from 'hono';
import { z } from 'zod';
import { agentLoginInput, agentRefreshInput, agentRegisterInput, deviceAuthorizeInput, heartbeatInput, ingestBatchInput, isoDate, screenshotUploadInput, timeOffRequestInput } from '@tallywork/contracts';
import { DomainError, forbidden } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { rateLimit } from '../middleware/rate-limit';
import { requireUser, userId } from '../middleware/auth';
import { runInTenantTx } from '../middleware/tenant';
import { myActivity, myNotifications, mySchedule, mySessions, mySummary, myTasks, myTimeOff, myTimesheet, readMyNotifications, requestMyTimeOff, submitMyTimesheet } from '../services/agent-me';
import { acknowledgePolicy, bootstrap, createDeviceAuthCode, heartbeat, ingestBatch, loadAgentCtx, loginDevice, refreshDeviceToken, registerDevice, screenshotKeyPrefix, type AgentCtx } from '../services/agent';

type AgentEnv = AppEnv & { Variables: AppEnv['Variables'] & { agent: AgentCtx } };

const dateQuery = z.object({ date: isoDate.optional() });
/** A date range of at most ~3 months (the own-data API is for personal views, not exports). */
const rangeQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((q) => !q.from || !q.to || (q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 93 * 86_400_000), { message: 'Use a range of up to 93 days' });

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

/** Device principal only; runs inside the device's tenant transaction. */
const agentOnly = new Hono<AgentEnv>().use(async (c, next) => {
  const p = c.var.principal;
  if (!p || p.type !== 'agent') throw new DomainError('unauthenticated', 'device_token_required', 'A device access token is required');
  await runInTenantTx(c as never, p.organizationId, async () => {
    c.set('agent', await loadAgentCtx(c.var.tx, c.var.deps, p));
    await next();
  });
});

agentOnly
  .get('/bootstrap', async (c) => c.json(await bootstrap(c.var.agent)))
  .post('/policy/ack', async (c) => {
    const { hash } = await body(c, z.object({ hash: z.string().max(64) }));
    await acknowledgePolicy(c.var.agent, hash);
    return c.body(null, 204);
  })
  .post('/ingest/batch', rateLimit('ingest', 240, 60), async (c) => c.json(await ingestBatch(c.var.agent, await body(c, ingestBatchInput))))
  .post('/heartbeat', rateLimit('heartbeat', 30, 60), async (c) => {
    const i = await body(c, heartbeatInput);
    return c.json(await heartbeat(c.var.agent, { sessionId: i.session_id, agentVersion: i.agent_version, capabilities: i.capabilities }));
  })
  /** Returns where/how to upload one screenshot (direct-to-Blob token, or this API in dev). */
  .post('/screenshots/upload-intent', async (c) => {
    const a = c.var.agent;
    if (!a.policy.screenshots.enabled) throw forbidden('Screenshots are disabled by policy');
    const i = await body(c, screenshotUploadInput);
    if (i.bytes > MAX_SCREENSHOT_BYTES) throw new DomainError('validation', 'too_large', 'Screenshot is too large');
    const ext = i.content_type.split('/')[1];
    const key = `${screenshotKeyPrefix(a.organizationId, a.membershipId)}${i.captured_at.slice(0, 10)}/${i.screenshot_id}.${ext}`;
    const up = await a.deps.storage.createUploadToken(key, i.content_type, MAX_SCREENSHOT_BYTES);
    const thumb = await a.deps.storage.createUploadToken(`${key}.thumb`, i.content_type, 512 * 1024);
    const apiUrl = (k: string) => `/api/v1/agent/screenshots/upload?key=${encodeURIComponent(k)}`;
    return c.json({ storage_key: key, thumb_key: `${key}.thumb`, method: up.method, token: up.token, thumb_token: thumb.token, upload_url: up.method === 'api' ? apiUrl(key) : (up.url ?? null), thumb_upload_url: thumb.method === 'api' ? apiUrl(`${key}.thumb`) : (thumb.url ?? null) });
  })
  // ── Own data (the device's bound worker only; see services/agent-me.ts) ──
  .get('/me/summary', rateLimit('agent-me', 240, 60), async (c) => c.json(await mySummary(c.var.agent, query(c, rangeQuery))))
  .get('/me/sessions', rateLimit('agent-me', 240, 60), async (c) => c.json(await mySessions(c.var.agent, query(c, rangeQuery))))
  .get('/me/timesheet', rateLimit('agent-me', 240, 60), async (c) => c.json(await myTimesheet(c.var.agent, query(c, dateQuery).date)))
  .post('/me/timesheet/submit', rateLimit('agent-me-write', 30, 60), async (c) => c.json(await submitMyTimesheet(c.var.agent, await body(c, z.object({ date: isoDate, version: z.number().int().positive().optional() })))))
  .get('/me/activity', rateLimit('agent-me', 240, 60), async (c) => c.json(await myActivity(c.var.agent, query(c, dateQuery).date)))
  .get('/me/tasks', rateLimit('agent-me', 240, 60), async (c) => c.json(await myTasks(c.var.agent)))
  .get('/me/schedule', rateLimit('agent-me', 240, 60), async (c) => c.json(await mySchedule(c.var.agent, query(c, rangeQuery))))
  .get('/me/time-off', rateLimit('agent-me', 240, 60), async (c) => c.json(await myTimeOff(c.var.agent)))
  .post('/me/time-off', rateLimit('agent-me-write', 30, 60), async (c) => c.json(await requestMyTimeOff(c.var.agent, await body(c, timeOffRequestInput)), 201))
  .get('/me/notifications', rateLimit('agent-me', 240, 60), async (c) => c.json(await myNotifications(c.var.agent)))
  .post('/me/notifications/read', rateLimit('agent-me-write', 60, 60), async (c) => {
    const { ids } = await body(c, z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(200)]) }));
    await readMyNotifications(c.var.agent, ids);
    return c.body(null, 204);
  })
  /** Fallback upload path (local dev without Blob). */
  .put('/screenshots/upload', async (c) => {
    const a = c.var.agent;
    const key = c.req.query('key') ?? '';
    if (!key.startsWith(screenshotKeyPrefix(a.organizationId, a.membershipId))) throw forbidden('Invalid key');
    const type = c.req.header('content-type') ?? '';
    if (!/^image\/(webp|jpeg|png)$/.test(type)) throw forbidden('Unsupported content type');
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length > MAX_SCREENSHOT_BYTES) throw new DomainError('validation', 'too_large', 'Screenshot is too large');
    await a.deps.storage.put(key, buf, type);
    return c.body(null, 204);
  });

export const agentRoutes = new Hono<AppEnv>()
  /** Called by the signed-in web page during desktop login (PKCE). */
  .post('/authorize', requireUser, async (c) => {
    const i = await body(c, deviceAuthorizeInput);
    return c.json({ code: await createDeviceAuthCode(c.var.deps, userId(c), i.organization_id, i.code_challenge) });
  })
  .post('/register', rateLimit('agent-register', 20, 3600), async (c) => c.json(await registerDevice(c.var.deps, await body(c, agentRegisterInput)), 201))
  /** Desktop sign-in with email + password; 200 with organization_required when the person must pick an organization. */
  .post('/login', rateLimit('agent-login', 20, 900), async (c) => {
    const r = await loginDevice(c.var.deps, await body(c, agentLoginInput));
    return 'organization_required' in r ? c.json(r) : c.json(r, 201);
  })
  .post('/token', rateLimit('agent-token', 60, 3600), async (c) => c.json(await refreshDeviceToken(c.var.deps, (await body(c, agentRefreshInput)).refresh_token)))
  .route('/', agentOnly as never);
