import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiKeys,
  auditLogs,
  deviceCredentials,
  devices,
  fileObjects,
  memberships,
  notificationPreferences,
  notifications,
  retentionPolicies,
  trackingPolicies,
  users,
  webhookDeliveries,
  webhookEndpoints,
  type Tx,
  withSystem,
} from '@tallywork/db';
import { API_KEY_SCOPES, can, forbidden, newId, notFound, resolvePolicy, type DeepPartial, type TrackingPolicy } from '@tallywork/domain';
import type { AuditLogDto, DeviceDto, EffectivePolicyDto, NotificationDto, OffsetPage, apiKeyInput, policyDocInput, retentionInput, webhookInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { policyHash, policyLayers } from './policies';
import { membershipFilter } from './scope';
import { memberNames } from './timer';
import { decrypt, encrypt, hmac, randomToken } from '../lib/crypto';
import { assertPublicUrl, postToPublicUrl } from '../lib/ssrf';
import { iso } from '../lib/http';
import { likePattern } from '../lib/search';

// ─── Devices ─────────────────────────────────────────────────────────────────
type DeviceQuery = { membershipId?: string; id?: string; status?: string; search?: string };

/** Devices the person may see; `search` covers the device name, platform and member. */
function deviceWhere(x: Ctx, q: DeviceQuery) {
  const term = q.search ? likePattern(q.search) : null;
  return and(
    membershipFilter(x.actor, 'devices:read', devices.membershipId),
    q.membershipId ? eq(devices.membershipId, q.membershipId) : undefined,
    q.id ? eq(devices.id, q.id) : undefined,
    q.status ? eq(devices.status, q.status as 'ACTIVE') : undefined,
    term
      ? or(
          ilike(devices.name, term),
          ilike(devices.platform, term),
          inArray(devices.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))),
        )
      : undefined,
  );
}

const deviceOrder = [sql`${devices.lastSeenAt} desc nulls last`, desc(devices.id)];

/** Devices as a plain array, most recently seen first (every match: use `pageDevices` for a page at a time). */
export async function listDevices(x: Ctx, q: DeviceQuery = {}): Promise<DeviceDto[]> {
  const rows = await x.tx.select().from(devices).where(deviceWhere(x, q)).orderBy(...deviceOrder);
  return toDeviceDtos(x, rows);
}

/** One numbered page of devices (`page` is 1-based), the total, and how many there are per status. */
export async function pageDevices(x: Ctx, q: DeviceQuery & { page: number; pageSize: number }): Promise<OffsetPage<DeviceDto> & { summary: { counts: Record<string, number> } }> {
  const byStatus = await x.tx.select({ status: devices.status, n: sql<number>`count(*)::int` }).from(devices).where(deviceWhere(x, { ...q, status: undefined })).groupBy(devices.status);
  const rows = await x.tx.select().from(devices).where(deviceWhere(x, q)).orderBy(...deviceOrder).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const counts: Record<string, number> = { ALL: 0 };
  for (const r of byStatus) {
    counts[r.status] = r.n;
    counts.ALL! += r.n;
  }
  return { data: await toDeviceDtos(x, rows), total: q.status ? (counts[q.status] ?? 0) : counts.ALL!, page: q.page, page_size: q.pageSize, summary: { counts } };
}

async function toDeviceDtos(x: Ctx, rows: Array<typeof devices.$inferSelect>): Promise<DeviceDto[]> {
  const names = await memberNames(x, [...new Set(rows.map((r) => r.membershipId))]);
  return rows.map((d) => ({
    id: d.id,
    membership_id: d.membershipId,
    worker_name: names.get(d.membershipId) ?? '',
    name: d.name,
    platform: d.platform,
    os_version: d.osVersion,
    agent_version: d.agentVersion,
    status: d.status,
    capabilities: d.capabilities,
    last_seen_at: iso(d.lastSeenAt),
    last_sync_at: iso(d.lastSyncAt),
    created_at: d.createdAt.toISOString(),
  }));
}

export async function setDeviceStatus(x: Ctx, id: string, action: 'revoke' | 'approve' | 'reauth') {
  const [d] = await x.tx.select().from(devices).where(eq(devices.id, id));
  if (!d || !can(x.actor, 'devices:read', { ownerMembershipId: d.membershipId })) throw notFound('device');
  if (!can(x.actor, 'devices:manage', { ownerMembershipId: d.membershipId })) throw forbidden();
  if (action === 'approve' && x.actor.grants['devices:manage'] !== 'org') throw forbidden();
  if (action === 'revoke') {
    await x.tx.update(devices).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(eq(devices.id, id));
    await x.tx.update(deviceCredentials).set({ revokedAt: new Date() }).where(and(eq(deviceCredentials.deviceId, id), isNull(deviceCredentials.revokedAt)));
    await emitFrom(x, 'device.revoked', { device_id: id }, { workerId: d.membershipId, deviceId: id });
  } else if (action === 'reauth') {
    await x.tx.update(deviceCredentials).set({ revokedAt: new Date() }).where(and(eq(deviceCredentials.deviceId, id), isNull(deviceCredentials.revokedAt)));
  } else {
    await x.tx.update(devices).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(devices.id, id));
  }
  await audit(x, { action: `device.${action}`, targetType: 'device', targetId: id });
  return (await listDevices(x, { id }))[0]!;
}

// ─── Policies ────────────────────────────────────────────────────────────────
export async function getEffectivePolicy(x: Ctx, membershipId: string): Promise<EffectivePolicyDto> {
  if (!can(x.actor, 'policies:read', { ownerMembershipId: membershipId })) throw notFound('worker');
  const layers = await policyLayers(x.tx, x.org.id, membershipId);
  const policy = resolvePolicy(layers);
  return { policy, hash: policyHash(policy), layers: layers.map((l) => ({ scope: l.scope, scope_id: l.scopeId, doc: l.doc })) };
}

export async function getPolicyLayer(x: Ctx, scopeType: 'ORG' | 'TEAM' | 'WORKER', scopeId: string) {
  if (!x.actor.grants['policies:read']) throw forbidden();
  const [row] = await x.tx.select().from(trackingPolicies).where(and(eq(trackingPolicies.scopeType, scopeType), eq(trackingPolicies.scopeId, scopeId)));
  // Inherited = everything above this layer (org for teams; org + the member's teams for members).
  const base = scopeType === 'ORG' ? resolvePolicy([]) : scopeType === 'TEAM' ? resolvePolicy((await x.tx.select().from(trackingPolicies).where(eq(trackingPolicies.scopeType, 'ORG'))).map((r) => ({ scope: 'ORG' as const, scopeId: r.scopeId, doc: r.doc }))) : resolvePolicy((await policyLayers(x.tx, x.org.id, scopeId)).filter((l) => l.scope !== 'WORKER'));
  return { scope_type: scopeType, scope_id: scopeId, doc: row?.doc ?? {}, version: row?.version ?? 0, inherited: base, updated_at: iso(row?.updatedAt) };
}

export async function putPolicyLayer(x: Ctx, scopeType: 'ORG' | 'TEAM' | 'WORKER', scopeId: string, doc: z.infer<typeof policyDocInput>) {
  if (!x.actor.grants['policies:manage']) throw forbidden();
  if (scopeType === 'ORG' && scopeId !== x.org.id) throw notFound('policy');
  // Validate that the merged result is still a complete, valid policy.
  resolvePolicy([{ scope: scopeType, scopeId, doc: doc as DeepPartial<TrackingPolicy> }]);
  const [before] = await x.tx.select().from(trackingPolicies).where(and(eq(trackingPolicies.scopeType, scopeType), eq(trackingPolicies.scopeId, scopeId)));
  await x.tx
    .insert(trackingPolicies)
    .values({ id: newId(), organizationId: x.org.id, scopeType, scopeId, doc: doc as DeepPartial<TrackingPolicy>, updatedBy: x.actor.membershipId })
    .onConflictDoUpdate({
      target: [trackingPolicies.organizationId, trackingPolicies.scopeType, trackingPolicies.scopeId],
      set: { doc: doc as DeepPartial<TrackingPolicy>, version: sql`${trackingPolicies.version} + 1`, updatedBy: x.actor.membershipId, updatedAt: new Date() },
    });
  // Transparency: affected workers are notified that monitoring settings changed.
  await emitFrom(x, 'policy.changed', { scope_type: scopeType, scope_id: scopeId });
  await audit(x, { action: 'policy.updated', targetType: `policy_${scopeType.toLowerCase()}`, targetId: scopeId, before: before?.doc ?? null, after: doc });
  return getPolicyLayer(x, scopeType, scopeId);
}

// ─── API keys ────────────────────────────────────────────────────────────────
export async function listApiKeys(x: Ctx) {
  if (!x.actor.grants['api_keys:manage']) throw forbidden();
  const rows = await x.tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  const names = await memberNames(x, [...new Set(rows.map((r) => r.createdBy))]);
  return rows.map((k) => ({ id: k.id, name: k.name, prefix: `tw_live_${k.prefix}`, scopes: k.scopes, created_by_name: names.get(k.createdBy) ?? '', last_used_at: iso(k.lastUsedAt), expires_at: iso(k.expiresAt), revoked_at: iso(k.revokedAt), created_at: k.createdAt.toISOString() }));
}

export async function createApiKey(x: Ctx, input: z.infer<typeof apiKeyInput>) {
  if (!x.actor.grants['api_keys:manage']) throw forbidden();
  if (x.actor.principal.type !== 'user') throw forbidden('API keys can only be created by signed-in users');
  for (const s of input.scopes) if (!x.actor.grants[API_KEY_SCOPES[s]]) throw forbidden(`You cannot grant ${s}`);
  const prefix = randomToken(6).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).padEnd(8, 'x');
  const secret = randomToken(32);
  const id = newId();
  // x.actor.userId is the creating user; keys act as that member (intersected with scopes).
  const [m] = await x.tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, x.actor.membershipId));
  await x.tx.insert(apiKeys).values({ id, organizationId: x.org.id, name: input.name, prefix, secretHash: hmac(x.deps.config.appSecret, secret), scopes: input.scopes, createdBy: m!.userId, expiresAt: input.expires_at ? new Date(input.expires_at) : null });
  await audit(x, { action: 'api_key.created', targetType: 'api_key', targetId: id, after: { name: input.name, scopes: input.scopes } });
  return { id, name: input.name, scopes: input.scopes, key: `tw_live_${prefix}_${secret}`, note: 'Store this key now. It will not be shown again.' };
}

export async function revokeApiKey(x: Ctx, id: string) {
  if (!x.actor.grants['api_keys:manage']) throw forbidden();
  const r = await x.tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  if (!r.length) throw notFound('api_key');
  await audit(x, { action: 'api_key.revoked', targetType: 'api_key', targetId: id });
}

// ─── Webhooks ────────────────────────────────────────────────────────────────
export const WEBHOOK_EVENTS = [
  'worker.created',
  'worker.updated',
  'project.created',
  'project.updated',
  'session.started',
  'session.stopped',
  'timesheet.submitted',
  'timesheet.approved',
  'timesheet.rejected',
  'timesheet.late_time',
  'time_off.requested',
  'time_off.approved',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'payment.received',
  'expense.submitted',
  'budget.threshold_crossed',
  'device.offline',
  'device.revoked',
] as const;

export async function listWebhooks(x: Ctx) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const rows = await x.tx.select().from(webhookEndpoints).orderBy(asc(webhookEndpoints.createdAt));
  return rows.map((w) => ({ id: w.id, url: w.url, description: w.description, events: w.events, enabled: w.enabled, failure_count: w.failureCount, disabled_reason: w.disabledReason, created_at: w.createdAt.toISOString() }));
}

export async function upsertWebhook(x: Ctx, id: string | null, input: z.infer<typeof webhookInput>) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  await assertPublicUrl(input.url);
  const events = input.events.filter((e) => e === '*' || (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw forbidden('Choose at least one supported event');
  let wid = id;
  let secret: string | null = null;
  if (wid) {
    const r = await x.tx.update(webhookEndpoints).set({ url: input.url, description: input.description ?? null, events, enabled: input.enabled, ...(input.enabled ? { failureCount: 0, disabledReason: null } : {}), updatedAt: new Date() }).where(eq(webhookEndpoints.id, wid)).returning({ id: webhookEndpoints.id });
    if (!r.length) throw notFound('webhook');
  } else {
    wid = newId();
    secret = `whsec_${randomToken(24)}`;
    await x.tx.insert(webhookEndpoints).values({ id: wid, organizationId: x.org.id, url: input.url, description: input.description ?? null, secretEnc: encrypt(x.deps.config.appSecret, secret, 'webhook'), events, enabled: input.enabled });
  }
  await audit(x, { action: id ? 'webhook.updated' : 'webhook.created', targetType: 'webhook', targetId: wid, after: { url: input.url, events } });
  const dto = (await listWebhooks(x)).find((w) => w.id === wid)!;
  return secret ? { ...dto, secret, note: 'Store the signing secret now. It will not be shown again.' } : dto;
}

export async function deleteWebhook(x: Ctx, id: string) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const r = await x.tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
  if (!r.length) throw notFound('webhook');
  await audit(x, { action: 'webhook.deleted', targetType: 'webhook', targetId: id });
}

export async function listDeliveries(x: Ctx, endpointId: string) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const rows = await x.tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId)).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
  return rows.map((d) => ({ id: d.id, event_id: d.eventId, event_type: d.eventType, attempt: d.attempt, status: d.status, response_status: d.responseStatus, duration_ms: d.durationMs, next_attempt_at: iso(d.nextAttemptAt), created_at: d.createdAt.toISOString() }));
}

export async function replayDelivery(x: Ctx, endpointId: string, deliveryId: string) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const [d] = await x.tx.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.endpointId, endpointId)));
  if (!d) throw notFound('delivery');
  const nid = newId();
  await x.tx.insert(webhookDeliveries).values({ id: nid, organizationId: x.org.id, endpointId, eventId: d.eventId, eventType: d.eventType, payload: d.payload as object, nextAttemptAt: x.deps.now() });
  await audit(x, { action: 'webhook.replayed', targetType: 'webhook_delivery', targetId: deliveryId });
  return { id: nid };
}

export async function testWebhook(x: Ctx, endpointId: string) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const id = newId();
  await x.tx.insert(webhookDeliveries).values({ id, organizationId: x.org.id, endpointId, eventId: newId(), eventType: 'webhook.test', payload: { event_type: 'webhook.test', organization_id: x.org.id, sent_at: x.deps.now().toISOString() }, nextAttemptAt: x.deps.now() });
  return { id };
}

/** Minutes to wait after the 1st, 2nd, … failed attempt; after the last one the delivery is DEAD. */
export const RETRY_SCHEDULE_MINUTES = [1, 5, 30, 120, 360, 720, 1440];
const DISABLE_AFTER_FAILURES = 50;
const LEASE_MS = 2 * 60_000;

/** Tallywork-Signature header: `t=<unix seconds>,v1=<base64url HMAC-SHA256 of "<t>.<body>">`. */
export function webhookSignature(secret: string, body: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${hmac(secret, `${unixSeconds}.${body}`)}`;
}

/**
 * Deliver due webhook attempts (called from the cron tick). Deliveries are claimed with a short
 * lease in one small transaction, sent outside any transaction (a slow endpoint never holds a
 * database connection), and each result is recorded in its own transaction.
 */
export async function deliverWebhooks(deps: Deps, limit = 25): Promise<number> {
  const now = deps.now();
  const claimed = await withSystem(deps.db, async (tx) => {
    const due = await tx
      .select({ d: webhookDeliveries, w: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(and(eq(webhookDeliveries.status, 'PENDING'), lte(webhookDeliveries.nextAttemptAt, now), eq(webhookEndpoints.enabled, true)))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit);
    const out: typeof due = [];
    for (const row of due) {
      const lease = new Date(now.getTime() + LEASE_MS);
      const [ok] = await tx.update(webhookDeliveries).set({ nextAttemptAt: lease }).where(and(eq(webhookDeliveries.id, row.d.id), eq(webhookDeliveries.status, 'PENDING'), lte(webhookDeliveries.nextAttemptAt, now))).returning({ id: webhookDeliveries.id });
      if (ok) out.push(row);
    }
    return out;
  });
  const post = deps.httpPost ?? postToPublicUrl;
  for (const { d, w } of claimed) {
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(deps.now().getTime() / 1000);
    const secret = decrypt(deps.config.appSecret, w.secretEnc, 'webhook');
    const started = Date.now();
    let status: number | null = null;
    let text = '';
    try {
      const res = await post(w.url, { 'Content-Type': 'application/json', 'User-Agent': 'Tallywork-Webhooks/1.0', 'Tallywork-Event': d.eventType, 'Tallywork-Delivery': d.id, 'Tallywork-Signature': webhookSignature(secret, body, ts) }, body, 10_000);
      status = res.status;
      text = res.body;
    } catch (e) {
      text = e instanceof Error ? e.message.slice(0, 500) : 'delivery failed';
    }
    const ok = status !== null && status >= 200 && status < 300;
    const attempt = d.attempt + 1;
    const retry = RETRY_SCHEDULE_MINUTES[attempt - 1];
    const doneAt = deps.now();
    await withSystem(deps.db, async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({ attempt, status: ok ? 'SUCCEEDED' : retry ? 'PENDING' : 'DEAD', responseStatus: status, responseBody: text, durationMs: Date.now() - started, nextAttemptAt: ok || !retry ? null : new Date(doneAt.getTime() + retry * 60_000), updatedAt: doneAt })
        .where(eq(webhookDeliveries.id, d.id));
      const [ep] = await tx
        .update(webhookEndpoints)
        .set({ failureCount: ok ? 0 : sql`${webhookEndpoints.failureCount} + 1` })
        .where(eq(webhookEndpoints.id, w.id))
        .returning({ failures: webhookEndpoints.failureCount });
      if (ep && ep.failures >= DISABLE_AFTER_FAILURES) await tx.update(webhookEndpoints).set({ enabled: false, disabledReason: 'Disabled after repeated delivery failures' }).where(eq(webhookEndpoints.id, w.id));
    });
  }
  return claimed.length;
}

/** New signing secret for an endpoint; the old one stops working immediately. Shown once. */
export async function rotateWebhookSecret(x: Ctx, id: string) {
  if (!x.actor.grants['webhooks:manage']) throw forbidden();
  const secret = `whsec_${randomToken(24)}`;
  const r = await x.tx.update(webhookEndpoints).set({ secretEnc: encrypt(x.deps.config.appSecret, secret, 'webhook'), updatedAt: new Date() }).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
  if (!r.length) throw notFound('webhook');
  await audit(x, { action: 'webhook.secret_rotated', targetType: 'webhook', targetId: id });
  return { id, secret, note: 'Store the signing secret now. It will not be shown again.' };
}

/** Fan out an outbox event to subscribed webhook endpoints. */
export async function enqueueWebhooks(tx: Tx, organizationId: string, envelope: { event_id: string; event_type: string; occurred_at?: string; payload?: unknown }, now = new Date()): Promise<void> {
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(envelope.event_type)) return;
  const eps = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.enabled, true));
  const subscribed = eps.filter((e) => e.events.includes('*') || e.events.includes(envelope.event_type));
  if (!subscribed.length) return;
  const payload = { event_id: envelope.event_id, event_type: envelope.event_type, organization_id: organizationId, occurred_at: envelope.occurred_at, data: envelope.payload };
  await tx.insert(webhookDeliveries).values(subscribed.map((e) => ({ id: newId(), organizationId, endpointId: e.id, eventId: envelope.event_id, eventType: envelope.event_type, payload, nextAttemptAt: now })));
}

// ─── Audit ───────────────────────────────────────────────────────────────────
interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  order?: 'asc' | 'desc';
}

function auditWhere(q: AuditQuery) {
  return and(
    q.from ? gte(auditLogs.createdAt, new Date(q.from)) : undefined,
    q.to ? lt(auditLogs.createdAt, new Date(q.to)) : undefined,
    q.action ? sql`${auditLogs.action} like ${`${q.action}%`}` : undefined,
    q.targetType ? eq(auditLogs.targetType, q.targetType) : undefined,
    q.targetId ? eq(auditLogs.targetId, q.targetId) : undefined,
  );
}

// id breaks ties between entries written in the same instant, so pages never overlap or skip rows.
const auditOrder = (order: AuditQuery['order']) => (order === 'asc' ? [asc(auditLogs.createdAt), asc(auditLogs.id)] : [desc(auditLogs.createdAt), desc(auditLogs.id)]);

export async function listAudit(x: Ctx, q: AuditQuery & { limit?: number }): Promise<AuditLogDto[]> {
  const scope = x.actor.grants['audit:read'];
  if (!scope) throw forbidden();
  const rows = await x.tx
    .select()
    .from(auditLogs)
    .where(auditWhere(q))
    .orderBy(...auditOrder(q.order))
    .limit(Math.min(q.limit ?? 200, 1000));
  return toAuditDtos(x, rows);
}

/** One numbered page of the audit log plus the total matching entries. `page` is 1-based. */
export async function pageAudit(x: Ctx, q: AuditQuery & { page: number; pageSize: number }): Promise<OffsetPage<AuditLogDto>> {
  const scope = x.actor.grants['audit:read'];
  if (!scope) throw forbidden();
  const where = auditWhere(q);
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const rows = await x.tx
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(...auditOrder(q.order))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: await toAuditDtos(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toAuditDtos(x: Ctx, rows: Array<typeof auditLogs.$inferSelect>): Promise<AuditLogDto[]> {
  const names = await memberNames(x, [...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!))]);
  return rows.map((r) => ({ id: r.id, actor_type: r.actorType, actor_id: r.actorId, actor_name: r.actorType === 'user' && r.actorId ? (names.get(r.actorId) ?? null) : null, action: r.action, target_type: r.targetType, target_id: r.targetId, before: r.before, after: r.after, ip_address: r.ipAddress, created_at: r.createdAt.toISOString() }));
}

// ─── Notifications ───────────────────────────────────────────────────────────
export async function listNotifications(x: Ctx, unreadOnly: boolean): Promise<{ data: NotificationDto[]; unread: number }> {
  const rows = await x.tx
    .select()
    .from(notifications)
    .where(and(eq(notifications.membershipId, x.actor.membershipId), unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  const [u] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.membershipId, x.actor.membershipId), isNull(notifications.readAt)));
  return { data: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read_at: iso(n.readAt), created_at: n.createdAt.toISOString() })), unread: u?.n ?? 0 };
}

export async function markNotificationsRead(x: Ctx, ids: string[] | 'all') {
  await x.tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.membershipId, x.actor.membershipId), isNull(notifications.readAt), ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : ['00000000-0000-7000-8000-000000000000'])));
}

export async function getNotificationPrefs(x: Ctx) {
  const rows = await x.tx.select().from(notificationPreferences).where(eq(notificationPreferences.membershipId, x.actor.membershipId));
  return rows.map((r) => ({ type: r.type, in_app: r.inApp, email: r.email }));
}

export async function setNotificationPrefs(x: Ctx, prefs: Array<{ type: string; in_app: boolean; email: boolean }>) {
  for (const p of prefs) {
    await x.tx
      .insert(notificationPreferences)
      .values({ organizationId: x.org.id, membershipId: x.actor.membershipId, type: p.type, inApp: p.in_app, email: p.email })
      .onConflictDoUpdate({ target: [notificationPreferences.membershipId, notificationPreferences.type], set: { inApp: p.in_app, email: p.email } });
  }
  return getNotificationPrefs(x);
}

// ─── Files (receipts) ────────────────────────────────────────────────────────
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export async function uploadReceipt(x: Ctx, file: File) {
  if (!x.actor.grants['expenses:create']) throw forbidden();
  if (!RECEIPT_TYPES.has(file.type)) throw forbidden('Receipts must be JPEG, PNG, WebP or PDF');
  if (file.size > MAX_RECEIPT_BYTES) throw forbidden('Receipts are limited to 10 MB');
  const id = newId();
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
  const key = `org/${x.org.id}/receipts/${x.actor.membershipId}/${id}.${ext}`;
  await x.deps.storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
  await x.tx.insert(fileObjects).values({ id, organizationId: x.org.id, purpose: 'RECEIPT', storageKey: key, contentType: file.type, bytes: file.size, uploadedBy: x.actor.membershipId });
  return { id, content_type: file.type, bytes: file.size };
}

export async function fileForDownload(x: Ctx, id: string) {
  const [f] = await x.tx.select().from(fileObjects).where(eq(fileObjects.id, id));
  if (!f) throw notFound('file');
  const owner = f.uploadedBy;
  if (f.purpose === 'RECEIPT' && !(owner && can(x.actor, 'expenses:read', { ownerMembershipId: owner }))) throw notFound('file');
  if (f.purpose === 'EXPORT' && owner !== x.actor.membershipId) throw notFound('file');
  return f;
}

