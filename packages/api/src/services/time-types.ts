import { and, asc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { timeEntries, timeTypes, type Tx } from '@tallywork/db';
import { addDaysToDate, forbidden, localDate, newId, notFound, validation } from '@tallywork/domain';
import type { TimeTypeDto, timeTypeInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { recomputeWorkerDays } from './projector';

/** How far back rollups are rebuilt when a coefficient changes (older estimates keep their weighting). */
const RECOMPUTE_DAYS = 62;

function dto(t: typeof timeTypes.$inferSelect): TimeTypeDto {
  return {
    id: t.id,
    name: t.name,
    short_name: t.shortName,
    color: t.color,
    pay_coefficient: t.payCoefficient,
    bill_coefficient: t.billCoefficient,
    not_billable: t.notBillable,
    is_default: t.isDefault,
    archived_at: t.archivedAt?.toISOString() ?? null,
  };
}

export async function listTimeTypes(x: Ctx, opts: { includeArchived?: boolean } = {}): Promise<TimeTypeDto[]> {
  const rows = await x.tx.select().from(timeTypes).where(opts.includeArchived ? undefined : isNull(timeTypes.archivedAt)).orderBy(asc(timeTypes.createdAt));
  return rows.map(dto);
}

export async function upsertTimeType(x: Ctx, id: string | null, input: z.infer<typeof timeTypeInput>) {
  if (!x.actor.grants['org:update']) throw forbidden();
  const values = {
    name: input.name,
    shortName: input.short_name,
    color: input.color ?? '#475569',
    payCoefficient: input.pay_coefficient,
    billCoefficient: input.bill_coefficient,
    notBillable: input.not_billable ?? false,
    isDefault: input.is_default ?? false,
  };
  let before: typeof timeTypes.$inferSelect | undefined;
  let tid = id;
  if (tid) {
    [before] = await x.tx.select().from(timeTypes).where(eq(timeTypes.id, tid));
    if (!before) throw notFound('time_type');
    await x.tx.update(timeTypes).set({ ...values, updatedAt: new Date() }).where(eq(timeTypes.id, tid));
  } else {
    tid = newId();
    await x.tx.insert(timeTypes).values({ id: tid, organizationId: x.org.id, ...values });
  }
  // Exactly one default at most.
  if (values.isDefault) await x.tx.update(timeTypes).set({ isDefault: false, updatedAt: new Date() }).where(and(ne(timeTypes.id, tid), eq(timeTypes.isDefault, true)));
  const weightingChanged = !before || before.payCoefficient !== values.payCoefficient || before.billCoefficient !== values.billCoefficient || before.isDefault !== values.isDefault;
  if (weightingChanged) await recomputeRecent(x);
  await audit(x, { action: id ? 'time_type.updated' : 'time_type.created', targetType: 'time_type', targetId: tid, before, after: values });
  return (await listTimeTypes(x, { includeArchived: true })).find((t) => t.id === tid)!;
}

export async function archiveTimeType(x: Ctx, id: string) {
  if (!x.actor.grants['org:update']) throw forbidden();
  const [t] = await x.tx.update(timeTypes).set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(eq(timeTypes.id, id)).returning();
  if (!t) throw notFound('time_type');
  // Entries keep their type (and its coefficients); only the default changes if this was it.
  await recomputeRecent(x);
  await audit(x, { action: 'time_type.archived', targetType: 'time_type', targetId: id });
}

/** Rebuild recent worker-day rollups so estimates use the new weighting. */
async function recomputeRecent(x: Ctx) {
  const from = addDaysToDate(localDate(x.deps.now(), x.org.timezone), -RECOMPUTE_DAYS);
  const rows = await x.tx
    .select({ m: timeEntries.membershipId, dates: sql<string[]>`array_agg(distinct ${timeEntries.localDate})` })
    .from(timeEntries)
    .where(and(gte(timeEntries.localDate, from), isNull(timeEntries.deletedAt)))
    .groupBy(timeEntries.membershipId);
  for (const r of rows) await recomputeWorkerDays(x.tx, x.org.id, r.m, r.dates);
}

/** Coefficient lookup for pricing: a type's own values, else the default type's, else 1×. */
export async function timeTypeCoefficients(tx: Tx): Promise<(id: string | null) => { pay: number; bill: number }> {
  const rows = await tx.select().from(timeTypes);
  const byId = new Map(rows.map((t) => [t.id, t]));
  const def = rows.find((t) => t.isDefault && !t.archivedAt);
  return (id) => {
    const t = (id && byId.get(id)) || def;
    return t ? { pay: t.payCoefficient, bill: t.billCoefficient } : { pay: 1, bill: 1 };
  };
}

/** Validates a time type chosen for an entry; `notBillable` types force the entry non-billable. */
export async function checkTimeType(tx: Tx, id: string | null | undefined): Promise<{ id: string | null; notBillable: boolean } | undefined> {
  if (id === undefined) return undefined;
  if (id === null) return { id: null, notBillable: false };
  const [t] = await tx.select().from(timeTypes).where(and(eq(timeTypes.id, id), isNull(timeTypes.archivedAt)));
  if (!t) throw validation('That time type does not exist', { errors: [{ field: 'time_type_id', message: 'Choose an active time type' }] });
  return { id: t.id, notBillable: t.notBillable };
}
