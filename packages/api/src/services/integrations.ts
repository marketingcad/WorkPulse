import { and, asc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { externalRefs, integrationConnections, withSystem, withTenant, type Tx } from '@tallywork/db';
import { forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { Deps } from '../context';
import { decrypt, encrypt } from '../lib/crypto';
import type { Ctx } from './ctx';
import { audit } from './events';

/**
 * Integration framework. A provider knows how to talk to one external system; a connection is
 * one organization's configured account with it. Syncs run in the background, one connection at
 * a time, inside that organization's tenant transaction.
 */
export interface SyncContext {
  tx: Tx;
  organizationId: string;
  connectionId: string;
  config: Record<string, unknown>;
  /** decrypted credentials (only ever held in memory during a sync) */
  secret: string | null;
  now: Date;
  /** Look up / record which Tallywork record an external record maps to. */
  refs: {
    find(entityType: string, externalId: string): Promise<string | null>;
    link(entityType: string, entityId: string, externalId: string): Promise<void>;
  };
}

export interface IntegrationProvider {
  key: string;
  name: string;
  /** Validates non-secret settings when a connection is created or changed. */
  configSchema: z.ZodType<Record<string, unknown>>;
  sync(ctx: SyncContext): Promise<{ created: number; updated: number }>;
}

const PROVIDERS = new Map<string, IntegrationProvider>();
export function registerProvider(p: IntegrationProvider) {
  PROVIDERS.set(p.key, p);
}
export function listProviders() {
  return [...PROVIDERS.values()].map((p) => ({ key: p.key, name: p.name }));
}

export const connectionInput = z.object({
  provider: z.string().max(60),
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  secret: z.string().max(4000).nullable().optional(),
});

function dto(c: typeof integrationConnections.$inferSelect) {
  return { id: c.id, provider: c.provider, name: c.name, status: c.status, config: c.config, has_secret: !!c.secretEnc, last_sync_at: c.lastSyncAt?.toISOString() ?? null, last_error: c.lastError, sync_pending: !!c.syncRequestedAt };
}

function assertManage(x: Ctx) {
  if (!x.actor.grants['org:update']) throw forbidden();
}

export async function listConnections(x: Ctx) {
  assertManage(x);
  return (await x.tx.select().from(integrationConnections).orderBy(asc(integrationConnections.createdAt))).map(dto);
}

export async function createConnection(x: Ctx, input: z.infer<typeof connectionInput>) {
  assertManage(x);
  const p = PROVIDERS.get(input.provider);
  if (!p) throw notFound('integration_provider');
  const config = p.configSchema.safeParse(input.config);
  if (!config.success) throw validation(`Invalid settings for ${p.name}`, { errors: config.error.issues.map((i) => ({ field: `config.${i.path.join('.')}`, message: i.message })) });
  const id = newId();
  const [row] = await x.tx
    .insert(integrationConnections)
    .values({ id, organizationId: x.org.id, provider: p.key, name: input.name, config: config.data, secretEnc: input.secret ? encrypt(x.deps.config.appSecret, input.secret, `integration:${id}`) : null, createdBy: x.actor.membershipId })
    .returning();
  await audit(x, { action: 'integration.connected', targetType: 'integration', targetId: id, after: { provider: p.key, name: input.name, config: config.data } });
  return dto(row!);
}

export async function deleteConnection(x: Ctx, id: string) {
  assertManage(x);
  const r = await x.tx.delete(integrationConnections).where(eq(integrationConnections.id, id)).returning({ id: integrationConnections.id });
  if (!r.length) throw notFound('integration');
  await x.tx.delete(externalRefs).where(eq(externalRefs.connectionId, id));
  await audit(x, { action: 'integration.disconnected', targetType: 'integration', targetId: id });
}

/** Ask for a sync; the tick runs it in the background. */
export async function requestSync(x: Ctx, id: string) {
  assertManage(x);
  const [row] = await x.tx.update(integrationConnections).set({ syncRequestedAt: x.deps.now() }).where(eq(integrationConnections.id, id)).returning();
  if (!row) throw notFound('integration');
  x.deps.defer(() => runSyncs(x.deps).then(() => undefined));
  return dto(row);
}

/** Run requested syncs (and hourly syncs for active connections). Errors are recorded, never thrown. */
export async function runSyncs(deps: Deps, limit = 5): Promise<number> {
  const now = deps.now();
  const hourAgo = new Date(now.getTime() - 3600_000);
  const due = await withSystem(deps.db, (tx) =>
    tx
      .select({ id: integrationConnections.id, org: integrationConnections.organizationId })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.status, 'ACTIVE'), or(isNotNull(integrationConnections.syncRequestedAt), isNull(integrationConnections.lastSyncAt), lte(integrationConnections.lastSyncAt, hourAgo))))
      .orderBy(sql`${integrationConnections.syncRequestedAt} nulls last`)
      .limit(limit),
  );
  let ran = 0;
  for (const d of due) {
    try {
      await withTenant(deps.db, d.org, async (tx) => {
        const [c] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, d.id)).for('update', { skipLocked: true });
        if (!c) return;
        const p = PROVIDERS.get(c.provider);
        if (!p) throw new Error(`Provider ${c.provider} is not available`);
        const ctx: SyncContext = {
          tx,
          organizationId: d.org,
          connectionId: c.id,
          config: c.config,
          secret: c.secretEnc ? decrypt(deps.config.appSecret, c.secretEnc, `integration:${c.id}`) : null,
          now,
          refs: {
            async find(entityType, externalId) {
              const [r] = await tx.select({ id: externalRefs.entityId }).from(externalRefs).where(and(eq(externalRefs.connectionId, c.id), eq(externalRefs.entityType, entityType), eq(externalRefs.externalId, externalId)));
              return r?.id ?? null;
            },
            async link(entityType, entityId, externalId) {
              await tx.insert(externalRefs).values({ organizationId: d.org, connectionId: c.id, entityType, entityId, externalId }).onConflictDoUpdate({ target: [externalRefs.connectionId, externalRefs.entityType, externalRefs.externalId], set: { entityId, syncedAt: now } });
            },
          },
        };
        await p.sync(ctx);
        await tx.update(integrationConnections).set({ lastSyncAt: now, syncRequestedAt: null, lastError: null, updatedAt: now }).where(eq(integrationConnections.id, c.id));
      });
      ran++;
    } catch (e) {
      // First line only: database errors carry the query and its parameters on later lines.
      const message = e instanceof Error ? (e.message.split('\n')[0] ?? '').slice(0, 300) : 'Sync failed';
      await withSystem(deps.db, (tx) => tx.update(integrationConnections).set({ lastError: message, lastSyncAt: now, syncRequestedAt: null, status: 'ERROR' }).where(eq(integrationConnections.id, d.id)));
    }
  }
  return ran;
}
