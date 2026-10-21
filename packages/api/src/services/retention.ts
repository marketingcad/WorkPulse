import { asc, count, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { activityMinutes, appSpans, auditLogs, retentionPolicies, urlSpans, type Tx } from '@tallywork/db';
import { forbidden, validation } from '@tallywork/domain';
import type { retentionInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit } from './events';

type DataClass = (typeof retentionPolicies.$inferSelect)['dataClass'];

/** Legal lower bounds: financial records at least 7 years, the audit log at least a year. */
export const MIN_KEEP_DAYS: Partial<Record<DataClass, number>> = { INVOICES: 2555, TIMESHEETS: 2555, AUDIT: 365 };
/** Classes the daily job deletes. Timesheets, invoices, sessions and location are kept (the settings record intent only). */
export const PURGED: DataClass[] = ['ACTIVITY', 'APPS', 'URLS', 'AUDIT'];
/** Screenshots have their own cleanup, with a preview and approval (services/screenshot-cleanup.ts). */
const OWN_CLEANUP: DataClass[] = ['SCREENSHOTS'];
/** A shorter keep period takes effect only after this delay, so a mistaken change can be undone before data is lost. */
export const GRACE_DAYS = 7;

type Policy = typeof retentionPolicies.$inferSelect;

/** Keep days in force at `now` (a pending shorter period applies once its grace period is over). */
export function effectiveKeepDays(p: Policy, now: Date): number {
  return p.pendingKeepDays != null && p.pendingFrom && now >= p.pendingFrom ? p.pendingKeepDays : p.keepDays;
}

function dto(p: Policy) {
  return {
    data_class: p.dataClass,
    keep_days: p.keepDays,
    pending_keep_days: p.pendingKeepDays,
    pending_from: p.pendingFrom?.toISOString() ?? null,
    min_days: MIN_KEEP_DAYS[p.dataClass] ?? 1,
    purged_automatically: PURGED.includes(p.dataClass),
  };
}

function assertRead(x: Ctx) {
  if (!x.actor.grants['retention:manage'] && !x.actor.grants['settings:security']) throw forbidden();
}

export async function getRetention(x: Ctx) {
  assertRead(x);
  return (await x.tx.select().from(retentionPolicies).orderBy(asc(retentionPolicies.dataClass))).filter((p) => !OWN_CLEANUP.includes(p.dataClass)).map(dto);
}

/**
 * Longer (or equal) keep periods apply at once and cancel any pending change. Shorter ones —
 * including a first policy for a class that was kept forever — wait GRACE_DAYS before deleting anything.
 */
export async function setRetention(x: Ctx, input: z.infer<typeof retentionInput>) {
  if (!x.actor.grants['retention:manage']) throw forbidden();
  const now = x.deps.now();
  const errors = [
    ...input.policies.filter((p) => OWN_CLEANUP.includes(p.data_class)).map((p) => ({ field: `policies.${p.data_class}`, message: 'Screenshot retention is set under Settings › Screenshot retention' })),
    ...input.policies.filter((p) => p.keep_days < (MIN_KEEP_DAYS[p.data_class] ?? 1)).map((p) => ({ field: `policies.${p.data_class}`, message: `${p.data_class.toLowerCase()} must be kept at least ${MIN_KEEP_DAYS[p.data_class]} days` })),
  ];
  if (errors.length) throw validation(errors[0]!.message, { errors });
  const current = new Map((await x.tx.select().from(retentionPolicies)).map((p) => [p.dataClass, p]));
  for (const p of input.policies) {
    const cur = current.get(p.data_class);
    const shorter = !cur || p.keep_days < cur.keepDays;
    const values = shorter
      ? { keepDays: cur?.keepDays ?? 36500, pendingKeepDays: p.keep_days, pendingFrom: new Date(now.getTime() + GRACE_DAYS * 86400_000) }
      : { keepDays: p.keep_days, pendingKeepDays: null, pendingFrom: null };
    await x.tx
      .insert(retentionPolicies)
      .values({ organizationId: x.org.id, dataClass: p.data_class, ...values })
      .onConflictDoUpdate({ target: [retentionPolicies.organizationId, retentionPolicies.dataClass], set: { ...values, updatedAt: now } });
  }
  await audit(x, { action: 'retention.updated', targetType: 'organization', targetId: x.org.id, before: [...current.values()].map(dto), after: input });
  return getRetention(x);
}

const cutoffFor = (keepDays: number, now: Date) => new Date(now.getTime() - keepDays * 86400_000);

async function countOlder(tx: Tx, cls: DataClass, cutoff: Date): Promise<number> {
  const q = (t: typeof activityMinutes | typeof appSpans | typeof urlSpans | typeof auditLogs, col: Parameters<typeof lt>[0]) => tx.select({ n: count() }).from(t).where(lt(col, cutoff));
  const [r] =
    cls === 'ACTIVITY' ? await q(activityMinutes, activityMinutes.minuteStart)
    : cls === 'APPS' ? await q(appSpans, appSpans.startedAt)
    : cls === 'URLS' ? await q(urlSpans, urlSpans.startedAt)
    : await q(auditLogs, auditLogs.createdAt);
  return Number(r?.n ?? 0);
}

/** Dry run: what the next daily run would delete, and what a pending change will delete once it applies. */
export async function previewRetention(x: Ctx) {
  assertRead(x);
  const now = x.deps.now();
  const out = [];
  for (const p of await x.tx.select().from(retentionPolicies)) {
    if (!PURGED.includes(p.dataClass)) continue;
    const keep = effectiveKeepDays(p, now);
    out.push({
      data_class: p.dataClass,
      keep_days: keep,
      next_run_deletes: keep >= 36500 ? 0 : await countOlder(x.tx, p.dataClass, cutoffFor(keep, now)),
      pending_keep_days: p.pendingKeepDays,
      pending_from: p.pendingFrom?.toISOString() ?? null,
      pending_deletes: p.pendingKeepDays != null ? await countOlder(x.tx, p.dataClass, cutoffFor(p.pendingKeepDays, now)) : null,
    });
  }
  return out;
}

/** Daily: apply matured pending periods, then delete data older than each class's keep period. */
export async function applyRetention(tx: Tx, deps: Deps): Promise<Record<string, number>> {
  const now = deps.now();
  const deleted: Record<string, number> = {};
  for (const p of await tx.select().from(retentionPolicies)) {
    let keep = p.keepDays;
    if (p.pendingKeepDays != null && p.pendingFrom && now >= p.pendingFrom) {
      keep = p.pendingKeepDays;
      await tx.update(retentionPolicies).set({ keepDays: keep, pendingKeepDays: null, pendingFrom: null, updatedAt: now }).where(sql`${retentionPolicies.organizationId} = ${p.organizationId} and ${retentionPolicies.dataClass} = ${p.dataClass}`);
    }
    if (!PURGED.includes(p.dataClass) || keep >= 36500) continue;
    const cut = cutoffFor(Math.max(keep, MIN_KEEP_DAYS[p.dataClass] ?? 1), now);
    if (p.dataClass === 'ACTIVITY') deleted.activity_minutes = (await tx.delete(activityMinutes).where(lt(activityMinutes.minuteStart, cut)).returning({ s: activityMinutes.sessionId })).length;
    else if (p.dataClass === 'APPS') deleted.app_spans = (await tx.delete(appSpans).where(lt(appSpans.startedAt, cut)).returning({ id: appSpans.id })).length;
    else if (p.dataClass === 'URLS') deleted.url_spans = (await tx.delete(urlSpans).where(lt(urlSpans.startedAt, cut)).returning({ id: urlSpans.id })).length;
    else if (p.dataClass === 'AUDIT') {
      // The app cannot delete audit rows itself; the database function enforces the one-year minimum on its own clock.
      const r = await tx.execute<{ n: number }>(sql`select tallywork_purge_audit(${keep}) as n`);
      deleted.audit = Number((r as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
    }
  }
  return deleted;
}
