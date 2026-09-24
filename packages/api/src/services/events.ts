import { auditLogs, outboxEvents, type Tx } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { actorRef, type Ctx } from './ctx';

export interface EmitOptions {
  workerId?: string | null;
  sessionId?: string | null;
  deviceId?: string | null;
  occurredAt?: Date;
  correlationId?: string;
  actor?: { type: 'user' | 'agent' | 'system' | 'api_key'; id: string | null };
}

/**
 * Append a domain event to the transactional outbox (same transaction as the change).
 * The dispatcher delivers it to projectors, notifications and webhooks.
 */
export async function emit(tx: Tx, organizationId: string, eventType: string, payload: Record<string, unknown>, opts: EmitOptions = {}): Promise<string> {
  const eventId = newId();
  const now = new Date();
  const envelope = {
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    organization_id: organizationId,
    worker_id: opts.workerId ?? null,
    session_id: opts.sessionId ?? null,
    device_id: opts.deviceId ?? null,
    occurred_at: (opts.occurredAt ?? now).toISOString(),
    received_at: now.toISOString(),
    correlation_id: opts.correlationId ?? eventId,
    actor: opts.actor ?? { type: 'system', id: null },
    payload,
  };
  await tx.insert(outboxEvents).values({ id: eventId, organizationId, eventType, envelope });
  return eventId;
}

export function emitFrom(x: Ctx, eventType: string, payload: Record<string, unknown>, opts: Omit<EmitOptions, 'actor' | 'correlationId'> = {}) {
  const a = actorRef(x);
  return emit(x.tx, x.org.id, eventType, payload, { ...opts, correlationId: x.requestId, actor: { type: a.actorType, id: a.actorId } });
}

const REDACT = new Set(['password', 'passwordHash', 'password_hash', 'secret', 'secretHash', 'secretEnc', 'token', 'tokenHash']);

function redact(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, REDACT.has(k) ? '[redacted]' : redact(val)]));
}

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Append-only audit record. */
export async function audit(x: Ctx, e: AuditEntry): Promise<void> {
  const a = actorRef(x);
  await x.tx.insert(auditLogs).values({
    id: newId(),
    organizationId: x.org.id,
    actorType: a.actorType,
    actorId: a.actorId,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    before: e.before === undefined ? null : redact(e.before),
    after: e.after === undefined ? null : redact(e.after),
    metadata: e.metadata ?? null,
    ipAddress: x.ip,
    userAgent: x.userAgent?.slice(0, 300) ?? null,
    requestId: x.requestId,
  });
}

export async function auditSystem(tx: Tx, organizationId: string, e: AuditEntry & { actorType?: 'system' | 'agent' | 'user'; actorId?: string | null }): Promise<void> {
  await tx.insert(auditLogs).values({
    id: newId(),
    organizationId,
    actorType: e.actorType ?? 'system',
    actorId: e.actorId ?? null,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    before: e.before === undefined ? null : redact(e.before),
    after: e.after === undefined ? null : redact(e.after),
    metadata: e.metadata ?? null,
  });
}
